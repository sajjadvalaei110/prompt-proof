package dev.codeatlas.graph;

import dev.codeatlas.analysis.AnalysisService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Relationship evidence grouping: a DEPENDS_ON occurrence stores one evidence row per call site, so
 * the per-occurrence endpoint repeats the same file once per call. The batch endpoint must return
 * each file once, with every distinct highlighted range, and fold a CALLS range and the DEPENDS_ON
 * sharing it into one range listing both kinds.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
public class SourceEvidenceGroupingIntegrationTest {
    @Autowired private AnalysisService analysisService;
    @Autowired private SourceService sourceService;
    @Autowired private JdbcTemplate db;

    @Test
    void multipleOccurrencesInOneFileAreReturnedAsOneFileWithSeveralRanges() {
        Path fixture = Path.of("test-fixtures/spring-project").toAbsolutePath();
        // canonical_root is UNIQUE and the test database persists across runs (and is shared with
        // AnalysisServiceSpringIntegrationTest), so reuse the fixture's workspace when it already exists.
        List<String> existing = db.queryForList("SELECT id FROM workspaces WHERE canonical_root = ?", String.class, fixture.toString());
        String workspaceId = existing.isEmpty() ? UUID.randomUUID().toString() : existing.get(0), jobId = UUID.randomUUID().toString();
        if (existing.isEmpty())
            db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'evidence-grouping', datetime('now'), datetime('now'))", workspaceId, fixture.toString());
        db.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);
        analysisService.runAnalysis(workspaceId, jobId);
        String snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertNotNull(snapshot);

        // Pick a DEPENDS_ON with more than one *call* site. The EXISTS clause is what makes this
        // deterministic enough to assert CALLS folding below: since the extractor gained USES_TYPE
        // coverage a DEPENDS_ON is also derived from type usage, so an unfiltered pick (ordered by a
        // random UUID) could land on an occurrence whose sites are all USES_TYPE and carry no call at all.
        String dependsOn = db.queryForObject(
            "SELECT re.relationship_id FROM relationship_evidence re JOIN relationship_occurrences r ON r.id = re.relationship_id " +
            "JOIN evidence e ON e.id = re.evidence_id WHERE r.snapshot_id = ? AND r.kind = 'DEPENDS_ON' " +
            "AND EXISTS (SELECT 1 FROM relationship_evidence re2 JOIN relationship_occurrences r2 ON r2.id = re2.relationship_id " +
            "            WHERE re2.evidence_id = re.evidence_id AND r2.kind = 'CALLS') " +
            "GROUP BY re.relationship_id HAVING COUNT(DISTINCT e.start_line) > 1 " +
            "ORDER BY MIN(e.start_line), re.relationship_id LIMIT 1", String.class, snapshot);
        List<SourceService.Source> flat = sourceService.relationship(snapshot, dependsOn);
        assertTrue(flat.size() > 1, "fixture precondition: one DEPENDS_ON occurrence has several call-site rows");
        assertEquals(1, flat.stream().map(SourceService.Source::path).distinct().count(), "fixture precondition: those rows are in one file");

        // The CALLS occurrences whose evidence the DEPENDS_ON reuses, plus the DEPENDS_ON itself: one merged route's worth.
        List<String> ids = new ArrayList<>(db.queryForList(
            "SELECT DISTINCT re2.relationship_id FROM relationship_evidence re JOIN relationship_evidence re2 ON re2.evidence_id = re.evidence_id " +
            "WHERE re.relationship_id = ? AND re2.relationship_id <> ?", String.class, dependsOn, dependsOn));
        ids.add(dependsOn);
        ids.add(dependsOn); // duplicates in the request are harmless

        List<SourceService.FileEvidence> grouped = sourceService.relationships(snapshot, ids);
        assertEquals(1, grouped.size(), "the file is returned exactly once");
        SourceService.FileEvidence file = grouped.get(0);
        assertEquals(flat.get(0).path(), file.path());
        long distinctRanges = flat.stream().map(s -> s.startLine() + ":" + s.endLine()).distinct().count();
        assertEquals(distinctRanges, file.ranges().size(), "one highlighted range per distinct call site");
        for (int i = 1; i < file.ranges().size(); i++) assertTrue(file.ranges().get(i - 1).startLine() <= file.ranges().get(i).startLine(), "ranges are in line order");
        // Every range must list exactly the kinds the requested occurrences contribute at that evidence.
        // A DEPENDS_ON is no longer derived from calls alone: since the extractor gained USES_TYPE
        // coverage, a call site folds CALLS + DEPENDS_ON while a type-usage site folds USES_TYPE +
        // DEPENDS_ON. Asserting the exact expected set per range keeps that folding under test without
        // assuming which sibling kind happens to share a given site.
        Map<String, Set<String>> expectedKinds = new HashMap<>();
        for (String id : new LinkedHashSet<>(ids))
            for (Map<String, Object> row : db.queryForList(
                "SELECT e.start_line, e.end_line, r.kind FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id " +
                "JOIN relationship_occurrences r ON r.id = re.relationship_id WHERE re.relationship_id = ?", id))
                expectedKinds.computeIfAbsent(((Number) row.get("start_line")).intValue() + ":" + ((Number) row.get("end_line")).intValue(),
                    k -> new TreeSet<>()).add((String) row.get("kind"));
        for (SourceService.EvidenceRange r : file.ranges())
            assertEquals(expectedKinds.get(r.startLine() + ":" + r.endLine()), new TreeSet<>(r.kinds()),
                "range starting at line " + r.startLine() + " lists exactly the kinds its shared evidence carries");
        assertTrue(file.ranges().stream().allMatch(r -> r.kinds().contains("DEPENDS_ON") && r.kinds().size() > 1),
            "every range folds the requested DEPENDS_ON together with the kind sharing its evidence");
        assertTrue(file.ranges().stream().anyMatch(r -> r.kinds().containsAll(List.of("CALLS", "DEPENDS_ON"))),
            "a call site folds CALLS and the DEPENDS_ON sharing its evidence into one range");
        // Content is fetched by a second query keyed on the distinct file version, not carried on every
        // occurrence row. It must still be the real retained source, and every highlighted range must
        // address a line that actually exists in it.
        assertNotNull(file.content(), "the grouped file still carries its retained source content");
        assertEquals(db.queryForObject("SELECT f.source_content FROM source_file_versions f WHERE f.snapshot_id = ? AND f.relative_path = ?", String.class, snapshot, file.path()),
            file.content(), "content matches the stored source for this file version");
        int lineCount = file.content().split("\n", -1).length;
        assertTrue(file.ranges().stream().allMatch(r -> r.startLine() >= 1 && r.endLine() <= lineCount), "every highlighted range lies inside the returned content");

        assertTrue(sourceService.relationships(snapshot, List.of()).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> sourceService.relationships(snapshot, Collections.nCopies(SourceService.MAX_BATCH_IDS + 1, "x").stream().map(x -> UUID.randomUUID().toString()).toList()));
    }
}
