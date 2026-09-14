package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import com.github.javaparser.ast.type.ClassOrInterfaceType;
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
    private final Map<String, Optional<String>> relationshipLookups = new HashMap<>();
    private final Map<String, Set<String>> indexedTypeNames = new HashMap<>();
    private final Map<String, Set<String>> typesWithConstructors = new HashMap<>();
    /** Record type id -> its declared canonical constructor, when a call's argument count alone identifies it. */
    private final Map<String, CanonicalConstructor> recordCanonicalConstructors = new HashMap<>();
    private record CanonicalConstructor(String id, int arity) {}
    public List<String> diagnostics() { return List.copyOf(diagnostics); }
    public void addDiagnostic(String message) { diagnostics.add(message); }
    public JavaParserAdapter(JdbcTemplate db) { this.db = db; }

    public void setupSymbolSolver(String workspacePath) {
        diagnostics.clear();
        relationshipLookups.clear();
        indexedTypeNames.clear();
        typesWithConstructors.clear();
        recordCanonicalConstructors.clear();
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
        return callableName(owner, m);
    }
    /**
     * Constructors are keyed like methods, using the type's own name: {@code pkg.Event.Event(EventRequestDTO)}. Java
     * also allows a method with that exact name and parameter list; only then is the constructor keyed
     * {@code pkg.Event.<init>(..)}, so both symbols stay unique and resolvable.
     */
    public static String constructorName(String owner, ConstructorDeclaration c) {
        return constructorKey(owner, c.getNameAsString(), c.getParameters(), c.getParentNode().orElse(null));
    }
    /** A record's compact constructor is its canonical constructor: its parameters are the record components. */
    public static String compactConstructorName(String owner, CompactConstructorDeclaration c) {
        RecordDeclaration record = (RecordDeclaration) c.getParentNode().orElseThrow();
        return constructorKey(owner, record.getNameAsString(), record.getParameters(), record);
    }
    private static String constructorKey(String owner, String typeName, List<Parameter> parameters, Node declaringType) {
        String params = parameterList(parameters), name = owner + "." + typeName + params;
        boolean clashesWithMethod = declaringType instanceof TypeDeclaration<?> type
            && type.getMethods().stream().anyMatch(m -> callableName(owner, m).equals(name));
        return clashesWithMethod ? owner + ".<init>" + params : name;
    }
    private static String callableName(String owner, CallableDeclaration<?> callable) {
        return owner + "." + callable.getNameAsString() + parameterList(callable.getParameters());
    }
    private static String parameterList(List<Parameter> parameters) {
        return "(" + parameters.stream().map(p -> p.getTypeAsString() + (p.isVarArgs() ? "[]" : "")).collect(Collectors.joining(",")) + ")";
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
            String[] lines = content.split("\n", -1);
            for (TypeDeclaration<?> type : cu.findAll(TypeDeclaration.class)) {
                // Local classes (and types nested in them) have no qualified name; their code belongs to the enclosing member.
                if (type.getFullyQualifiedName().isEmpty()) continue;
                String qname = type.getFullyQualifiedName().get();
                String parent = type.findAncestor(TypeDeclaration.class).map(t -> getSymbolId(snapshotId, ((TypeDeclaration<?>)t).getFullyQualifiedName().orElse(""))).orElse(packageId);
                String kind = type instanceof ClassOrInterfaceDeclaration c ? (c.isInterface() ? "INTERFACE" : "CLASS") : type instanceof EnumDeclaration ? "ENUM" : type instanceof RecordDeclaration ? "RECORD" : "ANNOTATION";
                String typeId = symbol(workspaceId, snapshotId, qname, type.getNameAsString(), kind, parent, hash(content), type);
                linkSymbol(typeId, evidence(fileId, type, lines));
                for (MethodDeclaration m : type.getMethods()) {
                    String id = symbol(workspaceId, snapshotId, methodName(qname, m), m.getNameAsString(), "METHOD", typeId, hash(content), m);
                    db.update("UPDATE symbol_versions SET signature = ?, return_type = ? WHERE id = ?", m.getDeclarationAsString(false, false, false), m.getTypeAsString(), id);
                    linkSymbol(id, evidence(fileId, m, lines));
                }
                // Explicit constructors are indexed so their bodies (e.g. mapping a DTO into an entity)
                // can own relationships and so the Methods level can show them.
                String canonicalId = null;
                for (ConstructorDeclaration c : type.getConstructors()) {
                    String id = symbol(workspaceId, snapshotId, constructorName(qname, c), c.getNameAsString(), "CONSTRUCTOR", typeId, hash(content), c);
                    db.update("UPDATE symbol_versions SET signature = ? WHERE id = ?", c.getDeclarationAsString(false, false, false), id);
                    linkSymbol(id, evidence(fileId, c, lines));
                    if (type instanceof RecordDeclaration record && parameterList(c.getParameters()).equals(parameterList(record.getParameters()))) canonicalId = id;
                }
                // A record's compact constructor is its canonical constructor, declared without a parameter list.
                if (type instanceof RecordDeclaration record) {
                    for (CompactConstructorDeclaration c : record.getCompactConstructors()) {
                        String id = symbol(workspaceId, snapshotId, compactConstructorName(qname, c), c.getNameAsString(), "CONSTRUCTOR", typeId, hash(content), c);
                        db.update("UPDATE symbol_versions SET signature = ? WHERE id = ?", c.getDeclarationAsString(false, false, false), id);
                        linkSymbol(id, evidence(fileId, c, lines));
                        canonicalId = id;
                    }
                    int arity = record.getParameters().size();
                    boolean arityIsUnique = type.getConstructors().stream().noneMatch(c -> c.getParameters().size() == arity && !parameterList(c.getParameters()).equals(parameterList(record.getParameters()))
                        || c.getParameters().stream().anyMatch(Parameter::isVarArgs));
                    if (canonicalId != null && arityIsUnique) recordCanonicalConstructors.put(typeId, new CanonicalConstructor(canonicalId, arity));
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
    /** {@code lines} is the file split once per pass, not per evidence site. */
    private String evidence(String fileId, Node node, String[] lines) {
        var range = node.getRange().orElseThrow();
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
    /**
     * Extracts every static relationship a type's source states about another indexed type:
     * <ul>
     *   <li>EXTENDS / IMPLEMENTS for classes, interfaces, records and enums;</li>
     *   <li>CALLS for method invocations and method references, from the enclosing method or constructor;</li>
     *   <li>CONSTRUCTS for {@code new T(..)}, targeting the resolved declared constructor (including a record's compact
     *       constructor) when there is one, otherwise the type; and for {@code T::new}, which always targets the type
     *       because the symbol solver cannot resolve constructor references;</li>
     *   <li>USES_TYPE for declared/used types: fields, parameters, return types, locals, generic arguments, casts,
     *       {@code instanceof}, class literals, throws/catch, annotations and static member access;</li>
     *   <li>one class-level DEPENDS_ON per (type, other type) pair summarizing all of the above, with every site as evidence.</li>
     * </ul>
     * Code outside a method or constructor (field initializers, initializer blocks, enum constant bodies) is owned
     * by the type itself; code in anonymous and local classes and lambdas belongs to the member that contains it.
     * A type constructing itself from such code is not an edge.
     * Type references resolve through the symbol solver, then deterministic Java name lookup (enclosing types,
     * single-type and single-static imports, same package, a unique on-demand import); only indexed targets become
     * edges, so JDK/library types add no noise. Method targets are never guessed: an unresolvable call (for example a
     * Lombok-generated getter) stays an UNRESOLVED CALLS occurrence, while its receiver's statically declared type
     * still yields the class-level DEPENDS_ON.
     */
    public void parseRelationships(File file, String workspaceId, String snapshotId) {
        try {
            String content = Files.readString(file.toPath());
            var result = new com.github.javaparser.JavaParser(StaticJavaParser.getParserConfiguration()).parse(content);
            if (!result.isSuccessful()) return;
            CompilationUnit cu = result.getResult().get();
            // No row: declaration indexing failed and was rolled back (already reported), so there is nothing to relate.
            List<String> fileIds = db.queryForList("SELECT id FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshotId, root.relativize(file.toPath().toAbsolutePath()).toString());
            if (fileIds.isEmpty()) return;
            String fileId = fileIds.get(0);
            String[] lines = content.split("\n", -1);
            Map<String, String> dependsOnByPair = new HashMap<>();
            Map<String, String> usesTypeByPair = new HashMap<>();
            Map<TypeDeclaration<?>, Owned> ownedByType = ownedByType(cu);
            for (TypeDeclaration<?> type : cu.findAll(TypeDeclaration.class)) {
                String owner = type.getFullyQualifiedName().orElse("");
                String ownerId = lookup(snapshotId, owner);
                if (ownerId == null) continue;
                Scope scope = new Scope(cu, snapshotId, owner, ownerId, fileId, lines, enclosingTypeNames(type));
                Owned owned = ownedByType.getOrDefault(type, new Owned());
                for (ClassOrInterfaceType t : extendedTypes(type)) supertype(scope, dependsOnByPair, t, "EXTENDS");
                for (ClassOrInterfaceType t : implementedTypes(type)) supertype(scope, dependsOnByPair, t, "IMPLEMENTS");

                for (MethodCallExpr call : owned.calls) {
                    String caller = sourceFor(scope, type, call);
                    String target = null;
                    String targetClass = null;
                    try {
                        var resolved = call.resolve();
                        targetClass = lookup(snapshotId, resolved.declaringType().getQualifiedName());
                        var ast = resolved.toAst();
                        if (ast.isPresent() && ast.get() instanceof MethodDeclaration declaration) {
                            target = lookup(snapshotId, methodName(resolved.declaringType().getQualifiedName(), declaration));
                        }
                        if (target == null) target = lookup(snapshotId, resolved.getQualifiedSignature().replace(", ", ","));
                    } catch (Exception ignored) { /* Never guess overloads or targets. */ }
                    if (targetClass == null) targetClass = call.getScope().map(receiver -> receiverType(scope, receiver)).orElse(null);
                    String ev = evidence(fileId, call, lines);
                    relationship(snapshotId, caller, target, call.toString(), "CALLS", ev);
                    dependsOn(scope, dependsOnByPair, targetClass, ev);
                }

                for (ObjectCreationExpr creation : owned.creations) {
                    String typeId = resolveType(scope, creation.getType());
                    if (typeId == null) continue;
                    String constructorId = null;
                    if (typesWithConstructors(snapshotId).contains(typeId)) try {
                        var resolved = creation.resolve();
                        String declaringType = resolved.declaringType().getQualifiedName();
                        Node ast = resolved.toAst().orElse(null);
                        if (ast instanceof ConstructorDeclaration declaration) constructorId = lookup(snapshotId, constructorName(declaringType, declaration));
                        else if (ast instanceof CompactConstructorDeclaration declaration) constructorId = lookup(snapshotId, compactConstructorName(declaringType, declaration));
                    } catch (Exception ignored) {
                        // The symbol solver cannot resolve record constructors ("Symbol resolution not configured"). A
                        // declared canonical constructor is still certain when no other constructor could take this
                        // many arguments. Otherwise (implicit/generated constructors) the type itself is the target.
                        CanonicalConstructor canonical = recordCanonicalConstructors.get(typeId);
                        if (canonical != null && canonical.arity() == creation.getArguments().size()) constructorId = canonical.id();
                    }
                    String ev = evidence(fileId, creation, lines);
                    String source = sourceFor(scope, type, creation), target = constructorId != null ? constructorId : typeId;
                    if (!source.equals(target)) relationship(snapshotId, source, target, null, "CONSTRUCTS", ev);
                    dependsOn(scope, dependsOnByPair, typeId, ev);
                }

                for (MethodReferenceExpr reference : owned.references) {
                    Expression receiver = reference.getScope();
                    String typeId = receiver instanceof TypeExpr typeExpr && typeExpr.getType() instanceof ClassOrInterfaceType named
                        ? resolveType(scope, named) : receiverType(scope, receiver);
                    if (typeId == null) continue;
                    String source = sourceFor(scope, type, reference);
                    String ev = evidence(fileId, reference, lines);
                    if ("new".equals(reference.getIdentifier())) {
                        // JavaParser cannot resolve constructor references, so T::new targets the type.
                        if (!source.equals(typeId)) relationship(snapshotId, source, typeId, null, "CONSTRUCTS", ev);
                    } else {
                        String target = null;
                        try {
                            var resolved = reference.resolve();
                            if (resolved.toAst().orElse(null) instanceof MethodDeclaration declaration) {
                                target = lookup(snapshotId, methodName(resolved.declaringType().getQualifiedName(), declaration));
                            }
                        } catch (Exception ignored) { /* Never guess overloads or targets. */ }
                        relationship(snapshotId, source, target, reference.toString(), "CALLS", ev);
                    }
                    dependsOn(scope, dependsOnByPair, typeId, ev);
                }

                for (ClassOrInterfaceType used : owned.types) {
                    if (!isTypeUse(used)) continue;
                    usesType(scope, type, usesTypeByPair, dependsOnByPair, used, resolveType(scope, used));
                }
                for (AnnotationExpr annotation : owned.annotations) {
                    usesType(scope, type, usesTypeByPair, dependsOnByPair, annotation, typeNamed(scope, annotation.getNameAsString()));
                }
                // Static member access through a type name: Status.ACTIVE, Limits.MAX, Outer.Inner.
                for (FieldAccessExpr access : owned.fieldAccesses) {
                    Expression receiver = access.getScope();
                    if (!(receiver instanceof NameExpr) && !(receiver instanceof FieldAccessExpr)) continue;
                    String typeId = typeNamed(scope, receiver.toString());
                    if (typeId == null || isValue(receiver)) continue;
                    usesType(scope, type, usesTypeByPair, dependsOnByPair, access, typeId);
                }
            }
        } catch (Exception e) { throw new IllegalStateException("Relationship indexing failed for " + file.getName(), e); }
    }

    /** Per-type extraction context. {@code lines} is the file content split once. */
    private record Scope(CompilationUnit cu, String snapshotId, String owner, String ownerId, String fileId, String[] lines, List<String> enclosingTypes) {}

    /** The nodes each extraction step reads, for one named type. */
    private static final class Owned {
        final List<MethodCallExpr> calls = new ArrayList<>();
        final List<ObjectCreationExpr> creations = new ArrayList<>();
        final List<MethodReferenceExpr> references = new ArrayList<>();
        final List<ClassOrInterfaceType> types = new ArrayList<>();
        final List<AnnotationExpr> annotations = new ArrayList<>();
        final List<FieldAccessExpr> fieldAccesses = new ArrayList<>();
    }

    /**
     * One pre-order traversal of the file, grouping every extracted node under its nearest named enclosing type
     * (nested named types own their own nodes). Identity keys: structurally equal type declarations are distinct.
     */
    private static Map<TypeDeclaration<?>, Owned> ownedByType(CompilationUnit cu) {
        Map<TypeDeclaration<?>, Owned> byType = new IdentityHashMap<>();
        cu.walk(node -> {
            if (!(node instanceof MethodCallExpr || node instanceof ObjectCreationExpr || node instanceof MethodReferenceExpr
                || node instanceof ClassOrInterfaceType || node instanceof AnnotationExpr || node instanceof FieldAccessExpr)) return;
            TypeDeclaration<?> type = enclosingType(node);
            if (type == null) return;
            Owned owned = byType.computeIfAbsent(type, t -> new Owned());
            switch (node) {
                case MethodCallExpr call -> owned.calls.add(call);
                case ObjectCreationExpr creation -> owned.creations.add(creation);
                case MethodReferenceExpr reference -> owned.references.add(reference);
                case ClassOrInterfaceType used -> owned.types.add(used);
                case AnnotationExpr annotation -> owned.annotations.add(annotation);
                case FieldAccessExpr access -> owned.fieldAccesses.add(access);
                default -> { }
            }
        });
        return byType;
    }

    /** EXTENDS/IMPLEMENTS from the type itself, also summarized by the class-level DEPENDS_ON with the same evidence. */
    private void supertype(Scope scope, Map<String, String> dependsOnByPair, ClassOrInterfaceType supertype, String kind) {
        String targetId = resolveType(scope, supertype);
        String ev = evidence(scope.fileId(), supertype, scope.lines());
        relationship(scope.snapshotId(), scope.ownerId(), targetId, supertype.asString(), kind, ev);
        dependsOn(scope, dependsOnByPair, targetId, ev);
    }

    /** Qualified names of {@code type} and each named type that lexically encloses it, innermost first. */
    private static List<String> enclosingTypeNames(TypeDeclaration<?> type) {
        List<String> names = new ArrayList<>();
        for (Node current = type; current != null; current = current.getParentNode().orElse(null)) {
            if (current instanceof TypeDeclaration<?> t) t.getFullyQualifiedName().ifPresent(names::add);
        }
        return names;
    }

    private static List<ClassOrInterfaceType> extendedTypes(TypeDeclaration<?> type) {
        return type instanceof ClassOrInterfaceDeclaration c ? c.getExtendedTypes() : List.of();
    }

    private static List<ClassOrInterfaceType> implementedTypes(TypeDeclaration<?> type) {
        if (type instanceof ClassOrInterfaceDeclaration c) return c.getImplementedTypes();
        if (type instanceof RecordDeclaration r) return r.getImplementedTypes();
        if (type instanceof EnumDeclaration e) return e.getImplementedTypes();
        return List.of();
    }

    /** Local classes have no qualified name and are not indexed, so their code belongs to the surrounding type. */
    private static TypeDeclaration<?> enclosingType(Node node) {
        Node current = node.getParentNode().orElse(null);
        while (current != null) {
            if (current instanceof TypeDeclaration<?> t && t.getFullyQualifiedName().isPresent()) return t;
            current = current.getParentNode().orElse(null);
        }
        return null;
    }

    /** The indexed member (method or constructor) directly inside {@code type} that contains {@code node}, else the type. */
    private String sourceFor(Scope scope, TypeDeclaration<?> type, Node node) {
        Node member = node;
        while (member.getParentNode().isPresent() && member.getParentNode().get() != type) member = member.getParentNode().get();
        String id = null;
        if (member instanceof MethodDeclaration m) id = lookup(scope.snapshotId(), methodName(scope.owner(), m));
        else if (member instanceof ConstructorDeclaration c) id = lookup(scope.snapshotId(), constructorName(scope.owner(), c));
        else if (member instanceof CompactConstructorDeclaration c) id = lookup(scope.snapshotId(), compactConstructorName(scope.owner(), c));
        return id != null ? id : scope.ownerId();
    }

    /** False for type nodes already represented by a more specific relationship or that are only a qualifier. */
    private static boolean isTypeUse(ClassOrInterfaceType type) {
        Node parent = type.getParentNode().orElse(null);
        if (parent instanceof ClassOrInterfaceType outer && outer.getScope().filter(s -> s == type).isPresent()) return false;
        if (parent instanceof ObjectCreationExpr creation && creation.getType() == type) return false;
        if (parent instanceof TypeExpr && parent.getParentNode().orElse(null) instanceof MethodReferenceExpr) return false;
        if (parent instanceof TypeDeclaration<?> declaration
            && (extendedTypes(declaration).stream().anyMatch(t -> t == type) || implementedTypes(declaration).stream().anyMatch(t -> t == type))) return false;
        return true;
    }

    /** One USES_TYPE occurrence per (member, target) in a file, with every further site attached as evidence. */
    private void usesType(Scope scope, TypeDeclaration<?> type, Map<String, String> usesTypeByPair, Map<String, String> dependsOnByPair, Node site, String targetId) {
        if (targetId == null || targetId.equals(scope.ownerId())) return;
        String source = sourceFor(scope, type, site);
        String ev = evidence(scope.fileId(), site, scope.lines());
        String key = source + "->" + targetId;
        String existing = usesTypeByPair.get(key);
        if (existing == null) usesTypeByPair.put(key, relationship(scope.snapshotId(), source, targetId, null, "USES_TYPE", ev));
        else db.update("INSERT INTO relationship_evidence VALUES (?, ?)", existing, ev);
        dependsOn(scope, dependsOnByPair, targetId, ev);
    }

    private void dependsOn(Scope scope, Map<String, String> dependsOnByPair, String targetClass, String ev) {
        if (targetClass == null || targetClass.equals(scope.ownerId())) return;
        String pairKey = scope.ownerId() + "->" + targetClass;
        String dependsOnId = dependsOnByPair.get(pairKey);
        if (dependsOnId == null) dependsOnByPair.put(pairKey, relationship(scope.snapshotId(), scope.ownerId(), targetClass, null, "DEPENDS_ON", ev));
        else db.update("INSERT INTO relationship_evidence VALUES (?, ?)", dependsOnId, ev);
    }

    /** The indexed type of a call/reference receiver: its statically declared type, or a type name for static access. */
    private String receiverType(Scope scope, Expression receiver) {
        try {
            var resolved = receiver.calculateResolvedType();
            if (!resolved.isReferenceType()) return null;
            String qualified = resolved.asReferenceType().getQualifiedName();
            if (receiver instanceof NameExpr name && namesUnresolvableVariable(name, qualified)) return null;
            return lookup(scope.snapshotId(), qualified);
        } catch (Exception ignored) { /* Not a resolvable value: may be a type name. */ }
        if (receiver instanceof NameExpr || receiver instanceof FieldAccessExpr) {
            String typeId = typeNamed(scope, receiver.toString());
            return typeId == null || isValue(receiver) ? null : typeId;
        }
        return null;
    }

    /**
     * The symbol solver finds a variable (seen with catch parameters and pattern variables) whose declared type it
     * cannot resolve, then reports the type named like the variable instead. Such a receiver has no known type.
     */
    private static boolean namesUnresolvableVariable(NameExpr name, String resolvedType) {
        if (!resolvedType.equals(name.getNameAsString()) && !resolvedType.endsWith("." + name.getNameAsString())) return false;
        try { name.resolve().getType(); return false; }
        catch (Exception e) { return true; }
    }

    /**
     * True when a simple or qualified name starts with a variable in scope rather than a type name: a parameter
     * (method, constructor, lambda, record component, catch), a local declared earlier in an enclosing block or in a
     * for/for-each/try-with-resources header, a pattern variable declared earlier in the member, or a field declared
     * by an enclosing type. Only called after the symbol solver failed; fields inherited from a supertype are not
     * visible here.
     */
    private static boolean isValue(Expression expression) {
        Expression rootName = expression;
        while (rootName instanceof FieldAccessExpr access) rootName = access.getScope();
        if (!(rootName instanceof NameExpr name)) return false;
        String identifier = name.getNameAsString();
        Node child = rootName;
        for (Node current = rootName.getParentNode().orElse(null); current != null; child = current, current = current.getParentNode().orElse(null)) {
            if (current instanceof com.github.javaparser.ast.nodeTypes.NodeWithParameters<?> callable
                && callable.getParameters().stream().anyMatch(p -> p.getNameAsString().equals(identifier))) return true;
            if (current instanceof CatchClause clause && clause.getParameter().getNameAsString().equals(identifier)) return true;
            if (current instanceof BlockStmt block && declaredBefore(block.getStatements(), child, identifier)) return true;
            if (current instanceof SwitchEntry entry && declaredBefore(entry.getStatements(), child, identifier)) return true;
            if (current instanceof ForStmt loop && loop.getInitialization().stream().anyMatch(init -> declares(init, identifier))) return true;
            if (current instanceof ForEachStmt loop && declares(loop.getVariable(), identifier)) return true;
            if (current instanceof TryStmt attempt && attempt.getResources().stream().anyMatch(resource -> declares(resource, identifier))) return true;
            if ((current instanceof CallableDeclaration<?> || current instanceof LambdaExpr || current instanceof InitializerDeclaration)
                && current.findAll(TypePatternExpr.class).stream().anyMatch(p -> p.getNameAsString().equals(identifier) && before(p, name))) return true;
            if (current instanceof TypeDeclaration<?> t && t.getFields().stream().anyMatch(f -> f.getVariables().stream().anyMatch(v -> v.getNameAsString().equals(identifier)))) return true;
        }
        return false;
    }

    /** A local variable declared by one of {@code statements} that precedes {@code child}, the statement being checked. */
    private static boolean declaredBefore(List<Statement> statements, Node child, String identifier) {
        for (Statement statement : statements) {
            if (statement == child) return false;
            if (statement instanceof ExpressionStmt expression && declares(expression.getExpression(), identifier)) return true;
        }
        return false;
    }

    private static boolean declares(Expression expression, String identifier) {
        return expression instanceof VariableDeclarationExpr declaration
            && declaration.getVariables().stream().anyMatch(v -> v.getNameAsString().equals(identifier));
    }

    private static boolean before(Node earlier, Node later) {
        return earlier.getBegin().isPresent() && later.getBegin().isPresent() && earlier.getBegin().get().isBefore(later.getBegin().get());
    }

    private String resolveType(Scope scope, ClassOrInterfaceType type) {
        if (!indexedTypeNames(scope.snapshotId()).contains(type.getNameAsString())) return null;
        try { return lookup(scope.snapshotId(), type.resolve().asReferenceType().getQualifiedName()); }
        catch (Exception ignored) { return typeNamed(scope, type.getNameWithScope()); }
    }

    /**
     * Deterministic Java name lookup for a type written as {@code Name} or {@code Outer.Inner}: member types of the
     * enclosing types, then a single-type or single-static import, then the same package, then an on-demand (or
     * static on-demand) import that matches exactly one indexed type. Returns null rather than choosing between
     * candidates. A unique indexed on-demand match is safe even when unindexed packages are also imported on demand:
     * on-demand imports never shadow one another (JLS 6.4.1), so a name two of them provide would not compile.
     */
    private String typeNamed(Scope scope, String name) {
        String snap = scope.snapshotId();
        String first = name.contains(".") ? name.substring(0, name.indexOf('.')) : name;
        String rest = name.substring(first.length());
        // Whatever this resolves to has the last segment as its simple name; unindexed names cost nothing.
        if (!indexedTypeNames(snap).contains(name.substring(name.lastIndexOf('.') + 1))) return null;
        if (name.contains(".")) {
            String qualified = lookup(snap, name);
            if (qualified != null) return qualified;
        }
        for (String outer : scope.enclosingTypes()) {
            String id = lookup(snap, outer + "." + name);
            if (id != null) return id;
            if (outer.endsWith("." + first)) { id = lookup(snap, outer + rest); if (id != null) return id; }
        }
        CompilationUnit cu = scope.cu();
        for (var imp : cu.getImports()) {
            if (imp.isAsterisk() || !imp.getNameAsString().endsWith("." + first)) continue;
            String id = lookup(snap, imp.getNameAsString() + rest);
            // A single-type import decides the name. A single-static import may name a field or method instead of a
            // member type (a separate namespace), so it only decides the name when it is an indexed type.
            if (!imp.isStatic() || id != null) return id;
        }
        String samePackage = lookup(snap, cu.getPackageDeclaration().map(p -> p.getNameAsString() + ".").orElse("") + name);
        if (samePackage != null) return samePackage;
        Set<String> onDemand = new HashSet<>();
        for (var imp : cu.getImports()) {
            // Static on-demand imports also import member types (JLS 7.5.4).
            if (imp.isAsterisk()) { String id = lookup(snap, imp.getNameAsString() + "." + name); if (id != null) onDemand.add(id); }
        }
        return onDemand.size() == 1 ? onDemand.iterator().next() : null;
    }

    /** Types that declare at least one indexed constructor; creating any other type can only target the type itself. */
    private Set<String> typesWithConstructors(String snap) {
        return typesWithConstructors.computeIfAbsent(snap, s -> new HashSet<>(db.queryForList(
            "SELECT DISTINCT parent_symbol_id FROM symbol_versions WHERE snapshot_id = ? AND kind = 'CONSTRUCTOR'", String.class, s)));
    }

    /** Simple names of every indexed type in the snapshot: a cheap pre-filter so JDK/library names skip resolution. */
    private Set<String> indexedTypeNames(String snap) {
        return indexedTypeNames.computeIfAbsent(snap, s -> new HashSet<>(db.queryForList(
            "SELECT DISTINCT simple_name FROM symbol_versions WHERE snapshot_id = ? AND kind IN ('CLASS','INTERFACE','ENUM','RECORD','ANNOTATION')", String.class, s)));
    }

    /** Drops the per-run lookup caches once an analysis run ends, so they do not outlive it. */
    public void releaseRunCaches() {
        relationshipLookups.clear();
        indexedTypeNames.clear();
        typesWithConstructors.clear();
        recordCanonicalConstructors.clear();
    }

    /** Relationship-pass symbol lookup. All declarations exist before this pass starts, so results are cached per run. */
    private String lookup(String snap, String qname) {
        return relationshipLookups.computeIfAbsent(snap + "|" + qname, key -> Optional.ofNullable(getSymbolId(snap, qname))).orElse(null);
    }

    private String getSymbolId(String snap, String qname) {
        var ids = db.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?", String.class, snap, qname);
        return ids.size() == 1 ? ids.get(0) : null;
    }
}
