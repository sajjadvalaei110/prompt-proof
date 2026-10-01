package dev.codeatlas.graph;

import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.api.GlobalExceptionHandler;
import dev.codeatlas.api.IndexerController;
import dev.codeatlas.api.SourceController;
import dev.codeatlas.workspace.WorkspaceService;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Navigation is a capability of an indexing engine, not of Java (ADR 0013). A fake, non-Java "fixture" language
 * ships two engines: a source-only default and one that fills {@code code_occurrences} the way a future Go, Dart or
 * TypeScript engine would. Both run through the real {@link AnalysisService}; the occurrences and definition
 * endpoints are then driven over HTTP, with nothing in the service or API knowing the language.
 */
class NavigationServiceTest {

    private static final String LANGUAGE = "fixture";
    private static final String LIB = String.join("\n",
            "fn greet(who) {",
            "  let msg = \"hi \" + who",
            "  return msg",
            "}",
            "fn twice() {}",
            "");
    private static final String MAIN = String.join("\n",
            "use lib",
            "fn main() {",
            "  greet(\"x\") // 🎉 greet",
            "  print(\"y\")",
            "  twice()",
            "}",
            "fn twice() {}",
            "");

    @TempDir
    Path directory;

    private JdbcTemplate db;
    private Path root;
    private AnalysisService analysis;
    private NavigationService navigation;
    private MockMvc mvc;

    @BeforeEach
    void setUp() throws IOException {
        root = Files.createDirectory(directory.resolve("fixture-root"));
        Files.writeString(root.resolve("lib.fx"), LIB);
        Files.createDirectory(root.resolve("app"));
        Files.writeString(root.resolve("app/main.fx"), MAIN);
        String url = "jdbc:sqlite:" + directory.resolve("navigation.db");
        Flyway.configure().dataSource(url, "", "").load().migrate();
        DataSource dataSource = new DriverManagerDataSource(url);
        db = new JdbcTemplate(dataSource);
        AnalysisPortRegistry registry = new AnalysisPortRegistry(List.of(
                new FixtureEngine(db, root, "fixture-text", "Fixture text (source only)", true, false),
                new FixtureEngine(db, root, "fixture-nav", "Fixture compiler index", false, true)));
        analysis = new AnalysisService(db, registry, new DataSourceTransactionManager(dataSource));
        navigation = new NavigationService(db, registry);
        WorkspaceService workspaces = mock(WorkspaceService.class);
        when(workspaces.indexers()).thenReturn(registry.indexers());
        mvc = MockMvcBuilders.standaloneSetup(new SourceController(mock(SourceService.class), navigation), new IndexerController(workspaces))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void indexersDeclareTheNavigationCapability() throws Exception {
        mvc.perform(get("/api/indexers")).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.indexer=='fixture-nav')].providesNavigation").value(contains(true)))
                .andExpect(jsonPath("$[?(@.indexer=='fixture-text')].providesNavigation").value(contains(false)));
    }

    @Test
    void occurrencesOfANonJavaFileComeFromTheEngineRows() throws Exception {
        String snapshot = analyze("fixture-nav");
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", snapshot).param("path", "app/main.fx"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("indexed"))
                .andExpect(jsonPath("$.indexer").value("fixture-nav"))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.total").value(5))
                .andExpect(jsonPath("$.occurrences", hasSize(5)))
                // main def; greet ref; print ref (external); twice ref; twice def -- ordered by position.
                .andExpect(jsonPath("$.occurrences[0]").value(contains(2, 4, 2, 7, 0, 1)))
                .andExpect(jsonPath("$.occurrences[1]").value(contains(3, 3, 3, 7, 1, 0)))
                .andExpect(jsonPath("$.occurrences[2]").value(contains(4, 3, 4, 7, 2, 0)))
                .andExpect(jsonPath("$.symbols[1].definitions").value(1))
                .andExpect(jsonPath("$.symbols[1].displayName").value("greet"))
                .andExpect(jsonPath("$.symbols[2].definitions").value(0))
                .andExpect(jsonPath("$.symbols[2].displayName").value(nullValue()))
                .andExpect(jsonPath("$.symbols[3].definitions").value(2))
                // Engine symbol keys are never exposed.
                .andExpect(jsonPath("$..symbol").doesNotExist());

        mvc.perform(get("/api/snapshots/{s}/files/occurrences", snapshot).param("path", "missing.fx"))
                .andExpect(jsonPath("$.status").value("no_file"));

        NavigationService.FileOccurrences capped = navigation.occurrences(snapshot, "lib.fx", 2);
        assertEquals(2, capped.occurrences().size());
        assertTrue(capped.truncated());
        assertEquals(6, capped.total());
    }

    @Test
    void goToDefinitionCoversLocalsCrossFileExternalsAndSeveralDefinitions() throws Exception {
        String snapshot = analyze("fixture-nav");
        // A local variable's reference jumps to its definition in the same file.
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "lib.fx").param("line", "3").param("column", "11"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.locations", hasSize(1)))
                .andExpect(jsonPath("$.locations[0].path").value("lib.fx"))
                .andExpect(jsonPath("$.locations[0].startLine").value(2))
                .andExpect(jsonPath("$.locations[0].startColumn").value(7));
        // A call jumps across files.
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "app/main.fx").param("line", "3").param("column", "5"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.locations[0].path").value("lib.fx"))
                .andExpect(jsonPath("$.locations[0].startLine").value(1))
                .andExpect(jsonPath("$.locations[0].startColumn").value(4))
                .andExpect(jsonPath("$.locations[0].endColumn").value(8));
        // Resolved outside the workspace: no locations, nothing fetched.
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "app/main.fx").param("line", "4").param("column", "3"))
                .andExpect(jsonPath("$.status").value("external"))
                .andExpect(jsonPath("$.locations", hasSize(0)));
        // Two definitions: both are returned, ordered by path.
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "app/main.fx").param("line", "5").param("column", "3"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.locations[*].path").value(contains("app/main.fx", "lib.fx")));
        // The word "greet" inside the comment has no occurrence row: it is not a symbol.
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "app/main.fx").param("line", "3").param("column", "21"))
                .andExpect(jsonPath("$.status").value("no_symbol"));
    }

    @Test
    void anEngineWithoutNavigationIsReportedFromItsDeclaredCapability() throws Exception {
        String snapshot = analyze("fixture-text");
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", snapshot).param("path", "lib.fx"))
                .andExpect(jsonPath("$.status").value("not_indexed"))
                .andExpect(jsonPath("$.indexer").value("fixture-text"))
                .andExpect(jsonPath("$.indexerLabel").value("Fixture text (source only)"))
                .andExpect(jsonPath("$.navigationIndexers").value(contains("Fixture compiler index")))
                .andExpect(jsonPath("$.occurrences", hasSize(0)));
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "lib.fx").param("line", "1").param("column", "4"))
                .andExpect(jsonPath("$.status").value("not_indexed"))
                .andExpect(jsonPath("$.indexerLabel").value("Fixture text (source only)"))
                .andExpect(jsonPath("$.navigationIndexers").value(contains("Fixture compiler index")));
    }

    @Test
    void aSnapshotWhoseEngineIsNoLongerRegisteredFallsBackToItsRows() throws Exception {
        String snapshot = analyze("fixture-nav");
        db.update("UPDATE snapshots SET indexer = 'retired-engine' WHERE id = ?", snapshot);
        mvc.perform(get("/api/snapshots/{s}/files/definition", snapshot).param("path", "app/main.fx").param("line", "3").param("column", "3"))
                .andExpect(jsonPath("$.status").value("found"))
                .andExpect(jsonPath("$.indexer").value("retired-engine"));
        mvc.perform(get("/api/snapshots/{s}/files/occurrences", "no-such-snapshot").param("path", "lib.fx"))
                .andExpect(status().isNotFound());
    }

    private String analyze(String indexer) {
        String workspace = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces(id,canonical_root,display_name,language,indexer,created_at,updated_at) "
                + "VALUES(?,?,?,?,?,datetime('now'),datetime('now'))", workspace, root.toString(), "fixture", LANGUAGE, indexer);
        String job = UUID.randomUUID().toString();
        db.update("INSERT INTO jobs(id,workspace_id,operation,status,created_at,updated_at) "
                + "VALUES(?,?, 'ANALYSIS','RUNNING',datetime('now'),datetime('now'))", job, workspace);
        analysis.runAnalysis(workspace, job);
        String snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, workspace);
        assertEquals("published", db.queryForObject("SELECT status FROM snapshots WHERE id=?", String.class, snapshot));
        return snapshot;
    }

    /**
     * A non-Java engine. The navigation variant writes occurrence rows with engine-scoped keys the API treats as
     * opaque (locals are prefixed with their file, as the contract asks); positions are found in the text, in the
     * 1-based, inclusive-end, UTF-16 convention.
     */
    private static final class FixtureEngine implements AnalysisPort {
        private final JdbcTemplate db;
        private final Path root;
        private final String indexer;
        private final String label;
        private final boolean isDefault;
        private final boolean navigation;

        FixtureEngine(JdbcTemplate db, Path root, String indexer, String label, boolean isDefault, boolean navigation) {
            this.db = db; this.root = root; this.indexer = indexer; this.label = label; this.isDefault = isDefault; this.navigation = navigation;
        }

        @Override public String language() { return LANGUAGE; }
        @Override public String indexer() { return indexer; }
        @Override public String indexerLabel() { return label; }
        @Override public boolean defaultIndexer() { return isDefault; }
        @Override public boolean providesNavigation() { return navigation; }
        @Override public List<File> discoverFiles(File requested) { return List.of(root.resolve("lib.fx").toFile(), root.resolve("app/main.fx").toFile()); }
        @Override public void prepare(String workspacePath) { }
        @Override public void parseRelationships(File file, String workspaceId, String snapshotId) { }
        @Override public List<String> diagnostics() { return List.of(); }
        @Override public void addDiagnostic(String message) { }
        @Override public void releaseRunCaches() { }

        @Override
        public void parseDeclarations(File file, String workspaceId, String snapshotId) {
            String path = root.relativize(file.toPath()).toString().replace(File.separatorChar, '/');
            String text = path.equals("lib.fx") ? LIB : MAIN;
            String fileId = UUID.randomUUID().toString();
            db.update("INSERT INTO source_file_versions(id,snapshot_id,relative_path,content_hash,source_content) VALUES(?,?,?,?,?)",
                    fileId, snapshotId, path, "hash-" + path, text);
            if (!navigation) return;
            String[] lines = text.split("\n", -1);
            List<Object[]> rows = new ArrayList<>();
            if (path.equals("lib.fx")) {
                rows.add(row(snapshotId, fileId, lines, 1, "greet", 1, "fx lib/greet()", true));
                rows.add(row(snapshotId, fileId, lines, 1, "who", 1, "local " + fileId + "/who", true));
                rows.add(row(snapshotId, fileId, lines, 2, "msg", 1, "local " + fileId + "/msg", true));
                rows.add(row(snapshotId, fileId, lines, 2, "who", 1, "local " + fileId + "/who", false));
                rows.add(row(snapshotId, fileId, lines, 3, "msg", 1, "local " + fileId + "/msg", false));
                rows.add(row(snapshotId, fileId, lines, 5, "twice", 1, "fx twice()", true));
            } else {
                rows.add(row(snapshotId, fileId, lines, 2, "main", 1, "fx main/main()", true));
                rows.add(row(snapshotId, fileId, lines, 3, "greet", 1, "fx lib/greet()", false));
                rows.add(row(snapshotId, fileId, lines, 4, "print", 1, "fx std/print()", false));
                rows.add(row(snapshotId, fileId, lines, 5, "twice", 1, "fx twice()", false));
                rows.add(row(snapshotId, fileId, lines, 7, "twice", 1, "fx twice()", true));
            }
            db.batchUpdate("INSERT INTO code_occurrences(id,snapshot_id,source_file_version_id,start_line,start_column,end_line,end_column,symbol,is_definition,display_name) "
                    + "VALUES(?,?,?,?,?,?,?,?,?,?)", rows);
        }

        /** The {@code nth} occurrence of {@code token} on a 1-based line, as one occurrence row. */
        private static Object[] row(String snapshotId, String fileId, String[] lines, int line, String token, int nth, String symbol, boolean definition) {
            int index = -1;
            for (int i = 0; i < nth; i++) index = lines[line - 1].indexOf(token, index + 1);
            if (index < 0) throw new AssertionError(token + " not on line " + line);
            return new Object[] {UUID.randomUUID().toString(), snapshotId, fileId, line, index + 1, line, index + token.length(), symbol,
                    definition ? 1 : 0, definition ? token : null};
        }
    }
}
