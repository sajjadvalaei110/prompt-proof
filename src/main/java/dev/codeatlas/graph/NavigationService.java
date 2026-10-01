package dev.codeatlas.graph;

import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;

/**
 * Source navigation over the occurrence index ({@code code_occurrences}, ADR 0012/0013): the occurrences of one
 * file and go to definition. The contract is language-neutral -- paths, positions, opaque engine symbol keys --
 * so any engine that fills the index lights it up. Whether a snapshot can answer is the declared capability of
 * the engine that produced it ({@link AnalysisPort#providesNavigation()}), never its language or engine name.
 * Positions use the evidence convention: 1-based lines, 1-based start and inclusive end columns, in UTF-16 code
 * units.
 *
 * <p>A review's after-change (head) snapshot is captured from the working tree and analyzed by the source-only
 * default engine, which never runs a build. Its navigation is served from the workspace's active snapshot instead
 * (ADR 0014), file by file, and only where that file's stored text is identical in both (equal
 * {@code content_hash} at the same workspace-relative path), so every position means the same thing in both.
 * Otherwise the answer is {@code stale}. Responses name the snapshot that answered ({@code servedFrom}).</p>
 */
@Service
public class NavigationService {

    /** Rows returned for one file before the response is marked truncated (ADR 0013). */
    static final int MAX_FILE_OCCURRENCES = 50_000;
    private static final int SYMBOL_BATCH = 500;

    /**
     * {@code snapshotId} is the snapshot to open the location in: the requested snapshot, or for a review head, the
     * head itself when its copy of that file is identical to the answering snapshot's, else the answering snapshot
     * with {@code differsFromChange} set (ADR 0014).
     */
    public record Location(String path, int startLine, int startColumn, int endLine, int endColumn,
                           String displayName, String signature, String symbolId, String snapshotId, boolean differsFromChange) {}

    /** The snapshot whose occurrence index answered, and a display label for it. */
    public record ServedFrom(String snapshotId, String label) {}

    /**
     * {@code status}: {@code found} (one or more definitions in this snapshot), {@code external} (the engine resolved
     * the name to something outside the workspace, such as a standard library, a dependency or another module),
     * {@code no_symbol} (no resolved name at that position) or {@code not_indexed} (this snapshot's engine provides
     * no navigation). For a review head it may also be {@code stale}: the file differs from (or is missing in) the
     * snapshot that would answer, so it must be re-analyzed first. {@code indexer}, {@code indexerLabel} and
     * {@code navigationIndexers} (labels of this language's engines that do provide navigation) let a client
     * explain {@code not_indexed} from data. {@code servedFrom} is null when no snapshot answered.
     */
    public record Definition(String schemaVersion, String status, String symbol, List<Location> locations,
                             String indexer, String indexerLabel, List<String> navigationIndexers, ServedFrom servedFrom) {}

    /** One entry of a file's symbol table: how many definitions the snapshot has (0 = external) and the declared name. */
    public record SymbolEntry(int definitions, String displayName) {}

    /**
     * Every resolved name in one file. {@code status}: {@code indexed}, {@code not_indexed} (as for
     * {@link Definition}) or {@code no_file}. Each occurrence is the compact row
     * {@code [line, startColumn, endLine, endColumn, symbolIndex, isDefinition]}, ordered by position ({@code stale}
     * as for {@link Definition});
     * {@code symbolIndex} points into {@code symbols}. Engine symbol keys are not exposed. At most
     * {@value #MAX_FILE_OCCURRENCES} rows are returned; {@code truncated} and {@code total} say when more exist.
     */
    public record FileOccurrences(String schemaVersion, String status, String indexer, String indexerLabel,
                                  List<String> navigationIndexers, List<SymbolEntry> symbols, List<int[]> occurrences,
                                  boolean truncated, int total, ServedFrom servedFrom) {}

    private record Capability(boolean indexed, String indexer, String indexerLabel, List<String> navigationIndexers) {}

    /**
     * Who answers for (requested snapshot, path). {@code answering} is null when nobody can; {@code reviewHead} is
     * the requested snapshot when it is a review head served from another snapshot.
     */
    private record Source(String requested, String answering, Capability capability, String status, String reviewHead, ServedFrom servedFrom) {}

    static final String REVIEW_HEAD = "REVIEW_HEAD";

    private final JdbcTemplate db;
    private final AnalysisPortRegistry registry;

    public NavigationService(JdbcTemplate db, AnalysisPortRegistry registry) {
        this.db = db;
        this.registry = registry;
    }

    public Definition definition(String snapshotId, String path, int line, int column) {
        if (path == null || path.isBlank() || line < 1 || column < 1) throw new IllegalArgumentException("A path and a 1-based line and column are required.");
        Source source = source(snapshotId, path);
        if (source.answering() == null) return definition(source, source.status(), null, List.of());
        String answering = source.answering();
        List<String> symbols = db.queryForList(
                "SELECT o.symbol FROM code_occurrences o JOIN source_file_versions f ON f.id = o.source_file_version_id " +
                "WHERE f.snapshot_id = ? AND f.relative_path = ? AND o.start_line = ? AND o.start_column <= ? AND o.end_column >= ? " +
                "ORDER BY (o.end_column - o.start_column) LIMIT 1", String.class, answering, path, line, column, column);
        if (symbols.isEmpty()) return definition(source, "no_symbol", null, List.of());
        String symbol = symbols.get(0);
        Map<String, String> openIn = new HashMap<>();
        List<Location> locations = db.query(
                "SELECT f.relative_path, o.start_line, o.start_column, o.end_line, o.end_column, o.display_name, o.signature, o.symbol_version_id " +
                "FROM code_occurrences o JOIN source_file_versions f ON f.id = o.source_file_version_id " +
                "WHERE o.snapshot_id = ? AND o.symbol = ? AND o.is_definition = 1 ORDER BY f.relative_path, o.start_line, o.start_column",
                (rs, n) -> {
                    String target = rs.getString(1);
                    // ADR 0014 (D3): a jump stays in the change when the head's copy of the target file is the text that
                    // answered; line numbers then match. Otherwise it opens the answering snapshot's file, flagged.
                    String in = source.reviewHead() == null ? answering
                            : openIn.computeIfAbsent(target, p -> sameText(source.reviewHead(), answering, p) ? source.reviewHead() : answering);
                    return new Location(target, rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getInt(5), rs.getString(6), rs.getString(7), rs.getString(8),
                            in, !in.equals(source.requested()));
                },
                answering, symbol);
        return definition(source, locations.isEmpty() ? "external" : "found", symbol, locations);
    }

    public FileOccurrences occurrences(String snapshotId, String path) {
        return occurrences(snapshotId, path, MAX_FILE_OCCURRENCES);
    }

    FileOccurrences occurrences(String snapshotId, String path, int limit) {
        if (path == null || path.isBlank()) throw new IllegalArgumentException("A path is required.");
        Source source = source(snapshotId, path);
        if (source.answering() == null) return occurrences(source, source.status(), List.of(), List.of(), false, 0);
        String answering = source.answering();
        List<String> fileIds = db.queryForList("SELECT id FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, answering, path);
        if (fileIds.isEmpty()) return occurrences(source, "no_file", List.of(), List.of(), false, 0);
        String fileId = fileIds.get(0);
        Integer counted = db.queryForObject("SELECT COUNT(*) FROM code_occurrences WHERE source_file_version_id = ?", Integer.class, fileId);
        int total = counted == null ? 0 : counted;
        Map<String, Integer> indexBySymbol = new LinkedHashMap<>();
        List<int[]> rows = db.query(
                "SELECT start_line, start_column, end_line, end_column, symbol, is_definition FROM code_occurrences " +
                "WHERE source_file_version_id = ? ORDER BY start_line, start_column, end_line, end_column LIMIT ?",
                (rs, n) -> {
                    int symbolIndex = indexBySymbol.computeIfAbsent(rs.getString(5), ignored -> indexBySymbol.size());
                    return new int[] {rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), symbolIndex, rs.getInt(6) == 1 ? 1 : 0};
                }, fileId, limit);
        Map<String, SymbolEntry> definitions = definitionsOf(answering, new ArrayList<>(indexBySymbol.keySet()));
        List<SymbolEntry> symbols = new ArrayList<>(indexBySymbol.size());
        for (String symbol : indexBySymbol.keySet()) symbols.add(definitions.getOrDefault(symbol, new SymbolEntry(0, null)));
        return occurrences(source, "indexed", symbols, rows, total > rows.size(), total);
    }

    /** Definition count and declared name per symbol, in bounded batches (SQLite caps bound parameters). */
    private Map<String, SymbolEntry> definitionsOf(String snapshotId, List<String> symbols) {
        Map<String, SymbolEntry> result = new HashMap<>();
        for (int from = 0; from < symbols.size(); from += SYMBOL_BATCH) {
            List<String> batch = symbols.subList(from, Math.min(symbols.size(), from + SYMBOL_BATCH));
            List<Object> args = new ArrayList<>(batch.size() + 1);
            args.add(snapshotId);
            args.addAll(batch);
            db.query("SELECT symbol, COUNT(*), MIN(display_name) FROM code_occurrences WHERE snapshot_id = ? AND is_definition = 1 AND symbol IN ("
                            + String.join(",", Collections.nCopies(batch.size(), "?")) + ") GROUP BY symbol",
                    rs -> { result.put(rs.getString(1), new SymbolEntry(rs.getInt(2), rs.getString(3))); }, args.toArray());
        }
        return result;
    }

    /**
     * Resolves which snapshot answers for {@code path} of {@code snapshotId} (ADR 0014). An ordinary or base
     * snapshot answers for itself. A review head is answered by its workspace's active snapshot (the one active
     * now), and only for a file whose stored text is identical in both; that active snapshot's engine decides the
     * capability, so the hint names the engine that would have to provide navigation.
     */
    private Source source(String snapshotId, String path) {
        List<Map<String, Object>> rows = db.queryForList("SELECT language, indexer, purpose, workspace_id FROM snapshots WHERE id = ?", snapshotId);
        if (rows.isEmpty()) throw new NoSuchElementException("Unknown snapshot.");
        Map<String, Object> row = rows.get(0);
        if (!REVIEW_HEAD.equals(row.get("purpose"))) {
            Capability own = capability(snapshotId, (String) row.get("language"), (String) row.get("indexer"));
            return own.indexed() ? new Source(snapshotId, snapshotId, own, "indexed", null, new ServedFrom(snapshotId, "This snapshot · " + own.indexerLabel()))
                    : new Source(snapshotId, null, own, "not_indexed", null, null);
        }
        List<Map<String, Object>> active = db.queryForList(
                "SELECT s.id, s.language, s.indexer FROM workspaces w JOIN snapshots s ON s.id = w.active_snapshot_id " +
                "WHERE w.id = ? AND s.status = 'published'", row.get("workspace_id"));
        if (active.isEmpty()) {
            Capability own = capability(snapshotId, (String) row.get("language"), (String) row.get("indexer"));
            return new Source(snapshotId, null, own, "not_indexed", snapshotId, null);
        }
        String activeId = (String) active.get(0).get("id");
        Capability capability = capability(activeId, (String) active.get(0).get("language"), (String) active.get(0).get("indexer"));
        if (!capability.indexed()) return new Source(snapshotId, null, capability, "not_indexed", snapshotId, null);
        // A file absent from the head is simply not there; one that differs from (or is absent in) the active
        // snapshot changed since the last analysis, so its positions cannot be trusted there.
        if (hash(snapshotId, path) == null) return new Source(snapshotId, null, capability, "no_file", snapshotId, null);
        if (!sameText(snapshotId, activeId, path)) return new Source(snapshotId, null, capability, "stale", snapshotId, null);
        return new Source(snapshotId, activeId, capability, "indexed", snapshotId, new ServedFrom(activeId, "Current analysis · " + capability.indexerLabel()));
    }

    private boolean sameText(String a, String b, String path) {
        String left = hash(a, path);
        return left != null && left.equals(hash(b, path));
    }

    private String hash(String snapshotId, String path) {
        List<String> hashes = db.queryForList("SELECT content_hash FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshotId, path);
        return hashes.isEmpty() ? null : hashes.get(0);
    }

    /**
     * What the snapshot's recorded engine declares. A snapshot can outlive its engine (an engine removed or
     * renamed later); only then is the capability inferred from whether occurrence rows exist.
     */
    private Capability capability(String snapshotId, String language, String indexer) {
        Optional<AnalysisPort> port = registry.find(language, indexer);
        boolean indexed = port.map(AnalysisPort::providesNavigation).orElseGet(() -> {
            Integer any = db.queryForObject("SELECT EXISTS (SELECT 1 FROM code_occurrences WHERE snapshot_id = ?)", Integer.class, snapshotId);
            return any != null && any == 1;
        });
        String id = port.map(AnalysisPortRegistry::indexerOf).orElse(indexer);
        String label = port.map(AnalysisPort::indexerLabel).orElse(indexer);
        return new Capability(indexed, id, label, registry.navigationIndexerLabels(language));
    }

    private static Definition definition(Source s, String status, String symbol, List<Location> locations) {
        Capability c = s.capability();
        return new Definition("1", status, symbol, locations, c.indexer(), c.indexerLabel(), c.navigationIndexers(), s.servedFrom());
    }

    private static FileOccurrences occurrences(Source s, String status, List<SymbolEntry> symbols, List<int[]> rows, boolean truncated, int total) {
        Capability c = s.capability();
        return new FileOccurrences("1", status, c.indexer(), c.indexerLabel(), c.navigationIndexers(), symbols, rows, truncated, total, s.servedFrom());
    }
}
