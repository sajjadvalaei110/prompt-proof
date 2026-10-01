package dev.codeatlas.graph;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Go to definition over the occurrence index ({@code code_occurrences}, ADR 0012). Only engines that record
 * occurrences (scip-java) can answer; for other snapshots every lookup reports {@code not_indexed}.
 */
@Service
public class NavigationService {

    public record Location(String path, int startLine, int startColumn, int endLine, int endColumn,
                           String displayName, String signature, String symbolId) {}

    /**
     * {@code status}: {@code found} (one or more definitions in this snapshot), {@code external} (javac resolved
     * the name to something outside the workspace, such as the JDK, a library or another module), {@code no_symbol}
     * (no resolved name at that position) or {@code not_indexed} (this snapshot's engine records no occurrences).
     * Positions use the evidence convention: 1-based line and column.
     */
    public record Definition(String schemaVersion, String status, String symbol, List<Location> locations) {}

    private final JdbcTemplate db;

    public NavigationService(JdbcTemplate db) { this.db = db; }

    public Definition definition(String snapshotId, String path, int line, int column) {
        if (path == null || path.isBlank() || line < 1 || column < 1) throw new IllegalArgumentException("A path and a 1-based line and column are required.");
        Integer indexed = db.queryForObject("SELECT EXISTS (SELECT 1 FROM code_occurrences WHERE snapshot_id = ?)", Integer.class, snapshotId);
        if (indexed == null || indexed == 0) return new Definition("1", "not_indexed", null, List.of());
        List<String> symbols = db.queryForList(
                "SELECT o.symbol FROM code_occurrences o JOIN source_file_versions f ON f.id = o.source_file_version_id " +
                "WHERE f.snapshot_id = ? AND f.relative_path = ? AND o.start_line = ? AND o.start_column <= ? AND o.end_column >= ? " +
                "ORDER BY (o.end_column - o.start_column) LIMIT 1", String.class, snapshotId, path, line, column, column);
        if (symbols.isEmpty()) return new Definition("1", "no_symbol", null, List.of());
        String symbol = symbols.get(0);
        List<Location> locations = db.query(
                "SELECT f.relative_path, o.start_line, o.start_column, o.end_line, o.end_column, o.display_name, o.signature, o.symbol_version_id " +
                "FROM code_occurrences o JOIN source_file_versions f ON f.id = o.source_file_version_id " +
                "WHERE o.snapshot_id = ? AND o.symbol = ? AND o.is_definition = 1 ORDER BY f.relative_path, o.start_line, o.start_column",
                (rs, n) -> new Location(rs.getString(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getInt(5), rs.getString(6), rs.getString(7), rs.getString(8)),
                snapshotId, symbol);
        return new Definition("1", locations.isEmpty() ? "external" : "found", symbol, locations);
    }
}
