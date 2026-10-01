package dev.codeatlas.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.analysis.AnalysisService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * The optional repository root (ADR 0015): validated in {@code workspace}, used as the Git root of a review and as the
 * upper boundary of a build engine's build-root search, kept like the engine choice, and recorded on snapshots.
 * A workspace may be a module inside the repository; its review covers its own subtree, keyed like its snapshots.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class RepositoryRootIntegrationTest {
    private static final Path DATA_DIR = dataDirectory();

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper mapper;
    @Autowired AnalysisService analysis;

    @TempDir Path temporary;

    @DynamicPropertySource
    static void isolated(DynamicPropertyRegistry properties) {
        properties.add("codeatlas.data-dir", DATA_DIR::toString);
        properties.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA_DIR.resolve("codeatlas.db"));
        // The build check at registration needs no installed tool; the engine is never run here.
        properties.add("codeatlas.indexers.scip-java.home", () -> DATA_DIR.resolve("no-tool").toString());
        properties.add("codeatlas.indexers.scip-java.command", () -> "no-such-scip-java");
    }

    @Test
    void theRootMustExistBeADirectoryAndContainTheWorkspace() throws Exception {
        Path repo = Files.createDirectories(temporary.resolve("repo/module"));
        Path other = Files.createDirectories(temporary.resolve("elsewhere"));
        Path file = Files.writeString(temporary.resolve("file.txt"), "x");
        Integer before = db.queryForObject("SELECT COUNT(*) FROM workspaces", Integer.class);
        assertRejected(register(repo, other.toString(), null), "does not contain the workspace");
        assertRejected(register(repo, temporary.resolve("missing").toString(), null), "does not exist");
        assertRejected(register(repo, file.toString(), null), "not a directory");
        // A link that resolves outside the workspace's tree is an escape, not a way up to a root.
        Path link = Files.createSymbolicLink(temporary.resolve("repo/link-out"), other);
        assertRejected(register(repo, link.toString(), null), "does not contain the workspace");
        assertEquals(before, db.queryForObject("SELECT COUNT(*) FROM workspaces", Integer.class));

        JsonNode equal = ok(register(repo, repo.toString(), null));
        assertEquals(repo.toRealPath().toString(), equal.get("repositoryRoot").asText());
        // A link to a real ancestor is canonicalized to that ancestor.
        Path up = Files.createSymbolicLink(temporary.resolve("up"), temporary.resolve("repo"));
        JsonNode viaLink = ok(register(repo, up.toString(), null));
        assertEquals(temporary.resolve("repo").toRealPath().toString(), viaLink.get("repositoryRoot").asText());
    }

    @Test
    void aBuildEngineNeedsABuildMarkerUnderTheRootBeforeAnythingIsSaved() throws Exception {
        // settings.gradle sits above the root: without a root (and without Git) the search reaches it; with the root
        // it must not, so registering the build engine is refused before a row is written.
        Path outer = Files.createDirectories(temporary.resolve("outer"));
        Files.writeString(outer.resolve("settings.gradle"), "rootProject.name = 'outer'\n");
        Path root = Files.createDirectories(outer.resolve("repo"));
        Path module = Files.createDirectories(root.resolve("app"));
        Integer before = db.queryForObject("SELECT COUNT(*) FROM workspaces", Integer.class);
        assertRejected(register(module, root.toString(), "scip-java"), "found no build");
        assertEquals(before, db.queryForObject("SELECT COUNT(*) FROM workspaces", Integer.class));
        JsonNode auto = ok(register(module, "", "scip-java"));
        assertTrue(auto.get("repositoryRoot").isNull());

        Files.writeString(root.resolve("settings.gradle"), "rootProject.name = 'repo'\n");
        JsonNode bounded = ok(register(module, root.toString(), "scip-java"));
        assertEquals(root.toRealPath().toString(), bounded.get("repositoryRoot").asText());
        // A source-only engine has no build root, so it never needs a marker.
        Path plain = Files.createDirectories(temporary.resolve("plain/module"));
        ok(register(plain, temporary.resolve("plain").toString(), "javaparser"));
    }

    @Test
    void omittingKeepsTheRootTheFormReplacesOrClearsItAndSnapshotsRecordIt() throws Exception {
        Path repo = Files.createDirectories(temporary.resolve("life"));
        Path module = Files.createDirectories(repo.resolve("module/src/main/java/demo"));
        Files.writeString(module.resolve("A.java"), "package demo; class A {}\n");
        Path workspacePath = repo.resolve("module");
        String id = ok(register(workspacePath, repo.toString(), null)).get("id").asText();
        String root = repo.toRealPath().toString();

        // Re-analyze source and Recent projects omit the field: the stored root stays.
        mvc.perform(post("/api/workspaces").contentType(APPLICATION_JSON).content(mapper.createObjectNode()
                .put("path", workspacePath.toString()).put("language", "java").toString()));
        assertEquals(root, storedRoot(id));
        String snapshot = analyze(id);
        assertEquals(root, db.queryForObject("SELECT repository_root FROM snapshots WHERE id=?", String.class, snapshot));

        // The form always sends it: a new value replaces it, an empty one clears it. Neither starts an analysis.
        Integer jobs = db.queryForObject("SELECT COUNT(*) FROM jobs", Integer.class);
        ok(register(workspacePath, workspacePath.toString(), null));
        assertEquals(workspacePath.toRealPath().toString(), storedRoot(id));
        ok(register(workspacePath, "", null));
        assertNull(storedRoot(id));
        assertEquals(jobs, db.queryForObject("SELECT COUNT(*) FROM jobs", Integer.class));
        assertNull(db.queryForObject("SELECT repository_root FROM snapshots WHERE id=?", String.class, analyze(id)));
        // The earlier snapshot keeps the root it was produced with.
        assertEquals(root, db.queryForObject("SELECT repository_root FROM snapshots WHERE id=?", String.class, snapshot));
    }

    @Test
    void aModuleWorkspaceIsReviewedFromItsRepositoryRootWithWorkspaceRelativePaths() throws Exception {
        Path repo = moduleRepository("explicit");
        Path module = repo.resolve("module");
        String id = ok(register(module, repo.toString(), "javaparser")).get("id").asText();
        String active = analyze(id);
        JsonNode review = review(id);

        // Every changed file of the module is listed (as before at the repository root), keyed relative to it;
        // the module's build output is listed but never captured for analysis.
        assertEquals(Map.of("src/main/java/demo/A.java", "MODIFIED", "src/main/java/demo/Added.java", "ADDED", "build/Generated.java", "ADDED"), files(review));
        JsonNode outside = diagnostic(review, "CHANGES_OUTSIDE_WORKSPACE");
        assertNotNull(outside, review.toString());
        assertTrue(outside.get("message").asText().startsWith("1 changed file outside this workspace (module)"));
        String head = review.at("/head/snapshotId").asText(), base = review.at("/base/snapshotId").asText();
        // The head capture keys files exactly as the workspace's own analysis does (ADR 0014's path check is an
        // identity): same paths, same text hashes for the files analyzed from the same working tree.
        assertEquals(hashes(active), hashes(head));
        assertFalse(hashes(base).containsKey("src/main/java/demo/Added.java"));
        assertFalse(hashes(head).containsKey("build/Generated.java"));
        assertEquals(java.util.Set.of("src/main/java/demo/A.java", "src/main/java/demo/Added.java"), hashes(head).keySet());
        assertEquals(repo.toRealPath().toString(), db.queryForObject("SELECT repository_root FROM snapshots WHERE id=?", String.class, head));
        assertEquals("REVIEW_HEAD", db.queryForObject("SELECT purpose FROM snapshots WHERE id=?", String.class, head));
    }

    @Test
    void withoutARootTheModuleIsReviewedFromGitsOwnTopLevel() throws Exception {
        Path repo = moduleRepository("auto");
        String id = ok(register(repo.resolve("module"), "", "javaparser")).get("id").asText();
        JsonNode review = review(id);
        assertEquals(Map.of("src/main/java/demo/A.java", "MODIFIED", "src/main/java/demo/Added.java", "ADDED", "build/Generated.java", "ADDED"), files(review));
        assertTrue(db.queryForList("SELECT repository_root FROM snapshots WHERE id=?", String.class, review.at("/head/snapshotId").asText()).contains(null));
    }

    @Test
    void aRootThatIsNotTheTopOfAGitWorkTreeMakesReviewUnavailable() throws Exception {
        Path repo = moduleRepository("not-top");
        Path module = repo.resolve("module");
        String id = ok(register(module, module.toString(), "javaparser")).get("id").asText();
        MvcResult result = postReview(id);
        assertEquals(400, result.getResponse().getStatus());
        assertTrue(result.getResponse().getContentAsString().contains("is not the top of a Git work tree"), result.getResponse().getContentAsString());
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM snapshots WHERE workspace_id=? AND purpose LIKE 'REVIEW_%'", Integer.class, id));

        Path plain = Files.createDirectories(temporary.resolve("no-git/module"));
        String noGit = ok(register(plain, temporary.resolve("no-git").toString(), "javaparser")).get("id").asText();
        assertEquals(400, postReview(noGit).getResponse().getStatus());
    }

    /** A repository whose module changed (one file edited, one added) next to a sibling that changed too. */
    private Path moduleRepository(String name) throws Exception {
        Path repo = Files.createDirectories(temporary.resolve(name));
        git(repo, "init", "--initial-branch=main");
        git(repo, "config", "user.name", "Root Test");
        git(repo, "config", "user.email", "root@example.invalid");
        git(repo, "config", "commit.gpgsign", "false");
        Path sources = Files.createDirectories(repo.resolve("module/src/main/java/demo"));
        Path sibling = Files.createDirectories(repo.resolve("sibling/src/main/java/other"));
        Files.writeString(sources.resolve("A.java"), "package demo;\nclass A { void run() {} }\n");
        Files.writeString(sibling.resolve("S.java"), "package other;\nclass S {}\n");
        // Build output inside the module never enters a capture.
        Files.createDirectories(repo.resolve("module/build"));
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        Files.writeString(sources.resolve("A.java"), "package demo;\nclass A { void run() { new Added(); } }\n");
        Files.writeString(sources.resolve("Added.java"), "package demo;\nclass Added {}\n");
        Files.writeString(repo.resolve("module/build/Generated.java"), "package demo;\nclass Generated {}\n");
        Files.writeString(sibling.resolve("S.java"), "package other;\nclass S { int changed; }\n");
        return repo;
    }

    private MvcResult register(Path path, String root, String indexer) throws Exception {
        var body = mapper.createObjectNode().put("path", path.toString()).put("language", "java");
        if (root != null) body.put("repositoryRoot", root);
        if (indexer != null) body.put("indexer", indexer).put("allowBuildExecution", true);
        return mvc.perform(post("/api/workspaces").contentType(APPLICATION_JSON).content(body.toString())).andReturn();
    }

    private JsonNode ok(MvcResult result) throws Exception {
        assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private static void assertRejected(MvcResult result, String message) throws Exception {
        assertEquals(400, result.getResponse().getStatus(), result.getResponse().getContentAsString());
        assertTrue(result.getResponse().getContentAsString().contains(message), result.getResponse().getContentAsString());
    }

    private String storedRoot(String id) {
        return db.queryForObject("SELECT repository_root FROM workspaces WHERE id=?", String.class, id);
    }

    private String analyze(String workspace) {
        String job = UUID.randomUUID().toString();
        db.update("INSERT INTO jobs(id,workspace_id,operation,status,created_at,updated_at) VALUES(?,?,'ANALYSIS','RUNNING',datetime('now'),datetime('now'))", job, workspace);
        analysis.runAnalysis(workspace, job);
        assertEquals("COMPLETED", db.queryForObject("SELECT status FROM jobs WHERE id=?", String.class, job),
                db.queryForObject("SELECT error_message FROM jobs WHERE id=?", String.class, job));
        return db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, workspace);
    }

    private MvcResult postReview(String workspace) throws Exception {
        return mvc.perform(post("/api/workspaces/{id}/reviews", workspace).contentType(APPLICATION_JSON)
                .content(mapper.createObjectNode().put("schemaVersion", "1").put("baseRef", "HEAD").toString())).andReturn();
    }

    private JsonNode review(String workspace) throws Exception {
        return ok(postReview(workspace));
    }

    private static Map<String, String> files(JsonNode review) {
        Map<String, String> result = new HashMap<>();
        review.get("files").forEach(f -> result.put(f.get("path").asText(), f.get("status").asText()));
        return result;
    }

    private static JsonNode diagnostic(JsonNode review, String code) {
        for (JsonNode d : review.get("diagnostics")) if (code.equals(d.get("code").asText())) return d;
        return null;
    }

    private Map<String, String> hashes(String snapshot) {
        Map<String, String> result = new HashMap<>();
        db.query("SELECT relative_path, content_hash FROM source_file_versions WHERE snapshot_id=?", rs -> { result.put(rs.getString(1), rs.getString(2)); }, snapshot);
        return result;
    }

    private static void git(Path repo, String... arguments) throws Exception {
        List<String> command = new ArrayList<>(List.of("git", "-C", repo.toString()));
        command.addAll(List.of(arguments));
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
        builder.environment().put("GIT_CONFIG_NOSYSTEM", "1");
        builder.environment().put("GIT_CONFIG_GLOBAL", "/dev/null");
        builder.environment().put("GIT_TERMINAL_PROMPT", "0");
        Process process = builder.start();
        assertTrue(process.waitFor(20, TimeUnit.SECONDS), "Git setup timed out: " + command);
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals(0, process.exitValue(), output);
    }

    private static Path dataDirectory() {
        try {
            return Files.createTempDirectory("atlas-repository-root-");
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
