package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.expr.MethodCallExpr;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import java.io.File;
import java.util.UUID;
import java.nio.file.Files;

@Component
public class JavaParserAdapter {
    private final JdbcTemplate jdbcTemplate;

    public JavaParserAdapter(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void setupSymbolSolver(String workspacePath) {
        CombinedTypeSolver combinedTypeSolver = new CombinedTypeSolver();
        combinedTypeSolver.add(new ReflectionTypeSolver());
        StaticJavaParser.getParserConfiguration().setSymbolResolver(new JavaSymbolSolver(combinedTypeSolver));
    }

    public void parseDeclarations(File file, String workspaceId, String snapshotId) {
        try {
            String content = Files.readString(file.toPath());
            String fileVersionId = UUID.randomUUID().toString();
            jdbcTemplate.update(
                "INSERT OR IGNORE INTO source_file_versions (id, snapshot_id, relative_path, content_hash, source_content) VALUES (?, ?, ?, ?, ?)",
                fileVersionId, snapshotId, file.getAbsolutePath(), "dummy_hash", content
            );

            CompilationUnit cu = StaticJavaParser.parse(file);
            String pkgName = cu.getPackageDeclaration().map(pd -> pd.getNameAsString()).orElse("default");
            
            // Insert package symbol
            jdbcTemplate.update("INSERT OR IGNORE INTO logical_symbols (workspace_id, key) VALUES (?, ?)", workspaceId, pkgName);
            String pkgVersionId = UUID.randomUUID().toString();
            jdbcTemplate.update(
                "INSERT OR IGNORE INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, content_hash) VALUES (?, ?, ?, ?, 'PACKAGE', ?, ?, ?)",
                pkgVersionId, snapshotId, pkgName, workspaceId, pkgName, pkgName, "dummy_hash"
            );
            
            // Since INSERT OR IGNORE might have ignored, we need to get the package id
            final String finalPkgVersionId = getSymbolId(snapshotId, pkgName);

            cu.findAll(ClassOrInterfaceDeclaration.class).forEach(cid -> {
                String qualifiedName = cid.getFullyQualifiedName().orElse(cid.getNameAsString());
                jdbcTemplate.update("INSERT OR IGNORE INTO logical_symbols (workspace_id, key) VALUES (?, ?)", workspaceId, qualifiedName);
                
                String classVersionId = UUID.randomUUID().toString();
                String kind = cid.isInterface() ? "INTERFACE" : "CLASS";
                
                jdbcTemplate.update(
                    "INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, parent_symbol_id, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    classVersionId, snapshotId, qualifiedName, workspaceId, kind, qualifiedName, cid.getNameAsString(), finalPkgVersionId, "dummy_hash"
                );
                
                cid.getMethods().forEach(m -> {
                    String methodQName = qualifiedName + "." + m.getNameAsString();
                    jdbcTemplate.update("INSERT OR IGNORE INTO logical_symbols (workspace_id, key) VALUES (?, ?)", workspaceId, methodQName);
                    
                    jdbcTemplate.update(
                        "INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, parent_symbol_id, content_hash) VALUES (?, ?, ?, ?, 'METHOD', ?, ?, ?, ?)",
                        UUID.randomUUID().toString(), snapshotId, methodQName, workspaceId, methodQName, m.getNameAsString(), classVersionId, "dummy_hash"
                    );
                });
            });
        } catch (Exception e) {
            System.err.println("Parse failed for " + file.getName());
        }
    }

    public void parseRelationships(File file, String workspaceId, String snapshotId) {
        try {
            CompilationUnit cu = StaticJavaParser.parse(file);
            cu.findAll(ClassOrInterfaceDeclaration.class).forEach(cid -> {
                String callerClassQName = cid.getFullyQualifiedName().orElse(cid.getNameAsString());
                String callerClassId = getSymbolId(snapshotId, callerClassQName);
                
                if (callerClassId == null) return;
                
                cid.findAll(MethodCallExpr.class).forEach(call -> {
                    String calleeSimple = call.getNameAsString();
                    String calleeQName = null;
                    String calleeClassQName = null;
                    try {
                        var resolved = call.resolve();
                        calleeQName = resolved.getQualifiedSignature();
                        calleeClassQName = resolved.declaringType().getQualifiedName();
                    } catch (Exception ex) {
                        calleeQName = "unresolved." + calleeSimple;
                    }
                    
                    String calleeId = getSymbolId(snapshotId, calleeQName);
                    String calleeClassId = calleeClassQName != null ? getSymbolId(snapshotId, calleeClassQName) : null;
                    
                    String relId = UUID.randomUUID().toString();
                    if (calleeId != null) {
                        jdbcTemplate.update(
                            "INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, kind, resolution) VALUES (?, ?, ?, ?, 'CALLS', 'RESOLVED')",
                            relId, snapshotId, callerClassId, calleeId
                        );
                        if (calleeClassId != null && !calleeClassId.equals(callerClassId)) {
                            // DEPENDS_ON aggregate relationship
                            jdbcTemplate.update(
                                "INSERT OR IGNORE INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, kind, resolution) VALUES (?, ?, ?, ?, 'DEPENDS_ON', 'RESOLVED')",
                                UUID.randomUUID().toString(), snapshotId, callerClassId, calleeClassId
                            );
                        }
                    } else {
                        jdbcTemplate.update(
                            "INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, unresolved_target, kind, resolution) VALUES (?, ?, ?, ?, 'CALLS', 'UNRESOLVED')",
                            relId, snapshotId, callerClassId, calleeQName
                        );
                    }
                });
            });
        } catch (Exception e) {
            System.err.println("Rel parse failed for " + file.getName());
        }
    }
    
    private String getSymbolId(String snapshotId, String qualifiedName) {
        try {
            return jdbcTemplate.queryForObject("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ? LIMIT 1", String.class, snapshotId, qualifiedName);
        } catch (Exception e) {
            return null;
        }
    }
}
