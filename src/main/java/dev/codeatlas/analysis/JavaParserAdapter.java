package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.*;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import java.io.File;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class JavaParserAdapter {
    private final JdbcTemplate db;
    private Path root;
    private final List<String> diagnostics = new ArrayList<>();
    public List<String> diagnostics() { return List.copyOf(diagnostics); }
    public void addDiagnostic(String message) { diagnostics.add(message); }
    public JavaParserAdapter(JdbcTemplate db) { this.db = db; }

    public void setupSymbolSolver(String workspacePath) {
        diagnostics.clear();
        root = Path.of(workspacePath).toAbsolutePath().normalize();
        CombinedTypeSolver solver = new CombinedTypeSolver(new ReflectionTypeSolver());
        try (var paths = Files.walk(root)) {
            List<Path> roots = paths.filter(Files::isDirectory)
                .filter(p -> p.endsWith("src/main/java") || p.endsWith("src/test/java"))
                .filter(p -> !Files.isSymbolicLink(p)).sorted().toList();
            if (roots.isEmpty()) solver.add(new JavaParserTypeSolver(root));
            else for (Path path : roots) solver.add(new JavaParserTypeSolver(path));
        } catch (Exception e) { throw new IllegalArgumentException("Cannot discover Java source roots", e); }
        StaticJavaParser.getParserConfiguration().setLanguageLevel(com.github.javaparser.ParserConfiguration.LanguageLevel.JAVA_21)
            .setSymbolResolver(new JavaSymbolSolver(solver));
    }
    private static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String methodName(String owner, MethodDeclaration m) {
        return owner + "." + m.getNameAsString() + "(" + m.getParameters().stream()
            .map(p -> p.getTypeAsString() + (p.isVarArgs() ? "[]" : "")).collect(Collectors.joining(",")) + ")";
    }
    public void parseDeclarations(File file, String workspaceId, String snapshotId) {
        try {
            String content = Files.readString(file.toPath());
            String fileId = UUID.randomUUID().toString();
            db.update("INSERT INTO source_file_versions (id, snapshot_id, relative_path, content_hash, source_content) VALUES (?, ?, ?, ?, ?)",
                fileId, snapshotId, root.relativize(file.toPath().toAbsolutePath()).toString(), hash(content), content);
            var result = new com.github.javaparser.JavaParser(StaticJavaParser.getParserConfiguration()).parse(content);
            if (!result.isSuccessful()) {
                diagnostics.add(root.relativize(file.toPath().toAbsolutePath()) + ": Java parsing incomplete; file excluded from graph.");
                return;
            }
            CompilationUnit cu = result.getResult().get();
            String pkg = cu.getPackageDeclaration().map(p -> p.getNameAsString()).orElse("(default)");
            String pkgId = getSymbolId(snapshotId, pkg);
            if (pkgId == null) pkgId = symbol(workspaceId, snapshotId, pkg, pkg, "PACKAGE", null, hash(pkg), null);
            final String packageId = pkgId;
            for (TypeDeclaration<?> type : cu.findAll(TypeDeclaration.class)) {
                String qname = type.getFullyQualifiedName().orElse(pkg + "." + type.getNameAsString());
                String parent = type.findAncestor(TypeDeclaration.class).map(t -> getSymbolId(snapshotId, ((TypeDeclaration<?>)t).getFullyQualifiedName().orElse(""))).orElse(packageId);
                String kind = type instanceof ClassOrInterfaceDeclaration c ? (c.isInterface() ? "INTERFACE" : "CLASS") : type instanceof EnumDeclaration ? "ENUM" : type instanceof RecordDeclaration ? "RECORD" : "ANNOTATION";
                String typeId = symbol(workspaceId, snapshotId, qname, type.getNameAsString(), kind, parent, hash(content), type);
                linkSymbol(typeId, evidence(fileId, type, content));
                for (MethodDeclaration m : type.getMethods()) {
                    String id = symbol(workspaceId, snapshotId, methodName(qname, m), m.getNameAsString(), "METHOD", typeId, hash(content), m);
                    db.update("UPDATE symbol_versions SET signature = ?, return_type = ? WHERE id = ?", m.getDeclarationAsString(false, false, false), m.getTypeAsString(), id);
                    linkSymbol(id, evidence(fileId, m, content));
                }
            }
        } catch (Exception e) { throw new IllegalStateException("Declaration indexing failed for " + file.getName(), e); }
    }
    private String symbol(String ws, String snap, String qname, String name, String kind, String parent, String hash, Node node) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT OR IGNORE INTO logical_symbols (workspace_id, key) VALUES (?, ?)", ws, qname);
        db.update("INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, parent_symbol_id, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, snap, qname, ws, kind, qname, name, parent, hash);
        if (node instanceof com.github.javaparser.ast.nodeTypes.NodeWithAnnotations<?> annotated) {
            try {
                db.update("UPDATE symbol_versions SET annotations = ? WHERE id = ?", new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(annotated.getAnnotations().stream().map(a -> a.getNameAsString()).toList()), id);
            } catch (Exception e) { throw new IllegalStateException(e); }
        }
        return id;
    }
    private void linkSymbol(String id, String ev) { db.update("INSERT INTO symbol_evidence VALUES (?, ?)", id, ev); }
    private String evidence(String fileId, Node node, String content) {
        var range = node.getRange().orElseThrow();
        String[] lines = content.split("\n", -1);
        StringBuilder snippet = new StringBuilder();
        for (int line = range.begin.line; line <= range.end.line; line++) {
            String text = lines[line - 1];
            int start = line == range.begin.line ? range.begin.column - 1 : 0;
            int end = line == range.end.line ? Math.min(range.end.column, text.length()) : text.length();
            snippet.append(text, Math.min(start, end), end);
            if (line < range.end.line) snippet.append('\n');
        }
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO evidence (id, source_file_version_id, start_line, start_column, end_line, end_column, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, fileId, range.begin.line, range.begin.column, range.end.line, range.end.column, snippet.toString());
        return id;
    }
    private String relationship(String snap, String source, String target, String unresolved, String kind, String ev) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, unresolved_target, kind, resolution, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id, snap, source, target, target == null ? unresolved : null, kind, target == null ? "UNRESOLVED" : "RESOLVED", target == null ? "Static target unavailable in indexed source" : "Static declaration target; runtime dispatch may vary");
        db.update("INSERT INTO relationship_evidence VALUES (?, ?)", id, ev);
        return id;
    }
    public void parseRelationships(File file, String workspaceId, String snapshotId) {
        try {
            String content = Files.readString(file.toPath());
            var result = new com.github.javaparser.JavaParser(StaticJavaParser.getParserConfiguration()).parse(content);
            if (!result.isSuccessful()) return;
            CompilationUnit cu = result.getResult().get();
            String fileId = db.queryForObject("SELECT id FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshotId, root.relativize(file.toPath().toAbsolutePath()).toString());
            Map<String, String> dependsOnByPair = new HashMap<>();
            for (TypeDeclaration<?> type : cu.findAll(TypeDeclaration.class)) {
                String owner = type.getFullyQualifiedName().orElse("");
                String ownerId = getSymbolId(snapshotId, owner);
                if (ownerId == null) continue;
                if (type instanceof ClassOrInterfaceDeclaration c) {
                    c.getExtendedTypes().forEach(t -> relationship(snapshotId, ownerId, resolveType(cu, snapshotId, t), t.asString(), "EXTENDS", evidence(fileId, t, content)));
                    c.getImplementedTypes().forEach(t -> relationship(snapshotId, ownerId, resolveType(cu, snapshotId, t), t.asString(), "IMPLEMENTS", evidence(fileId, t, content)));
                }
                for (MethodDeclaration m : type.getMethods()) {
                    String caller = getSymbolId(snapshotId, methodName(owner, m));
                    if (caller == null) continue;
                    for (MethodCallExpr call : m.findAll(MethodCallExpr.class)) {
                        if (call.findAncestor(MethodDeclaration.class).orElse(null) != m) continue;
                        String target = null;
                        String targetClass = null;
                        try {
                            var resolved = call.resolve();
                            targetClass = getSymbolId(snapshotId, resolved.declaringType().getQualifiedName());
                            var ast = resolved.toAst();
                            if (ast.isPresent() && ast.get() instanceof MethodDeclaration declaration) {
                                target = getSymbolId(snapshotId, methodName(resolved.declaringType().getQualifiedName(), declaration));
                            }
                            if (target == null) target = getSymbolId(snapshotId, resolved.getQualifiedSignature().replace(", ", ","));
                        } catch (Exception ignored) { /* Never guess overloads or targets. */ }
                        String ev = evidence(fileId, call, content);
                        relationship(snapshotId, caller, target, call.toString(), "CALLS", ev);
                        if (targetClass != null && !targetClass.equals(ownerId)) {
                            String pairKey = ownerId + "->" + targetClass;
                            String dependsOnId = dependsOnByPair.get(pairKey);
                            if (dependsOnId == null) {
                                dependsOnByPair.put(pairKey, relationship(snapshotId, ownerId, targetClass, null, "DEPENDS_ON", ev));
                            } else {
                                db.update("INSERT INTO relationship_evidence VALUES (?, ?)", dependsOnId, ev);
                            }
                        }
                    }
                }
            }
        } catch (Exception e) { throw new IllegalStateException("Relationship indexing failed for " + file.getName(), e); }
    }
    private String resolveType(CompilationUnit cu, String snap, com.github.javaparser.ast.type.ClassOrInterfaceType type) {
        try { return getSymbolId(snap, type.resolve().asReferenceType().getQualifiedName()); }
        catch (Exception ignored) {
            String name = type.getNameWithScope();
            if (name.contains(".")) return getSymbolId(snap, name);
            for (var imp : cu.getImports()) if (!imp.isAsterisk() && imp.getNameAsString().endsWith("." + name)) return getSymbolId(snap, imp.getNameAsString());
            return getSymbolId(snap, cu.getPackageDeclaration().map(p -> p.getNameAsString() + ".").orElse("") + name);
        }
    }
    private String getSymbolId(String snap, String qname) {
        var ids = db.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?", String.class, snap, qname);
        return ids.size() == 1 ? ids.get(0) : null;
    }
}
