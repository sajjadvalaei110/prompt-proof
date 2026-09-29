package dev.codeatlas.analysis.port;

import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Registry for shipped language adapters.
 *
 * <p>The registry deliberately keys adapters by a normalized string rather than a closed enum.
 * Adding a language therefore does not require changing the language-neutral orchestration code.
 * A workspace still selects exactly one registered language; unknown or blank values fail before
 * an analysis snapshot is created.</p>
 */
@Component
public class AnalysisPortRegistry {

    private final Map<String, AnalysisPort> ports;

    public AnalysisPortRegistry(List<AnalysisPort> ports) {
        Map<String, AnalysisPort> registered = new LinkedHashMap<>();
        for (AnalysisPort port : ports) {
            if (port == null || port.language() == null || port.language().isBlank()) {
                throw new IllegalArgumentException("An analysis port must declare a language");
            }
            String language = normalize(port.language());
            AnalysisPort previous = registered.putIfAbsent(language, port);
            if (previous != null) {
                throw new IllegalArgumentException("Multiple analysis ports registered for language: " + language);
            }
        }
        this.ports = Collections.unmodifiableMap(registered);
    }

    /** Return the adapter registered for {@code language}, or fail with an actionable message. */
    public AnalysisPort require(String language) {
        String normalized = normalize(language);
        AnalysisPort port = ports.get(normalized);
        if (port == null) {
            throw new IllegalArgumentException("No analysis adapter is available for language '" + language + "'. "
                    + "Choose one of: " + String.join(", ", ports.keySet()));
        }
        return port;
    }

    /** Languages whose adapters are actually shipped and therefore safe to offer to callers. */
    public Set<String> supportedLanguages() {
        return ports.keySet();
    }

    /** Normalize persisted/API language values without broadening the set of supported values. */
    public static String normalize(String language) {
        if (language == null || language.isBlank()) {
            throw new IllegalArgumentException("Workspace language must not be blank");
        }
        return language.trim().toLowerCase(Locale.ROOT);
    }
}
