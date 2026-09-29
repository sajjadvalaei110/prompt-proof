package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import dev.codeatlas.analysis.port.AnalysisPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.util.List;

/**
 * Java/JavaParser adapter for the language-neutral analysis port.
 *
 * <p>The existing {@link JavaParserAdapter} remains the implementation of Java parsing, symbol
 * resolution, relationship extraction, and evidence coordinate calculation. This class is a
 * deliberately thin adapter so Phase 1 changes the seam and dispatch, not Java graph behavior.</p>
 */
@Component
public final class JavaAnalysisAdapter implements AnalysisPort {

    public static final String LANGUAGE = "java";
    private static final Logger log = LoggerFactory.getLogger(JavaAnalysisAdapter.class);

    private final JavaParserAdapter parser;
    private final SpringAnnotationAnalyzer springAnalyzer;

    public JavaAnalysisAdapter(JavaParserAdapter parser, SpringAnnotationAnalyzer springAnalyzer) {
        this.parser = parser;
        this.springAnalyzer = springAnalyzer;
    }

    @Override
    public String language() {
        return LANGUAGE;
    }

    @Override
    public List<File> discoverFiles(File root) throws IOException {
        return SourceDiscoveryService.discover(root, ".java");
    }

    @Override
    public void prepare(String workspacePath) {
        parser.setupSymbolSolver(workspacePath);
    }

    @Override
    public void prepare(String capturedPath, java.nio.file.Path workspaceRoot) {
        parser.setupSymbolSolver(capturedPath, workspaceRoot);
    }

    @Override
    public void linkRelationships(String snapshotId) {
        parser.linkOverrides(snapshotId);
    }

    @Override
    public void parseDeclarations(File file, String workspaceId, String snapshotId) {
        parser.parseDeclarations(file, workspaceId, snapshotId);
    }

    @Override
    public void parseRelationships(File file, String workspaceId, String snapshotId) {
        parser.parseRelationships(file, workspaceId, snapshotId);
    }

    @Override
    public boolean supportsFrameworkPass() {
        return true;
    }

    @Override
    public int runFrameworkPass(List<File> files, String workspaceId, String snapshotId,
                                java.util.function.IntConsumer completedFileCount) {
        List<SpringAnnotationAnalyzer.SpringAnalysisResult> results = new java.util.ArrayList<>();
        int filesWithFacts = 0;
        int processed = 0;
        for (File file : files) {
            try {
                CompilationUnit unit = StaticJavaParser.parse(file);
                SpringAnnotationAnalyzer.SpringAnalysisResult result = springAnalyzer.analyze(unit);
                if (!result.isEmpty()) {
                    results.add(result);
                    filesWithFacts++;
                }
            } catch (Exception e) {
                log.debug("Spring analysis skipped for {}: {}", file.getName(), e.getMessage());
                parser.addDiagnostic(file.getName() + ": Spring annotation analysis skipped.");
            } finally {
                completedFileCount.accept(++processed);
            }
        }

        // Injection resolution needs all component and @Bean declarations to exist first.
        for (SpringAnnotationAnalyzer.SpringAnalysisResult result : results) {
            springAnalyzer.persistRolesRoutesBeans(snapshotId, workspaceId, result);
        }
        for (SpringAnnotationAnalyzer.SpringAnalysisResult result : results) {
            springAnalyzer.persistInjections(snapshotId, result);
        }
        return filesWithFacts;
    }

    @Override
    public List<String> diagnostics() {
        return parser.diagnostics();
    }

    @Override
    public void addDiagnostic(String message) {
        parser.addDiagnostic(message);
    }

    @Override
    public void releaseRunCaches() {
        parser.releaseRunCaches();
    }
}
