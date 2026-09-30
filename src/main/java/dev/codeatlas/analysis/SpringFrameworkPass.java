package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.IntConsumer;

/**
 * The source-only Spring enrichment pass shared by every Java engine (ADR 0012): stereotypes, routes and beans
 * first, then injections, which need every component and {@code @Bean} declaration to exist. It finds the graph
 * symbols it annotates by qualified name, parent and line, which both Java engines store the same way.
 */
final class SpringFrameworkPass {

    private static final Logger log = LoggerFactory.getLogger(SpringFrameworkPass.class);

    private SpringFrameworkPass() { }

    static int run(SpringAnnotationAnalyzer springAnalyzer, List<File> files, String workspaceId, String snapshotId,
                   IntConsumer completedFileCount, Consumer<String> diagnostics) {
        List<SpringAnnotationAnalyzer.SpringAnalysisResult> results = new ArrayList<>();
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
                diagnostics.accept(file.getName() + ": Spring annotation analysis skipped.");
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
}
