package dev.codeatlas.graph;

import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.api.GlobalExceptionHandler;
import dev.codeatlas.api.SourceController;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import javax.sql.DataSource;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Go to definition inside the Changes diff (ADR 0014). A review's after-change (head) snapshot is analyzed by the
 * source-only default engine, so navigation is served from the workspace's active snapshot, file by file, where the
 * stored text is identical. The language is a fake non-Java "fixture" language with a source-only default engine and
 * a navigating one, both run through the real {@link AnalysisService} (the head through {@code runReviewAnalysis},
 * exactly as a review capture is), and the endpoints are driven over HTTP: nothing in the service knows the language.
 */
class ReviewDiffNavigationTest {

    private static final String LANGUAGE = "fixture";
    private static final String NAV_LABEL = "Fixture compiler index";

    @TempDir
    Path directory;

    private JdbcTemplate db;
    private AnalysisService analysis;
    private MockMvc mvc;
    private Path workspace;
    private Path capture;

    @BeforeEach
    void setUp() throws IOException {
        // The live tree as last analyzed: app.fx was modified and added.fx added relative to the base commit.
        workspace = Files.createDirectory(directory.resolve("module"));
        write(workspace, "lib.fx", "def greet\n");
        write(workspace, "twice.fx", "def twice\n");
        write(workspace, "app.fx", "use greet\nuse twice\nuse print\n");
        write(workspace, "pkg/added.fx", "def added\nuse greet\n");
        // The head capture: the same tree, except twice.fx was edited after the last analysis.
        capture = Files.createDirectory(directory.resolve("capture-head"));
        write(capture, "lib.fx", "def greet\n");
        write(capture, "twice.fx", "// edited after the analysis\ndef twice\n");
        write(capture, "app.fx", "use greet\nuse twice\nuse print\n");
        write(capture, "pkg/added.fx", "def added\nuse greet\n");

        String url = "jdbc:sqlite:" + directory.resolve("review-navigation.db");
        Flyway.configure().dataSource(url, "", "").load().migrate();
        DataSource dataSource = new DriverManagerDataSource(url);
        db = new JdbcTemplate(dataSource);
        AnalysisPortRegistry registry = new AnalysisPortRegistry(List.of(
                new FixtureEngine(db, "fixture-text", "Fixture text (source only)", true, false),
                new FixtureEngine(db, "fixture-nav", NAV_LABEL, false, true)));
        analysis = new AnalysisService(db, registry, new DataSourceTransactionManager(dataSource));
        mvc = MockMvcBuilders.standaloneSetup(new SourceController(mock(SourceService.class), new NavigationService(db, registry)))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void anAddedFileAndAnUnchangedFileOfTheHeadAreServedFromTheActiveSnapshot() throws Exception {
        String ws = workspace("fixture-nav");
        String active = analyze(ws);
        String head = review(ws, "REVIEW_HEAD");
        // Both snapshots key the same file by the same workspace-relative path, with the same text hash.
        assertEquals(hashes(active).get("pkg/added.fx"), hashes(head).get("pkg/added.fx"));

        mvc.perform(get("/api/snapshots/{s}/files/occurrences", head).param("path", "pkg/added.fx"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("indexed"))
                .andExpect(jsonPath("$.servedFrom.snapshotId").value(active))
                .andExpect(jsonPath("$.servedFrom.label").value("Current analysis · " + NAV_LABEL))
                .andExpect(jsonPath("$.occurrences", hasSize(2)));
        // An added line's name jumps to its definition; the target file is identical in the head, so the jump stays
        // in the change (the head snapshot), not in the current analysis.
        mvc.perform(get("/api/snapshots/{s}/files/definition", head).param("path", "pkg/added.fx").param("line", "2").param("column", "6"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.servedFrom.snapshotId").value(active))
                .andExpect(jsonPath("$.locations[0].path").value("lib.fx"))
                .andExpect(jsonPath("$.locations[0].startLine").value(1))
                .andExpect(jsonPath("$.locations[0].snapshotId").value(head))
                .andExpect(jsonPath("$.locations[0].differsFromChange").value(false));
    }

    @Test
    void aModifiedFileWhoseTextMatchesNavigatesAndATargetThatChangedSinceOpensTheCurrentAnalysis() throws Exception {
        String ws = workspace("fixture-nav");
        String active = analyze(ws);
        String head = review(ws, "REVIEW_HEAD");
        mvc.perform(get("/api/snapshots/{s}/files/definition", head).param("path", "app.fx").param("line", "1").param("column", "5"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.locations[0].path").value("lib.fx"))
                .andExpect(jsonPath("$.locations[0].snapshotId").value(head));
        // twice.fx was edited after the analysis: its definition is opened from the active snapshot, flagged, since
        // its line numbers there need not match the change (ADR 0014, D3).
        mvc.perform(get("/api/snapshots/{s}/files/definition", head).param("path", "app.fx").param("line", "2").param("column", "5"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.locations[0].path").value("twice.fx"))
                .andExpect(jsonPath("$.locations[0].startLine").value(1))
                .andExpect(jsonPath("$.locations[0].snapshotId").value(active))
                .andExpect(jsonPath("$.locations[0].differsFromChange").value(true));
        mvc.perform(get("/api/snapshots/{s}/files/definition", head).param("path", "app.fx").param("line", "3").param("column", "5"))
                .andExpect(jsonPath("$.status").value("external"));
    }

    @Test
    void aFileThatChangedSinceTheLastAnalysisIsStaleOnBothEndpoints() throws Exception {
        String ws = workspace("fixture-nav");
        analyze(ws);
        String head = review(ws, "REVIEW_HEAD");
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", head).param("path", "twice.fx"))
                .andExpect(jsonPath("$.status").value("stale"))
                .andExpect(jsonPath("$.servedFrom").value(nullValue()))
                .andExpect(jsonPath("$.occurrences", hasSize(0)))
                .andExpect(jsonPath("$.indexerLabel").value(NAV_LABEL));
        mvc.perform(get("/api/snapshots/{s}/files/definition", head).param("path", "twice.fx").param("line", "2").param("column", "5"))
                .andExpect(jsonPath("$.status").value("stale"))
                .andExpect(jsonPath("$.locations", hasSize(0)));
        // A path the head does not hold (a deleted file: only its base side has rows) is not navigable on the head.
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", head).param("path", "gone.fx"))
                .andExpect(jsonPath("$.status").value("no_file"));
    }

    @Test
    void theActiveEnginesCapabilityDecidesAndTheBaseAnswersForItself() throws Exception {
        String sourceOnly = workspace("fixture-text");
        analyze(sourceOnly);
        String head = review(sourceOnly, "REVIEW_HEAD");
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", head).param("path", "lib.fx"))
                .andExpect(jsonPath("$.status").value("not_indexed"))
                .andExpect(jsonPath("$.indexer").value("fixture-text"))
                .andExpect(jsonPath("$.navigationIndexers[0]").value(NAV_LABEL));

        String navigating = workspace("fixture-nav");
        analyze(navigating);
        String base = review(navigating, "REVIEW_BASE");
        // The base side is the default engine's own snapshot; it is never served from the active analysis.
        mvc.perform(get("/api/snapshots/{s}/files/definition", base).param("path", "app.fx").param("line", "1").param("column", "5"))
                .andExpect(jsonPath("$.status").value("not_indexed"))
                .andExpect(jsonPath("$.indexer").value("fixture-text"))
                .andExpect(jsonPath("$.servedFrom").value(nullValue()));
    }

    @Test
    void aWorkspaceWithoutAnAnalysisHasNoNavigationForItsHead() throws Exception {
        String ws = workspace("fixture-nav");
        String head = review(ws, "REVIEW_HEAD");
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", head).param("path", "lib.fx"))
                .andExpect(jsonPath("$.status").value("not_indexed"))
                .andExpect(jsonPath("$.servedFrom").value(nullValue()));
    }

    @Test
    void anOrdinarySnapshotNamesItselfAndOpensLocationsInItself() throws Exception {
        String active = analyze(workspace("fixture-nav"));
        mvc.perform(get("/api/snapshots/{s}/files/definition", active).param("path", "app.fx").param("line", "2").param("column", "5"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.servedFrom.snapshotId").value(active))
                .andExpect(jsonPath("$.locations[0].snapshotId").value(active))
                .andExpect(jsonPath("$.locations[0].differsFromChange").value(false));
    }

    private String workspace(String indexer) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces(id,canonical_root,display_name,language,indexer,created_at,updated_at) "
                + "VALUES(?,?,?,?,?,datetime('now'),datetime('now'))", id, workspace + "#" + id, "fixture", LANGUAGE, indexer);
        return id;
    }

    private String analyze(String workspaceId) {
        // The fixture engines analyze the directory they are handed; the workspace row's root only has to be unique.
        db.update("UPDATE workspaces SET canonical_root=? WHERE id=?", workspace.toString(), workspaceId);
        String job = UUID.randomUUID().toString();
        db.update("INSERT INTO jobs(id,workspace_id,operation,status,created_at,updated_at) "
                + "VALUES(?,?, 'ANALYSIS','RUNNING',datetime('now'),datetime('now'))", job, workspaceId);
        analysis.runAnalysis(workspaceId, job);
        db.update("UPDATE workspaces SET canonical_root=? WHERE id=?", workspace + "#" + workspaceId, workspaceId);
        String snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, workspaceId);
        assertEquals("published", db.queryForObject("SELECT status FROM snapshots WHERE id=?", String.class, snapshot));
        return snapshot;
    }

    /** A review snapshot analyzed from the capture exactly as {@code ReviewService} does: the default engine only. */
    private String review(String workspaceId, String purpose) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO snapshots(id,workspace_id,status,purpose,review_identity,language,created_at) VALUES(?,?,'staging',?,?,?,datetime('now'))",
                id, workspaceId, purpose, purpose, LANGUAGE);
        analysis.runReviewAnalysis(workspaceId, id, capture, workspace);
        assertEquals("fixture-text", db.queryForObject("SELECT indexer FROM snapshots WHERE id=?", String.class, id));
        return id;
    }

    private Map<String, String> hashes(String snapshot) {
        Map<String, String> result = new java.util.HashMap<>();
        db.query("SELECT relative_path, content_hash FROM source_file_versions WHERE snapshot_id=?", rs -> { result.put(rs.getString(1), rs.getString(2)); }, snapshot);
        return result;
    }

    private static void write(Path root, String path, String text) throws IOException {
        Path file = root.resolve(path);
        Files.createDirectories(file.getParent());
        Files.writeString(file, text);
    }

    /**
     * A non-Java engine over a toy grammar: {@code def NAME} declares NAME, {@code use NAME} refers to it. It reads
     * the directory it is prepared with, keys files relative to it, and hashes their text, as real engines do; the
     * navigating variant writes occurrence rows in the 1-based, inclusive-end convention.
     */
    private static final class FixtureEngine implements AnalysisPort {
        private static final Pattern NAME = Pattern.compile("^(def|use) (\\w+)");
        private final JdbcTemplate db;
        private final String indexer;
        private final String label;
        private final boolean isDefault;
        private final boolean navigation;
        private Path root;

        FixtureEngine(JdbcTemplate db, String indexer, String label, boolean isDefault, boolean navigation) {
            this.db = db; this.indexer = indexer; this.label = label; this.isDefault = isDefault; this.navigation = navigation;
        }

        @Override public String language() { return LANGUAGE; }
        @Override public String indexer() { return indexer; }
        @Override public String indexerLabel() { return label; }
        @Override public boolean defaultIndexer() { return isDefault; }
        @Override public boolean providesNavigation() { return navigation; }
        @Override public void prepare(String workspacePath) { root = Path.of(workspacePath); }
        @Override public void parseRelationships(File file, String workspaceId, String snapshotId) { }
        @Override public List<String> diagnostics() { return List.of(); }
        @Override public void addDiagnostic(String message) { }
        @Override public void releaseRunCaches() { }

        @Override
        public List<File> discoverFiles(File requested) throws IOException {
            try (Stream<Path> files = Files.walk(requested.toPath())) {
                return files.filter(p -> p.toString().endsWith(".fx")).sorted().map(Path::toFile).toList();
            }
        }

        @Override
        public void parseDeclarations(File file, String workspaceId, String snapshotId) {
            try {
                String path = root.relativize(file.toPath()).toString().replace(File.separatorChar, '/');
                String text = Files.readString(file.toPath());
                String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
                String fileId = UUID.randomUUID().toString();
                db.update("INSERT INTO source_file_versions(id,snapshot_id,relative_path,content_hash,source_content) VALUES(?,?,?,?,?)",
                        fileId, snapshotId, path, hash, text);
                if (!navigation) return;
                String[] lines = text.split("\n", -1);
                List<Object[]> rows = new ArrayList<>();
                for (int i = 0; i < lines.length; i++) {
                    Matcher m = NAME.matcher(lines[i]);
                    if (!m.find()) continue;
                    boolean definition = m.group(1).equals("def");
                    rows.add(new Object[] {UUID.randomUUID().toString(), snapshotId, fileId, i + 1, m.start(2) + 1, i + 1, m.end(2),
                            "fx " + m.group(2), definition ? 1 : 0, definition ? m.group(2) : null});
                }
                db.batchUpdate("INSERT INTO code_occurrences(id,snapshot_id,source_file_version_id,start_line,start_column,end_line,end_column,symbol,is_definition,display_name) "
                        + "VALUES(?,?,?,?,?,?,?,?,?,?)", rows);
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
    }
}
