package dev.codeatlas.analysis;

import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.dao.DataAccessException;

import javax.sql.DataSource;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Regression coverage for the language dispatch seam around the existing analysis pipeline. */
class AnalysisServiceDispatchTest {

    private static final String WORKSPACE_ID = "workspace";
    private static final String FIXTURE_LANGUAGE = "fixture";

    @TempDir
    Path directory;

    private JdbcTemplate db;
    private Path sourceRoot;
    private FakeAnalysisPort fixture;
    private AnalysisPort javaPort;
    private SpringAnnotationAnalyzer springAnalyzer;
    private AnalysisService service;

    @BeforeEach
    void setUp() throws Exception {
        sourceRoot = Files.createDirectory(directory.resolve("source-root"));
        Files.writeString(sourceRoot.resolve("Entry.fixture"), "fixture source\n");

        String url = "jdbc:sqlite:" + directory.resolve("analysis.db");
        Flyway.configure().dataSource(url, "", "").load().migrate();
        DataSource dataSource = new DriverManagerDataSource(url);
        db = new JdbcTemplate(dataSource);

        fixture = new FakeAnalysisPort(db, sourceRoot, FIXTURE_LANGUAGE);
        javaPort = mock(AnalysisPort.class);
        when(javaPort.language()).thenReturn(JavaAnalysisAdapter.LANGUAGE);
        AnalysisPortRegistry registry = new AnalysisPortRegistry(List.of(javaPort, fixture));
        springAnalyzer = mock(SpringAnnotationAnalyzer.class);
        service = new AnalysisService(db, registry, new DataSourceTransactionManager(dataSource));

        db.update("INSERT INTO workspaces(id,canonical_root,display_name,language,created_at,updated_at) "
                + "VALUES(?,?,?,?,datetime('now'),datetime('now'))",
                WORKSPACE_ID, sourceRoot.toString(), "fixture", FIXTURE_LANGUAGE);
    }

    @Test
    void ordinaryAnalysisUsesSelectedAdapterAndPublishesItsLanguageWithoutSpringHeuristics() throws IOException {
        String jobId = insertJob();

        service.runAnalysis(WORKSPACE_ID, jobId);

        String snapshotId = db.queryForObject(
                "SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, WORKSPACE_ID);
        assertNotNull(snapshotId);
        assertEquals(FIXTURE_LANGUAGE, db.queryForObject(
                "SELECT language FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals("published", db.queryForObject(
                "SELECT status FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals("COMPLETED", db.queryForObject(
                "SELECT status FROM jobs WHERE id=?", String.class, jobId));
        assertEquals(2, db.queryForObject(
                "SELECT total_items FROM jobs WHERE id=?", Integer.class, jobId));

        assertEquals(1, fixture.discoverCalls);
        assertEquals(1, fixture.prepareCalls);
        assertEquals(1, fixture.declarationCalls);
        assertEquals(1, fixture.relationshipCalls);
        assertEquals(1, fixture.releaseCalls);
        verify(javaPort, never()).discoverFiles(any());
        verify(javaPort, never()).prepare(any());
        verify(javaPort, never()).parseDeclarations(any(), any(), any());
        verifyNoInteractions(springAnalyzer);
    }

    @Test
    void theWorkspacesRepositoryRootReachesTheEngineAndIsRecordedOnTheSnapshot() {
        // ADR 0015: language-neutral -- the non-Java fixture engine receives the configured root, and the snapshot
        // records it as provenance; an unset root reaches the engine as null (auto-detect).
        db.update("UPDATE workspaces SET repository_root=? WHERE id=?", directory.toString(), WORKSPACE_ID);
        service.runAnalysis(WORKSPACE_ID, insertJob());
        String snapshotId = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, WORKSPACE_ID);
        assertEquals(directory.toString(), db.queryForObject("SELECT repository_root FROM snapshots WHERE id=?", String.class, snapshotId));
        db.update("UPDATE workspaces SET repository_root=NULL WHERE id=?", WORKSPACE_ID);
        service.runAnalysis(WORKSPACE_ID, insertJob());
        assertEquals(java.util.Arrays.asList(directory, null), fixture.preparedRepositoryRoots);
    }

    @Test
    void reviewAnalysisDispatchesByRetainedSnapshotLanguageAndKeepsSpringJavaOnly() throws IOException {
        String snapshotId = UUID.randomUUID().toString();
        db.update("INSERT INTO snapshots(id,workspace_id,status,language,created_at) "
                + "VALUES(?,?, 'staging',?,datetime('now'))",
                snapshotId, WORKSPACE_ID, FIXTURE_LANGUAGE);

        service.runReviewAnalysis(WORKSPACE_ID, snapshotId, sourceRoot);

        assertEquals("published", db.queryForObject(
                "SELECT status FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals(FIXTURE_LANGUAGE, db.queryForObject(
                "SELECT language FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals(1, fixture.discoverCalls);
        assertEquals(1, fixture.prepareCalls);
        assertEquals(1, fixture.declarationCalls);
        assertEquals(1, fixture.relationshipCalls);
        assertEquals(1, fixture.releaseCalls);
        verify(javaPort, never()).discoverFiles(any());
        verify(javaPort, never()).prepare(any());
        verifyNoInteractions(springAnalyzer);
    }

    @Test
    void failedOrdinaryAnalysisMarksSnapshotAndJobFailedAndReleasesAdapterCaches() {
        fixture.failPrepare = true;
        String jobId = insertJob();

        service.runAnalysis(WORKSPACE_ID, jobId);

        String snapshotId = db.queryForObject(
                "SELECT snapshot_id FROM jobs WHERE id=?", String.class, jobId);
        assertNotNull(snapshotId);
        assertEquals("failed", db.queryForObject(
                "SELECT status FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals("FAILED", db.queryForObject(
                "SELECT status FROM jobs WHERE id=?", String.class, jobId));
        assertNull(db.queryForObject(
                "SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, WORKSPACE_ID));
        assertEquals(1, fixture.releaseCalls);
        verifyNoInteractions(springAnalyzer);
    }

    @Test
    void failedReviewAnalysisMarksSnapshotFailedAndReleasesAdapterCaches() {
        fixture.failPrepare = true;
        String snapshotId = UUID.randomUUID().toString();
        db.update("INSERT INTO snapshots(id,workspace_id,status,language,created_at) "
                + "VALUES(?,?, 'staging',?,datetime('now'))",
                snapshotId, WORKSPACE_ID, FIXTURE_LANGUAGE);

        IllegalArgumentException failure = assertThrows(IllegalArgumentException.class,
                () -> service.runReviewAnalysis(WORKSPACE_ID, snapshotId, sourceRoot));

        assertTrue(failure.getMessage().contains("Review capture analysis failed"));
        assertEquals("failed", db.queryForObject(
                "SELECT status FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals(1, fixture.releaseCalls);
        verifyNoInteractions(springAnalyzer);
    }

    @Test
    void javaAnalysisUsesJavaAdapterAndRunsTheSpringPass() throws IOException {
        Files.writeString(sourceRoot.resolve("Entry.java"), "class Entry {}\n");
        db.update("UPDATE workspaces SET language=? WHERE id=?", JavaAnalysisAdapter.LANGUAGE, WORKSPACE_ID);

        JavaParserAdapter javaParser = mock(JavaParserAdapter.class);
        when(javaParser.diagnostics()).thenReturn(List.of());
        when(springAnalyzer.analyze(any())).thenReturn(SpringAnnotationAnalyzer.SpringAnalysisResult.empty());
        JavaAnalysisAdapter javaAdapter = new JavaAnalysisAdapter(javaParser, springAnalyzer);
        AnalysisPortRegistry registry = new AnalysisPortRegistry(List.of(javaAdapter));
        service = new AnalysisService(db, registry,
                new DataSourceTransactionManager(new DriverManagerDataSource(
                        "jdbc:sqlite:" + directory.resolve("analysis.db"))));
        String jobId = insertJob();

        service.runAnalysis(WORKSPACE_ID, jobId);

        String snapshotId = db.queryForObject(
                "SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, WORKSPACE_ID);
        assertEquals(JavaAnalysisAdapter.LANGUAGE, db.queryForObject(
                "SELECT language FROM snapshots WHERE id=?", String.class, snapshotId));
        assertEquals("COMPLETED", db.queryForObject(
                "SELECT status FROM jobs WHERE id=?", String.class, jobId));
        assertEquals(3, db.queryForObject(
                "SELECT total_items FROM jobs WHERE id=?", Integer.class, jobId));
        verify(javaParser).setupSymbolSolver(sourceRoot.toString());
        verify(javaParser).parseDeclarations(any(File.class), eq(WORKSPACE_ID), eq(snapshotId));
        verify(javaParser).parseRelationships(any(File.class), eq(WORKSPACE_ID), eq(snapshotId));
        verify(javaParser).releaseRunCaches();
        verify(springAnalyzer).analyze(any(com.github.javaparser.ast.CompilationUnit.class));
    }

    @Test
    void unsupportedLanguageFailsTheJobBeforeCreatingASnapshot() throws IOException {
        db.update("UPDATE workspaces SET language=? WHERE id=?", "not-shipped", WORKSPACE_ID);
        String jobId = insertJob();

        service.runAnalysis(WORKSPACE_ID, jobId);

        assertEquals(0, db.queryForObject(
                "SELECT COUNT(*) FROM snapshots WHERE workspace_id=?", Integer.class, WORKSPACE_ID));
        assertNull(db.queryForObject(
                "SELECT snapshot_id FROM jobs WHERE id=?", String.class, jobId));
        assertEquals("FAILED", db.queryForObject(
                "SELECT status FROM jobs WHERE id=?", String.class, jobId));
        String error = db.queryForObject(
                "SELECT error_message FROM jobs WHERE id=?", String.class, jobId);
        assertTrue(error.contains("No analysis adapter is available"), error);
        verifyNoInteractions(springAnalyzer);
        verify(javaPort, never()).discoverFiles(any());
    }

    @Test
    void failedJobStatusUpdateFailurePropagatesToTheCaller() {
        db.update("UPDATE workspaces SET language=? WHERE id=?", "not-shipped", WORKSPACE_ID);
        String jobId = insertJob();
        db.execute("CREATE TRIGGER reject_failed_job_update BEFORE UPDATE OF status ON jobs " +
                "WHEN NEW.status='FAILED' BEGIN SELECT RAISE(ABORT, 'failed status write unavailable'); END");

        try {
            DataAccessException failure = assertThrows(DataAccessException.class,
                    () -> service.runAnalysis(WORKSPACE_ID, jobId));

            assertTrue(failure.getMessage().contains("failed status write unavailable"), failure.getMessage());
            assertEquals("RUNNING", db.queryForObject("SELECT status FROM jobs WHERE id=?", String.class, jobId));
            assertEquals(0, db.queryForObject(
                    "SELECT COUNT(*) FROM snapshots WHERE workspace_id=?", Integer.class, WORKSPACE_ID));
        } finally {
            db.execute("DROP TRIGGER IF EXISTS reject_failed_job_update");
        }
    }

    private String insertJob() {
        String jobId = UUID.randomUUID().toString();
        db.update("INSERT INTO jobs(id,workspace_id,operation,status,created_at,updated_at) "
                + "VALUES(?,?, 'ANALYSIS','RUNNING',datetime('now'),datetime('now'))",
                jobId, WORKSPACE_ID);
        return jobId;
    }

    private static final class FakeAnalysisPort implements AnalysisPort {
        private final JdbcTemplate db;
        private final Path root;
        private final String language;
        private final List<String> preparedRoots = new ArrayList<>();
        private int discoverCalls;
        private int prepareCalls;
        private int declarationCalls;
        private int relationshipCalls;
        private int releaseCalls;
        private boolean failPrepare;

        private FakeAnalysisPort(JdbcTemplate db, Path root, String language) {
            this.db = db;
            this.root = root;
            this.language = language;
        }

        @Override
        public String language() {
            return language;
        }

        @Override
        public List<File> discoverFiles(File requestedRoot) {
            discoverCalls++;
            assertEquals(root.toAbsolutePath().normalize(), requestedRoot.toPath().toAbsolutePath().normalize());
            return List.of(root.resolve("Entry.fixture").toFile());
        }

        private final List<Path> preparedRepositoryRoots = new ArrayList<>();

        @Override
        public void prepareWorkspace(String workspacePath, Path repositoryRoot) {
            preparedRepositoryRoots.add(repositoryRoot);
            prepare(workspacePath);
        }

        @Override
        public void prepare(String workspacePath) {
            prepareCalls++;
            preparedRoots.add(workspacePath);
            if (failPrepare) throw new IllegalStateException("fixture preparation failed");
        }

        @Override
        public void parseDeclarations(File file, String workspaceId, String snapshotId) {
            declarationCalls++;
            String fileId = UUID.randomUUID().toString();
            String symbolId = UUID.randomUUID().toString();
            String evidenceId = UUID.randomUUID().toString();
            String key = "fixture.Entry";
            db.update("INSERT OR IGNORE INTO logical_symbols(workspace_id,key) VALUES(?,?)", workspaceId, key);
            db.update("INSERT INTO source_file_versions(id,snapshot_id,relative_path,content_hash,source_content) "
                    + "VALUES(?,?,?,?,?)", fileId, snapshotId, "Entry.fixture", "fixture-hash", "fixture source\n");
            db.update("INSERT INTO symbol_versions(id,snapshot_id,logical_symbol_key,workspace_id,kind,qualified_name,"
                    + "simple_name,content_hash) VALUES(?,?,?,?,?,?,?,?)",
                    symbolId, snapshotId, key, workspaceId, "CLASS", key, "Entry", "fixture-hash");
            db.update("INSERT INTO evidence(id,source_file_version_id,start_line,start_column,end_line,end_column,snippet) "
                    + "VALUES(?,?,?,?,?,?,?)", evidenceId, fileId, 1, 1, 1, 15, "fixture source");
            db.update("INSERT INTO symbol_evidence(symbol_version_id,evidence_id) VALUES(?,?)", symbolId, evidenceId);
        }

        @Override
        public void parseRelationships(File file, String workspaceId, String snapshotId) {
            relationshipCalls++;
        }

        @Override
        public List<String> diagnostics() {
            return List.of();
        }

        @Override
        public void addDiagnostic(String message) {
            throw new AssertionError("Unexpected fixture diagnostic: " + message);
        }

        @Override
        public void releaseRunCaches() {
            releaseCalls++;
            preparedRoots.clear();
        }
    }
}
