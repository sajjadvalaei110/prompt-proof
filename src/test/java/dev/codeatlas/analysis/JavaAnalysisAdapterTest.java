package dev.codeatlas.analysis;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class JavaAnalysisAdapterTest {
    @TempDir Path directory;

    @Test
    void malformedSourceIsSkippedWithVisibleFrameworkWarningAndProgress() throws Exception {
        Path malformedSource = directory.resolve("Malformed.java");
        Files.writeString(malformedSource, "class Malformed { void broken( {");

        JavaParserAdapter parser = mock(JavaParserAdapter.class);
        SpringAnnotationAnalyzer springAnalyzer = mock(SpringAnnotationAnalyzer.class);
        List<String> diagnostics = new ArrayList<>();
        doAnswer(invocation -> {
            diagnostics.add(invocation.getArgument(0));
            return null;
        }).when(parser).addDiagnostic(anyString());
        when(parser.diagnostics()).thenAnswer(invocation -> List.copyOf(diagnostics));
        JavaAnalysisAdapter adapter = new JavaAnalysisAdapter(parser, springAnalyzer);
        List<Integer> completedCounts = new ArrayList<>();

        int filesWithFrameworkFacts = adapter.runFrameworkPass(
                List.of(malformedSource.toFile()), "workspace", "snapshot", completedCounts::add);

        assertEquals(0, filesWithFrameworkFacts);
        assertEquals(List.of(1), completedCounts);
        assertEquals(List.of("Malformed.java: Spring annotation analysis skipped."), adapter.diagnostics());
        verify(parser).addDiagnostic("Malformed.java: Spring annotation analysis skipped.");
        verifyNoInteractions(springAnalyzer);
    }
}
