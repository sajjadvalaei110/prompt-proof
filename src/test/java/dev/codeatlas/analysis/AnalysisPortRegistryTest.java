package dev.codeatlas.analysis;

import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AnalysisPortRegistryTest {
    @Test void normalizedLanguageSelectsOnlyItsRegisteredAdapter() throws Exception {
        AnalysisPort java = mock(AnalysisPort.class), other = mock(AnalysisPort.class);
        when(java.language()).thenReturn("java");
        when(other.language()).thenReturn("fixture-language");
        var registry = new AnalysisPortRegistry(List.of(java, other));
        assertSame(other, registry.require(" FIXTURE-LANGUAGE "));
        assertEquals(Set.of("java", "fixture-language"), registry.supportedLanguages());
        verify(java, never()).discoverFiles(any());
        verify(other, never()).discoverFiles(any());
        assertThrows(IllegalArgumentException.class, () -> registry.require("missing"));
        assertThrows(IllegalArgumentException.class, () -> registry.require(" "));
    }

    @Test void duplicateNormalizedLanguageCannotSilentlyReplaceAnAdapter() {
        AnalysisPort first = mock(AnalysisPort.class), second = mock(AnalysisPort.class);
        when(first.language()).thenReturn("java");
        when(second.language()).thenReturn(" JAVA ");
        assertThrows(IllegalArgumentException.class, () -> new AnalysisPortRegistry(List.of(first, second)));
    }

    @Test void aLanguageCanShipSeveralEnginesWithOneDefault() {
        AnalysisPort source = mock(AnalysisPort.class), build = mock(AnalysisPort.class);
        when(source.language()).thenReturn("java");
        when(source.indexer()).thenReturn("javaparser");
        when(source.defaultIndexer()).thenReturn(true);
        when(build.language()).thenReturn("java");
        when(build.indexer()).thenReturn("scip-java");
        when(build.defaultIndexer()).thenReturn(false);
        when(build.executesTargetBuild()).thenReturn(true);
        when(build.unavailableReason()).thenReturn(java.util.Optional.of("not installed"));
        when(source.unavailableReason()).thenReturn(java.util.Optional.empty());
        var registry = new AnalysisPortRegistry(List.of(build, source));

        assertSame(source, registry.require("java"));
        assertSame(source, registry.require("java", null));
        assertSame(source, registry.require("java", " "));
        assertSame(build, registry.require("JAVA", " Scip-Java "));
        assertThrows(IllegalArgumentException.class, () -> registry.require("java", "missing"));
        assertEquals(List.of("javaparser", "scip-java"), List.copyOf(registry.indexers("java")));
        var descriptors = registry.indexers();
        assertEquals(2, descriptors.size());
        var scip = descriptors.stream().filter(d -> d.indexer().equals("scip-java")).findFirst().orElseThrow();
        assertFalse(scip.available());
        assertTrue(scip.executesTargetBuild());
        assertFalse(scip.defaultIndexer());
        assertEquals("not installed", scip.unavailableReason());
    }

    @Test void duplicateEnginesAndTwoDefaultsAreRejected() {
        AnalysisPort first = mock(AnalysisPort.class), second = mock(AnalysisPort.class);
        when(first.language()).thenReturn("java");
        when(second.language()).thenReturn("java");
        when(first.indexer()).thenReturn("a");
        when(second.indexer()).thenReturn(" A ");
        assertThrows(IllegalArgumentException.class, () -> new AnalysisPortRegistry(List.of(first, second)));
        when(second.indexer()).thenReturn("b");
        when(first.defaultIndexer()).thenReturn(true);
        when(second.defaultIndexer()).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> new AnalysisPortRegistry(List.of(first, second)));
    }
}
