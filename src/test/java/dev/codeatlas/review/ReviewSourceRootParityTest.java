package dev.codeatlas.review;

import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.api.dto.ReviewRequest;
import dev.codeatlas.api.dto.ReviewResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The Changes comparison must analyze the working tree the way the ordinary map does. Reproduces the user's report
 * (a {@code DeveloperWorkflowTest -> ExplanationResponse} edge on the map that vanished in Changes mode): the
 * workspace is a Git repository whose root is itself a {@code src} directory holding {@code main/java} and
 * {@code test/java}. The ordinary analysis found those source roots because the root's own name completed
 * {@code src/main/java}; the review captures are materialized under {@code capture-*}/{@code base|head}, so the same
 * directories were not recognized, the symbol solver saw no in-source types, and every fact that needs it (a
 * cross-file resolved call, a receiver type inferred from a call chain) disappeared from the comparison.
 */
@SpringBootTest
class ReviewSourceRootParityTest {
    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-review-roots-db-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
    }

    @Autowired private AnalysisService analysisService;
    @Autowired private ReviewService reviewService;
    @Autowired private JdbcTemplate db;

    @TempDir Path temporary;

    @Test
    void aRepositoryRootedAtSrcKeepsSolverFactsInTheComparison() throws Exception {
        Path repo = Files.createDirectories(temporary.resolve("project/src"));
        write(repo, "main/java/app/api/Response.java", "package app.api;\npublic record Response(String status) {}\n");
        write(repo, "main/java/app/api/Service.java", "package app.api;\npublic class Service {\n    public Response get() { return new Response(\"ok\"); }\n}\n");
        write(repo, "test/java/app/flow/FlowTest.java", """
            package app.flow;
            import app.api.Service;
            class FlowTest {
                Service service;
                void run() { service.get().status(); }
            }
            """);
        git(repo, "init", "--initial-branch=main");
        git(repo, "config", "user.name", "Review Roots Test");
        git(repo, "config", "user.email", "review@example.invalid");
        git(repo, "config", "commit.gpgsign", "false");
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        String workspace = UUID.randomUUID().toString(), job = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'review-roots', datetime('now'), datetime('now'))", workspace, repo.toAbsolutePath().normalize().toString());
        db.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", job, workspace);
        analysisService.runAnalysis(workspace, job);
        String ordinary = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspace);

        // The ordinary map has both solver-dependent facts.
        Set<String> expected = Set.of(
                "app.flow.FlowTest.run() -> app.api.Service.get() CALLS RESOLVED",
                "app.flow.FlowTest -> app.api.Response DEPENDS_ON RESOLVED");
        assertTrue(facts(ordinary).containsAll(expected), "ordinary: " + facts(ordinary));

        ReviewResponse review = reviewService.capture(workspace, new ReviewRequest("1", "HEAD"));
        assertTrue(facts(review.base().snapshotId()).containsAll(expected), "review base: " + facts(review.base().snapshotId()));
        assertTrue(facts(review.head().snapshotId()).containsAll(expected), "review head: " + facts(review.head().snapshotId()));
        assertEquals(facts(ordinary), facts(review.head().snapshotId()), "the head side analyzes the working tree like the ordinary map");

        Map<String, String> headNames = new HashMap<>();
        for (ReviewResponse.ReviewNode node : review.nodes()) if (node.head() != null) headNames.put(node.head().id(), node.head().qualifiedName());
        Set<String> unchanged = new HashSet<>();
        for (ReviewResponse.ReviewRelationship row : review.relationships()) {
            assertEquals("UNCHANGED", row.change(), "nothing changed in the working tree: " + row);
            unchanged.add(headNames.get(row.head().sourceId()) + " -> " + headNames.get(row.head().targetId()) + " " + row.head().kind() + " " + row.head().resolution());
        }
        assertTrue(unchanged.containsAll(expected), "comparison rows: " + unchanged);
    }

    /** Every relationship with a target in a snapshot, as "source -> target KIND RESOLUTION". */
    private Set<String> facts(String snapshot) {
        return new TreeSet<>(db.queryForList("""
            SELECT s.qualified_name || ' -> ' || t.qualified_name || ' ' || r.kind || ' ' || r.resolution
            FROM relationship_occurrences r JOIN symbol_versions s ON s.id = r.source_symbol_id JOIN symbol_versions t ON t.id = r.target_symbol_id
            WHERE r.snapshot_id = ?""", String.class, snapshot));
    }

    private static void write(Path root, String relative, String text) throws Exception {
        Path file = root.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, text);
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
}
