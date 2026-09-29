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
}
