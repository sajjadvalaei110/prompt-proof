package dev.codeatlas.analysis;

import dev.codeatlas.analysis.port.AnalysisPort;
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
    /** Source-only engine id; the default Java engine (ADR 0012). */
    public static final String INDEXER = "javaparser";

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
    public String indexer() {
        return INDEXER;
    }

    @Override
    public String indexerLabel() {
        return "JavaParser (source only)";
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
        return SpringFrameworkPass.run(springAnalyzer, files, workspaceId, snapshotId, completedFileCount, parser::addDiagnostic);
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
