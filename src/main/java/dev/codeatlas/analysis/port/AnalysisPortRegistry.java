package dev.codeatlas.analysis.port;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Registry for shipped language adapters.
 *
 * <p>The registry deliberately keys adapters by normalized strings rather than closed enums: a
 * language, and inside it an indexing engine (ADR 0012). Adding a language or an engine therefore
 * does not require changing the language-neutral orchestration code. A workspace still selects
 * exactly one registered language and one of its engines; unknown or blank values fail before an
 * analysis snapshot is created.</p>
 */
@Component
public class AnalysisPortRegistry {

    /** What the import screen needs to offer an engine honestly. */
    public record IndexerDescriptor(String language, String indexer, String label, boolean defaultIndexer,
                                    boolean executesTargetBuild, boolean available, String unavailableReason,
                                    boolean providesNavigation) {}

    private final Map<String, Map<String, AnalysisPort>> ports;
    private final Map<String, AnalysisPort> defaults;

    public AnalysisPortRegistry(List<AnalysisPort> ports) {
        Map<String, Map<String, AnalysisPort>> registered = new LinkedHashMap<>();
        Map<String, AnalysisPort> defaultPorts = new LinkedHashMap<>();
        for (AnalysisPort port : ports) {
            if (port == null || port.language() == null || port.language().isBlank()) {
                throw new IllegalArgumentException("An analysis port must declare a language");
            }
            String language = normalize(port.language());
            String indexer = indexerOf(port);
            AnalysisPort previous = registered.computeIfAbsent(language, ignored -> new LinkedHashMap<>()).putIfAbsent(indexer, port);
            if (previous != null) {
                throw new IllegalArgumentException("Multiple analysis ports registered for language " + language + " and indexer " + indexer);
            }
            if (port.defaultIndexer() && defaultPorts.putIfAbsent(language, port) != null) {
                throw new IllegalArgumentException("Multiple default indexers registered for language: " + language);
            }
        }
        // A language whose only engines do not claim to be the default still gets one: its first.
        registered.forEach((language, byIndexer) -> defaultPorts.putIfAbsent(language, byIndexer.values().iterator().next()));
        registered.replaceAll((language, byIndexer) -> Collections.unmodifiableMap(byIndexer));
        this.ports = Collections.unmodifiableMap(registered);
        this.defaults = Collections.unmodifiableMap(defaultPorts);
    }

    /** Return the default adapter registered for {@code language}, or fail with an actionable message. */
    public AnalysisPort require(String language) {
        String normalized = normalize(language);
        AnalysisPort port = defaults.get(normalized);
        if (port == null) {
            throw new IllegalArgumentException("No analysis adapter is available for language '" + language + "'. "
                    + "Choose one of: " + String.join(", ", ports.keySet()));
        }
        return port;
    }

    /**
     * Return the {@code indexer} engine of {@code language}; a blank indexer means the language's
     * default engine. Unknown engines fail with the engines that do exist.
     */
    public AnalysisPort require(String language, String indexer) {
        AnalysisPort languageDefault = require(language);
        if (indexer == null || indexer.isBlank()) return languageDefault;
        Map<String, AnalysisPort> engines = ports.get(normalize(language));
        AnalysisPort port = engines.get(normalizeIndexer(indexer));
        if (port == null) {
            throw new IllegalArgumentException("No '" + indexer + "' indexer is available for language '" + language + "'. "
                    + "Choose one of: " + String.join(", ", engines.keySet()));
        }
        return port;
    }

    /** Languages whose adapters are actually shipped and therefore safe to offer to callers. */
    public Set<String> supportedLanguages() {
        return ports.keySet();
    }

    /** Every shipped engine, grouped by language in registration order, with its current availability. */
    public List<IndexerDescriptor> indexers() {
        List<IndexerDescriptor> result = new ArrayList<>();
        for (Map<String, AnalysisPort> engines : ports.values()) {
            for (AnalysisPort port : engines.values()) {
                String reason = port.unavailableReason().orElse(null);
                result.add(new IndexerDescriptor(normalize(port.language()), indexerOf(port), port.indexerLabel(),
                        defaults.get(normalize(port.language())) == port, port.executesTargetBuild(), reason == null, reason,
                        port.providesNavigation()));
            }
        }
        return result;
    }

    /**
     * The engine a snapshot recorded, when it is still registered. Unlike {@link #require(String, String)} this
     * never throws: a snapshot can outlive the engine that produced it. A blank indexer is the language's default.
     */
    public java.util.Optional<AnalysisPort> find(String language, String indexer) {
        if (language == null || language.isBlank()) return java.util.Optional.empty();
        Map<String, AnalysisPort> engines = ports.get(normalize(language));
        if (engines == null) return java.util.Optional.empty();
        if (indexer == null || indexer.isBlank()) return java.util.Optional.ofNullable(defaults.get(normalize(language)));
        return java.util.Optional.ofNullable(engines.get(normalizeIndexer(indexer)));
    }

    /** Labels of the engines of {@code language} that provide source navigation, default first. */
    public List<String> navigationIndexerLabels(String language) {
        if (language == null || language.isBlank() || !ports.containsKey(normalize(language))) return List.of();
        List<String> labels = new ArrayList<>();
        for (String id : indexers(language)) {
            AnalysisPort port = ports.get(normalize(language)).get(id);
            if (port.providesNavigation()) labels.add(port.indexerLabel());
        }
        return labels;
    }

    /** Engine ids of one language, default first. */
    public Set<String> indexers(String language) {
        Set<String> ids = new LinkedHashSet<>();
        ids.add(indexerOf(require(language)));
        ids.addAll(ports.get(normalize(language)).keySet());
        return ids;
    }

    /** Normalize persisted/API language values without broadening the set of supported values. */
    public static String normalize(String language) {
        if (language == null || language.isBlank()) {
            throw new IllegalArgumentException("Workspace language must not be blank");
        }
        return language.trim().toLowerCase(Locale.ROOT);
    }

    /** The normalized engine id a port is registered under; a port without one is its language's engine. */
    public static String indexerOf(AnalysisPort port) {
        String indexer = port.indexer();
        return indexer == null || indexer.isBlank() ? normalize(port.language()) : normalizeIndexer(indexer);
    }

    private static String normalizeIndexer(String indexer) {
        return indexer.trim().toLowerCase(Locale.ROOT);
    }
}
