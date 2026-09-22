package dev.codeatlas.graph;

import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.config.CodeAtlasProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;
import java.io.File;
import java.nio.file.Path;
import java.util.*;

@Service
public class SourceService {
    private final JdbcTemplate db;
    private final CodeAtlasProperties properties;
    public SourceService(JdbcTemplate db, CodeAtlasProperties properties) { this.db = db; this.properties = properties; }
    /** {@code totalSites}: how many evidence sites the subject has; a relationship response carries at most a bounded number of them. */
    public record Source(String schemaVersion, String path, int startLine, int endLine, String content, boolean exact, int totalSites) {}

    private static final String SYMBOL_QUERY =
        "SELECT f.relative_path, e.start_line, e.end_line, f.source_content, f.content_hash, w.canonical_root " +
        "FROM symbol_evidence se JOIN evidence e ON e.id = se.evidence_id " +
        "JOIN source_file_versions f ON f.id = e.source_file_version_id " +
        "JOIN symbol_versions s ON s.id = se.symbol_version_id " +
        "JOIN snapshots sn ON sn.id = f.snapshot_id " +
        "JOIN workspaces w ON w.id = sn.workspace_id " +
        "WHERE s.snapshot_id = ? AND f.snapshot_id = ? AND s.id = ? ORDER BY e.start_line LIMIT 1";

    private static final String RELATIONSHIP_QUERY =
        "SELECT f.relative_path, e.start_line, e.end_line, f.source_content, f.content_hash, w.canonical_root " +
        "FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id " +
        "JOIN source_file_versions f ON f.id = e.source_file_version_id " +
        "JOIN relationship_occurrences r ON r.id = re.relationship_id " +
        "JOIN snapshots sn ON sn.id = f.snapshot_id " +
        "JOIN workspaces w ON w.id = sn.workspace_id " +
        "WHERE r.snapshot_id = ? AND f.snapshot_id = ? AND r.id = ? ORDER BY f.relative_path, e.start_line, e.start_column, e.id LIMIT ?";

    private static final String RELATIONSHIP_SITE_COUNT =
        "SELECT COUNT(*) FROM relationship_evidence re JOIN relationship_occurrences r ON r.id = re.relationship_id " +
        "WHERE r.snapshot_id = ? AND r.id = ?";

    /** One source file with every evidence range that matched it, so a file is shown once with several highlighted ranges. */
    public record FileEvidence(String schemaVersion, String path, String content, boolean exact, List<EvidenceRange> ranges) {}
    /** A highlighted line range and the relationship kinds whose evidence covers exactly this range. */
    public record EvidenceRange(int startLine, int endLine, List<String> kinds) {}

    /** Upper bound on relationship IDs per batch request; a merged package route stays well below this. */
    public static final int MAX_BATCH_IDS = 5000;
    private static final int CHUNK = 400; // below SQLite's default host-parameter limit

    /**
     * Deliberately omits f.source_content: a merged route can carry thousands of occurrences that all
     * point at a handful of files, and selecting the content here materialized one full-file String
     * per occurrence row even though only one per file is ever used. Content is fetched once per
     * distinct file version by FILE_CONTENT_QUERY below.
     */
    private static final String BATCH_RELATIONSHIP_QUERY =
        "SELECT f.id, f.relative_path, e.start_line, e.end_line, f.content_hash, w.canonical_root, r.kind " +
        "FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id " +
        "JOIN source_file_versions f ON f.id = e.source_file_version_id " +
        "JOIN relationship_occurrences r ON r.id = re.relationship_id " +
        "JOIN snapshots sn ON sn.id = f.snapshot_id " +
        "JOIN workspaces w ON w.id = sn.workspace_id " +
        "WHERE r.snapshot_id = ? AND f.snapshot_id = ? AND r.id IN (%s)";

    private static final String FILE_CONTENT_QUERY =
        "SELECT id, source_content FROM source_file_versions WHERE snapshot_id = ? AND id IN (%s)";

    public Source symbol(String snapshot, String id) {
        var rows = db.query(SYMBOL_QUERY, (rs, n) -> mapRow(rs, 1, new HashMap<>()), snapshot, snapshot, id);
        if (!rows.isEmpty()) return rows.get(0);
        // Older indexes did not store declaration ranges. Do not pretend a file is a method.
        throw new NoSuchElementException("Exact source range unavailable. Re-analyze the project to index declaration evidence.");
    }

    /** A whole retained file's content, by its path relative to the workspace root. Used to build a
     * git-style diff against another snapshot's version of the same path (review comparisons pin two
     * immutable snapshots, so both sides are read this way rather than from the live filesystem). */
    public record FileContent(String schemaVersion, String path, String content) {}
    public FileContent file(String snapshot, String path) {
        var rows = db.query("SELECT source_content FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?",
                (rs, n) -> rs.getString(1), snapshot, path);
        if (rows.isEmpty()) throw new NoSuchElementException("No retained source for this path in the given snapshot.");
        return new FileContent("1", path, rows.get(0));
    }

    /**
     * Evidence sites of one relationship occurrence. Summary relationships (DEPENDS_ON, USES_TYPE) collect every
     * site, and each row carries the whole file, so the response is bounded by the same evidence-occurrence limit
     * explanation context uses; {@code totalSites} tells the client how many exist.
     */
    public List<Source> relationship(String snapshot, String id) {
        Integer total = db.queryForObject(RELATIONSHIP_SITE_COUNT, Integer.class, snapshot, id);
        int totalSites = total == null ? 0 : total;
        Map<String, Boolean> exactByFile = new HashMap<>();
        return db.query(RELATIONSHIP_QUERY, (rs, n) -> mapRow(rs, totalSites, exactByFile), snapshot, snapshot, id, properties.getExplanations().getEvidenceOccurrences());
    }

    /**
     * Evidence for several relationship occurrences (e.g. every occurrence behind one merged graph
     * route), grouped by file: each file appears once, ordered by path, with its distinct line ranges
     * in line order. Occurrences sharing one evidence range (a CALLS and the DEPENDS_ON it implies)
     * collapse into one range listing both kinds. The live-file hash check runs once per file.
     */
    public List<FileEvidence> relationships(String snapshot, List<String> ids) {
        List<String> distinct = ids == null ? List.of() : ids.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.size() > MAX_BATCH_IDS) throw new IllegalArgumentException("At most " + MAX_BATCH_IDS + " relationship IDs per request.");
        record Row(String fileId, String path, int start, int end, String hash, String root, String kind) {}
        List<Row> rows = new ArrayList<>();
        for (int from = 0; from < distinct.size(); from += CHUNK) {
            List<String> chunk = distinct.subList(from, Math.min(distinct.size(), from + CHUNK));
            List<Object> args = new ArrayList<>(List.of(snapshot, snapshot));
            args.addAll(chunk);
            rows.addAll(db.query(BATCH_RELATIONSHIP_QUERY.formatted(String.join(",", Collections.nCopies(chunk.size(), "?"))),
                (rs, n) -> new Row(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getInt(4), rs.getString(5), rs.getString(6), rs.getString(7)),
                args.toArray()));
        }
        Map<String, List<Row>> byFile = new TreeMap<>();
        Map<String, String> fileKey = new HashMap<>();
        for (Row row : rows) {
            // Key by path then file-version ID so ordering is by path and two versions never merge.
            String key = fileKey.computeIfAbsent(row.fileId(), id -> row.path() + "\u0000" + id);
            byFile.computeIfAbsent(key, k -> new ArrayList<>()).add(row);
        }
        Map<String, String> contentByFileId = fileContents(snapshot, fileKey.keySet());
        List<FileEvidence> files = new ArrayList<>();
        for (List<Row> fileRows : byFile.values()) {
            Map<List<Integer>, Set<String>> ranges = new TreeMap<>(Comparator.<List<Integer>>comparingInt(r -> r.get(0)).thenComparingInt(r -> r.get(1)));
            for (Row row : fileRows) ranges.computeIfAbsent(List.of(row.start(), row.end()), r -> new TreeSet<>()).add(row.kind());
            Row first = fileRows.get(0);
            files.add(new FileEvidence("1", first.path(), contentByFileId.get(first.fileId()), isStillExact(first.root(), first.path(), first.hash()),
                ranges.entrySet().stream().map(e -> new EvidenceRange(e.getKey().get(0), e.getKey().get(1), List.copyOf(e.getValue()))).toList()));
        }
        return files;
    }

    /** Retained source text for each distinct file version, fetched once per file rather than once per occurrence row. */
    private Map<String, String> fileContents(String snapshot, Collection<String> fileIds) {
        Map<String, String> byId = new HashMap<>();
        List<String> ids = List.copyOf(fileIds);
        for (int from = 0; from < ids.size(); from += CHUNK) {
            List<String> chunk = ids.subList(from, Math.min(ids.size(), from + CHUNK));
            List<Object> args = new ArrayList<>(List.of(snapshot));
            args.addAll(chunk);
            db.query(FILE_CONTENT_QUERY.formatted(String.join(",", Collections.nCopies(chunk.size(), "?"))),
                (RowCallbackHandler) rs -> byId.put(rs.getString(1), rs.getString(2)),
                args.toArray());
        }
        return byId;
    }

    /**
     * Maps a single-occurrence row from SYMBOL_QUERY / RELATIONSHIP_QUERY, both of which still select
     * f.source_content at index 4. (The batched {@link #relationships} path uses its own row mapper
     * over BATCH_RELATIONSHIP_QUERY, which deliberately omits the content column.)
     * {@code exactByFile} re-hashes each live file once per response, not once per site.
     */
    private Source mapRow(java.sql.ResultSet rs, int totalSites, Map<String, Boolean> exactByFile) throws java.sql.SQLException {
        String relativePath = rs.getString(1);
        int startLine = rs.getInt(2);
        int endLine = rs.getInt(3);
        String fileContent = rs.getString(4);
        String storedHash = rs.getString(5);
        String canonicalRoot = rs.getString(6);
        boolean exact = exactByFile.computeIfAbsent(canonicalRoot + "\u0000" + relativePath + "\u0000" + storedHash, key -> isStillExact(canonicalRoot, relativePath, storedHash));
        return new Source("1", relativePath, startLine, endLine, fileContent, exact, totalSites);
    }

    /**
     * Re-hashes the live file (if it still exists) and compares against the hash captured at
     * index time, per DATA_MODEL.md's tamper-detection invariant. A missing file or mismatched
     * hash means the retained file content can no longer be trusted as an exact match for the file on disk.
     */
    private boolean isStillExact(String canonicalRoot, String relativePath, String storedHash) {
        try {
            Path root = Path.of(canonicalRoot).toAbsolutePath().normalize();
            // The registered workspace root itself can be replaced after analysis. Resolve it before
            // checking descendants so a root symlink cannot make an outside file look exact.
            if (!root.equals(root.toRealPath())) return false;
            Path livePath = root.resolve(relativePath).normalize();
            if (!livePath.startsWith(root)) return false;
            Path current = root;
            for (Path part : root.relativize(livePath)) {
                current = current.resolve(part);
                if (java.nio.file.Files.isSymbolicLink(current)) return false;
            }
            File liveFile = livePath.toFile();
            if (!java.nio.file.Files.isRegularFile(livePath, java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
                return false;
            }
            return AnalysisService.computeContentHash(liveFile).equals(storedHash);
        } catch (Exception e) {
            return false;
        }
    }
}
