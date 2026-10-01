package dev.codeatlas.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Uses real disposable Git repositories; review captures never run a target build or checkout. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class ReviewApiIntegrationTest {
    // Keep the temporary database beneath a path containing "build". Captures stored here must still
    // be discovered relative to their private source root, rather than filtered by their absolute path.
    private static final Path DATA_DIR = createDataDirectory();

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper mapper;

    @TempDir Path temporary;

    @DynamicPropertySource
    static void isolatedDataDirectory(DynamicPropertyRegistry properties) {
        properties.add("codeatlas.data-dir", () -> DATA_DIR.toString());
    }

    @Test
    void capturesPinnedBaseAndWorkingTreeWithoutPublishingOrChangingTarget() throws Exception {
        Path repo = repository("capture");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        String target = "package demo;\nclass B { void one() {} void two() {} }\n";
        String callerBase = "package demo; class A { B b; void run() { b.one(); } void sibling() {} }\n";
        Files.writeString(sources.resolve("B.java"), target);
        Files.writeString(sources.resolve("A.java"), callerBase);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        String baseOid = git(repo, "rev-parse", "HEAD").trim();

        String callerHead = callerBase.replace("b.one()", "b.two()");
        Files.writeString(sources.resolve("A.java"), callerHead);
        Files.writeString(repo.resolve("notes.txt"), "untracked review note\n");
        byte[] indexBefore = Files.readAllBytes(repo.resolve(".git/index"));
        String workspace = registerWorkspace(repo);
        String activeSnapshot = addActiveAnalysisSnapshot(workspace);

        JsonNode response = createReview(workspace, "HEAD");
        String baseSnapshot = response.path("base").path("snapshotId").asText();
        String headSnapshot = response.path("head").path("snapshotId").asText();

        assertEquals("1", response.path("schemaVersion").asText());
        assertNotEquals(baseSnapshot, headSnapshot);
        assertEquals(baseOid, response.path("base").path("resolvedRef").asText());
        assertTrue(response.path("head").path("fingerprint").asText().length() > 0);
        assertEquals(callerBase, source(baseSnapshot, "src/main/java/demo/A.java"));
        assertEquals(target, source(baseSnapshot, "src/main/java/demo/B.java"));
        assertEquals(callerHead, source(headSnapshot, "src/main/java/demo/A.java"));
        assertEquals(target, source(headSnapshot, "src/main/java/demo/B.java"));

        assertEquals("MODIFIED", findNode(response, "demo.A.run()", "MODIFIED").path("change").asText());
        JsonNode sibling = findNode(response, "demo.A.sibling()", "UNCHANGED");
        assertEquals("UNCHANGED", sibling.path("change").asText());
        assertEquals(0, sibling.path("addedLines").asInt());
        assertEquals(0, sibling.path("removedLines").asInt());
        assertNotNull(find(response.path("relationships"), relation -> relation.path("change").asText().equals("REMOVED")));
        assertNotNull(find(response.path("relationships"), relation -> relation.path("change").asText().equals("ADDED")));

        JsonNode removedCall = find(response.path("relationships"), relation ->
                relation.path("change").asText().equals("REMOVED") && relation.path("base").path("kind").asText().equals("CALLS"));
        JsonNode addedCall = find(response.path("relationships"), relation ->
                relation.path("change").asText().equals("ADDED") && relation.path("head").path("kind").asText().equals("CALLS"));
        assertNotNull(removedCall, "The base CALLS occurrence must remain addressable");
        assertNotNull(addedCall, "The head CALLS occurrence must remain addressable");
        Files.delete(sources.resolve("A.java"));
        try {
            JsonNode baseEvidence = relationshipEvidence(baseSnapshot, removedCall.path("base").path("id").asText());
            JsonNode headEvidence = relationshipEvidence(headSnapshot, addedCall.path("head").path("id").asText());
            assertEquals(1, baseEvidence.size());
            assertEquals(callerBase, baseEvidence.get(0).path("content").asText());
            assertEquals("src/main/java/demo/A.java", baseEvidence.get(0).path("path").asText());
            assertFalse(baseEvidence.get(0).path("exact").asBoolean());
            assertEquals(1, headEvidence.size());
            assertEquals(callerHead, headEvidence.get(0).path("content").asText());
            assertEquals("src/main/java/demo/A.java", headEvidence.get(0).path("path").asText());
            assertFalse(headEvidence.get(0).path("exact").asBoolean());
        } finally {
            Files.writeString(sources.resolve("A.java"), callerHead);
        }

        assertEquals("REVIEW_BASE", snapshot(baseSnapshot).path("purpose").asText());
        assertEquals("REVIEW_HEAD", snapshot(headSnapshot).path("purpose").asText());
        assertEquals("published", snapshot(baseSnapshot).path("status").asText());
        assertEquals("published", snapshot(headSnapshot).path("status").asText());
        String workspaceLanguage = db.queryForObject(
                "SELECT language FROM workspaces WHERE id=?", String.class, workspace);
        assertEquals(workspaceLanguage, snapshotLanguage(baseSnapshot));
        assertEquals(workspaceLanguage, snapshotLanguage(headSnapshot));
        assertEquals(activeSnapshot, db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, workspace));
        assertArrayEquals(indexBefore, Files.readAllBytes(repo.resolve(".git/index")));
        assertEquals(baseOid, git(repo, "rev-parse", "HEAD").trim());
        assertEquals(callerHead, Files.readString(sources.resolve("A.java")));
        assertEquals("untracked review note\n", Files.readString(repo.resolve("notes.txt")));
    }

    @Test
    void dependsOnAndCallsStayUnchangedWhenAnUnrelatedCallSiteEditsItsArguments() throws Exception {
        // JavaParserAdapter emits one class-level DEPENDS_ON occurrence per (type, other type) pair, aggregating
        // every contributing site (field/parameter type uses, call receivers, ...) as evidence on that single row.
        // Editing only a call's argument literal changes that aggregated evidence text -- and the resolved CALLS
        // target itself is unchanged -- so neither relationship's topology or multiplicity actually changed.
        Path repo = repository("unrelated-argument-edit");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        String target = "package demo;\nclass B { void one(int n) {} void two() {} }\n";
        String callerBase = "package demo; class A { B b; void run() { b.one(1); } void sibling() {} }\n";
        Files.writeString(sources.resolve("B.java"), target);
        Files.writeString(sources.resolve("A.java"), callerBase);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        String callerHead = callerBase.replace("b.one(1)", "b.one(2)");
        Files.writeString(sources.resolve("A.java"), callerHead);
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");

        assertNull(find(response.path("relationships"), relation ->
                        relation.path("change").asText().equals("REMOVED") && relation.path("base").path("kind").asText().equals("DEPENDS_ON")),
                "The class-level A->B DEPENDS_ON must not be reported REMOVED merely because a call argument's evidence text changed");
        assertNull(find(response.path("relationships"), relation ->
                        relation.path("change").asText().equals("ADDED") && relation.path("head").path("kind").asText().equals("DEPENDS_ON")),
                "The class-level A->B DEPENDS_ON must not be reported ADDED merely because a call argument's evidence text changed");
        assertNotNull(findRelationFrom(response, "UNCHANGED", "DEPENDS_ON", "demo.A"),
                "The unchanged A->B class dependency must still be addressable as a single UNCHANGED relationship");

        assertNull(find(response.path("relationships"), relation ->
                        relation.path("change").asText().equals("REMOVED") && relation.path("base").path("kind").asText().equals("CALLS")),
                "A call to the same resolved method must not be reported REMOVED merely because its argument literal changed");
        assertNull(find(response.path("relationships"), relation ->
                        relation.path("change").asText().equals("ADDED") && relation.path("head").path("kind").asText().equals("CALLS")),
                "A call to the same resolved method must not be reported ADDED merely because its argument literal changed");
        assertNotNull(findRelationFrom(response, "UNCHANGED", "CALLS", "demo.A.run("),
                "The call to the same resolved method must still be addressable as a single UNCHANGED relationship");
    }

    @Test
    void reviewFilesCarryUnifiedHunksAndTheFileEndpointServesBothSides() throws Exception {
        Path repo = repository("file-diff");
        Path demo = repo.resolve("src/main/java/demo");
        Files.createDirectories(demo);
        String baseSource = "package demo;\nclass Diffed {\n    void one() {}\n    void two() {}\n}\n";
        Files.writeString(demo.resolve("Diffed.java"), baseSource);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        String headSource = "package demo;\nclass Diffed {\n    void one() {}\n    void three() {}\n}\n";
        Files.writeString(demo.resolve("Diffed.java"), headSource);
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        JsonNode file = findFile(response, "src/main/java/demo/Diffed.java");
        assertEquals("MODIFIED", file.path("status").asText());
        JsonNode hunks = file.path("hunks");
        assertEquals(1, hunks.size(), hunks.toString());
        JsonNode hunk = hunks.get(0);
        assertEquals(4, hunk.path("oldStart").asInt());
        assertEquals(1, hunk.path("oldCount").asInt());
        assertEquals(4, hunk.path("newStart").asInt());
        assertEquals(1, hunk.path("newCount").asInt());

        // An unchanged file's hunk list is empty, not merely absent.
        Files.writeString(demo.resolve("Stable.java"), "package demo;\nclass Stable {}\n");
        git(repo, "add", "src/main/java/demo/Stable.java");
        git(repo, "commit", "-m", "stable");

        String baseSnapshot = response.path("base").path("snapshotId").asText();
        String headSnapshot = response.path("head").path("snapshotId").asText();
        assertEquals(baseSource, fileSource(baseSnapshot, "src/main/java/demo/Diffed.java"));
        assertEquals(headSource, fileSource(headSnapshot, "src/main/java/demo/Diffed.java"));

        mvc.perform(get("/api/snapshots/{snapshot}/files/source", baseSnapshot)
                        .param("path", "src/main/java/demo/does-not-exist.java"))
                .andExpect(status().isNotFound());
    }

    private String fileSource(String snapshot, String path) throws Exception {
        MvcResult result = mvc.perform(get("/api/snapshots/{snapshot}/files/source", snapshot).param("path", path)).andReturn();
        assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
        return mapper.readTree(result.getResponse().getContentAsString()).path("content").asText();
    }

    @Test
    void countsAddedDeletedUntrackedDefaultPackageAndBinaryFiles() throws Exception {
        Path repo = repository("file-counts");
        Path demo = repo.resolve("src/main/java/demo");
        Files.createDirectories(demo);
        String removedSource = "package demo;\nclass Removed {\n}\n";
        Files.writeString(demo.resolve("Removed.java"), removedSource);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        Files.delete(demo.resolve("Removed.java"));
        Files.createDirectories(demo);
        Files.writeString(demo.resolve("Added.java"), "package demo;\nclass Added {\n}\n");
        Files.writeString(repo.resolve("Plain.java"), "class Plain {\n}\n");
        Files.createDirectories(repo.resolve("assets"));
        Files.write(repo.resolve("assets/icon.bin"), new byte[] {1, 0, 2});
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        assertEquals(5, response.path("summary").path("addedLines").asInt());
        assertEquals(3, response.path("summary").path("removedLines").asInt());
        assertEquals(4, response.path("summary").path("changedFiles").asInt());

        JsonNode added = findFile(response, "src/main/java/demo/Added.java");
        assertEquals("ADDED", added.path("status").asText());
        assertTrue(added.path("javaFile").asBoolean());
        assertTrue(added.path("lineCountsAvailable").asBoolean());
        assertEquals(3, added.path("addedLines").asInt());
        assertEquals(0, added.path("removedLines").asInt());

        JsonNode removed = findFile(response, "src/main/java/demo/Removed.java");
        assertEquals("DELETED", removed.path("status").asText());
        assertTrue(removed.path("javaFile").asBoolean());
        assertTrue(removed.path("lineCountsAvailable").asBoolean());
        assertEquals(0, removed.path("addedLines").asInt());
        assertEquals(3, removed.path("removedLines").asInt());

        JsonNode defaultJava = findFile(response, "Plain.java");
        assertEquals("ADDED", defaultJava.path("status").asText());
        assertTrue(defaultJava.path("javaFile").asBoolean());
        assertEquals(2, defaultJava.path("addedLines").asInt());
        JsonNode defaultPackage = findPackage(response, "(default)");
        assertEquals("ADDED", defaultPackage.path("change").asText());
        assertEquals(2, defaultPackage.path("addedLines").asInt());
        assertEquals("Plain", findNode(response, "Plain", "ADDED").path("head").path("qualifiedName").asText());

        JsonNode namedPackage = findPackage(response, "demo");
        assertEquals("MODIFIED", namedPackage.path("change").asText());
        assertEquals(3, namedPackage.path("addedLines").asInt());
        assertEquals(3, namedPackage.path("removedLines").asInt());

        JsonNode binary = findFile(response, "assets/icon.bin");
        assertEquals("ADDED", binary.path("status").asText());
        assertFalse(binary.path("javaFile").asBoolean());
        assertFalse(binary.path("lineCountsAvailable").asBoolean());
        assertEquals(0, binary.path("addedLines").asInt());
        assertEquals(0, binary.path("removedLines").asInt());
        assertNotNull(find(response.path("diagnostics"), diagnostic ->
                diagnostic.path("code").asText().equals("LINE_COUNTS_UNAVAILABLE")));

        String headSnapshot = response.path("head").path("snapshotId").asText();
        assertEquals("class Plain {\n}\n", source(headSnapshot, "Plain.java"));
        assertEquals("package demo;\nclass Added {\n}\n", source(headSnapshot, "src/main/java/demo/Added.java"));
        assertEquals(0, sourceCount(headSnapshot, "src/main/java/demo/Removed.java"));

        String baseSnapshot = response.path("base").path("snapshotId").asText();
        JsonNode removedNode = findNode(response, "demo.Removed", "REMOVED");
        String removedId = removedNode.path("base").path("id").asText();
        Path outside = Files.createDirectories(temporary.resolve("outside-source"));
        Files.writeString(outside.resolve("Removed.java"), removedSource);
        Files.delete(demo.resolve("Added.java"));
        Files.delete(demo);
        Files.createSymbolicLink(demo, outside);
        MvcResult retainedResult = mvc.perform(get("/api/snapshots/{snapshot}/symbols/{id}/source", baseSnapshot, removedId))
                .andReturn();
        assertEquals(200, retainedResult.getResponse().getStatus(), retainedResult.getResponse().getContentAsString());
        JsonNode retained = mapper.readTree(retainedResult.getResponse().getContentAsString());
        assertEquals("src/main/java/demo/Removed.java", retained.path("path").asText());
        assertEquals(removedSource, retained.path("content").asText());
        assertFalse(retained.path("exact").asBoolean(), "A symlinked ancestor must not make retained source appear live-exact");
    }

    @Test
    void unchangedSiblingAndLineShiftedRelationshipStayUnchangedAcrossRepeatedCalls() throws Exception {
        Path repo = repository("same-line-and-line-shift");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        String target = "package demo;\nclass Target { void one() {} void two() {} }\n";
        String callerBase = "package demo; class Caller { Target t; void changed() { t.one(); } void sibling() {} }\n";
        String shiftedBase = "package demo;\nclass Shifted {\n    void same(Target t) { t.one(); }\n}\n";
        String repeatedBase = "package demo;\nclass Repeated {\n    void twice(Target t) {\n        t.one();\n        t.one();\n    }\n}\n";
        Files.writeString(sources.resolve("Target.java"), target);
        Files.writeString(sources.resolve("Caller.java"), callerBase);
        Files.writeString(sources.resolve("Shifted.java"), shiftedBase);
        Files.writeString(sources.resolve("Repeated.java"), repeatedBase);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        String callerHead = callerBase.replace("t.one()", "t.two()");
        String shiftedHead = "package demo;\nclass Shifted {\n    // Added context moves the call down one line.\n    void same(Target t) { t.one(); }\n}\n";
        String repeatedHead = "package demo;\nclass Repeated {\n    void twice(Target t) {\n        t.one();\n    }\n}\n";
        Files.writeString(sources.resolve("Caller.java"), callerHead);
        Files.writeString(sources.resolve("Shifted.java"), shiftedHead);
        Files.writeString(sources.resolve("Repeated.java"), repeatedHead);
        byte[] indexBefore = Files.readAllBytes(repo.resolve(".git/index"));
        String headOid = git(repo, "rev-parse", "HEAD").trim();
        String workspace = registerWorkspace(repo);
        String activeSnapshot = addActiveAnalysisSnapshot(workspace);

        JsonNode first = createReview(workspace, "HEAD");
        assertEquals("MODIFIED", findNode(first, "demo.Caller.changed(", "MODIFIED").path("change").asText());
        JsonNode sibling = findNode(first, "demo.Caller.sibling()", "UNCHANGED");
        assertEquals("UNCHANGED", sibling.path("change").asText());
        assertEquals(0, sibling.path("addedLines").asInt());
        assertEquals(0, sibling.path("removedLines").asInt());
        assertNotNull(find(first.path("nodes"), node -> node.path("change").asText().equals("UNCHANGED") &&
                node.path("head").path("qualifiedName").asText().contains("demo.Shifted.same(")));

        Set<String> firstUnchangedCalls = comparisonKeys(first, "UNCHANGED", "CALLS");
        assertFalse(firstUnchangedCalls.isEmpty(), "The line-shifted call must match across captures");
        JsonNode shiftedCall = findRelationFrom(first, "UNCHANGED", "CALLS", "demo.Shifted.same(");
        assertNotNull(shiftedCall, "The call whose source line moved must remain unchanged");
        assertEquals(1, countRelationsFrom(first, "UNCHANGED", "CALLS", "head", "demo.Repeated.twice("));
        assertEquals(1, countRelationsFrom(first, "REMOVED", "CALLS", "base", "demo.Repeated.twice("),
                "Two identical source occurrences becoming one must preserve multiplicity");
        assertNotNull(find(first.path("relationships"), relation -> relation.path("change").asText().equals("REMOVED")));
        assertNotNull(find(first.path("relationships"), relation -> relation.path("change").asText().equals("ADDED")));

        String firstBaseSnapshot = first.path("base").path("snapshotId").asText();
        String firstHeadSnapshot = first.path("head").path("snapshotId").asText();
        assertEquals(callerBase, source(firstBaseSnapshot, "src/main/java/demo/Caller.java"));
        assertEquals(callerHead, source(firstHeadSnapshot, "src/main/java/demo/Caller.java"));
        assertEquals(shiftedBase, source(firstBaseSnapshot, "src/main/java/demo/Shifted.java"));
        assertEquals(shiftedHead, source(firstHeadSnapshot, "src/main/java/demo/Shifted.java"));
        assertEquals(repeatedBase, source(firstBaseSnapshot, "src/main/java/demo/Repeated.java"));
        assertEquals(repeatedHead, source(firstHeadSnapshot, "src/main/java/demo/Repeated.java"));

        JsonNode second = createReview(workspace, "HEAD");
        assertNotEquals(firstBaseSnapshot, second.path("base").path("snapshotId").asText());
        assertNotEquals(firstHeadSnapshot, second.path("head").path("snapshotId").asText());
        assertEquals(firstUnchangedCalls, comparisonKeys(second, "UNCHANGED", "CALLS"));
        assertTrue(comparisonKeys(second, "UNCHANGED", "CALLS").contains(shiftedCall.path("comparisonKey").asText()));

        assertEquals(callerBase, source(firstBaseSnapshot, "src/main/java/demo/Caller.java"));
        assertEquals(callerHead, source(firstHeadSnapshot, "src/main/java/demo/Caller.java"));
        assertEquals(activeSnapshot, db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, workspace));
        assertArrayEquals(indexBefore, Files.readAllBytes(repo.resolve(".git/index")));
        assertEquals(headOid, git(repo, "rev-parse", "HEAD").trim());
        assertEquals(callerHead, Files.readString(sources.resolve("Caller.java")));
        assertEquals(4, reviewSnapshotCount(workspace));
    }

    @Test
    void distinctRepeatedCallsThatDropToOneStillYieldExactlyOneRemoved() throws Exception {
        // Two-phase matching must not let a genuine multiplicity change hide behind leftover pairing: base calls the
        // same method twice with two different evidence texts, and head keeps only one of those two call sites.
        Path repo = repository("distinct-repeated-calls");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        String target = "package demo;\nclass Target { void one(int n) {} }\n";
        String callerBase = "package demo;\nclass Caller {\n    void twice(Target t) {\n        t.one(1);\n        t.one(2);\n    }\n}\n";
        Files.writeString(sources.resolve("Target.java"), target);
        Files.writeString(sources.resolve("Caller.java"), callerBase);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        String callerHead = "package demo;\nclass Caller {\n    void twice(Target t) {\n        t.one(1);\n    }\n}\n";
        Files.writeString(sources.resolve("Caller.java"), callerHead);
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        assertEquals(1, countRelationsFrom(response, "UNCHANGED", "CALLS", "head", "demo.Caller.twice("),
                "The surviving call site's identical evidence must still pair as UNCHANGED");
        assertEquals(1, countRelationsFrom(response, "REMOVED", "CALLS", "base", "demo.Caller.twice("),
                "Dropping one of two distinct calls to the same method is a genuine multiplicity change");
        assertEquals(0, countRelationsFrom(response, "ADDED", "CALLS", "head", "demo.Caller.twice("));
    }

    @Test
    void aCallMovedToAnotherMethodIsStillRemovedAndAddedNotPairedByLeftoverMatching() throws Exception {
        // Leftover (phase-2) pairing only happens inside one structural key, and a CALLS key includes its source
        // method. A call that moves from one method to another therefore changes key and must still surface as a
        // REMOVED call from the old method plus an ADDED call from the new one, even with a different argument.
        Path repo = repository("moved-call");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        String target = "package demo;\nclass Target { void one(int n) {} }\n";
        String callerBase = "package demo;\nclass Caller {\n    void run(Target t) {\n        t.one(1);\n    }\n    void sibling(Target t) {\n    }\n}\n";
        Files.writeString(sources.resolve("Target.java"), target);
        Files.writeString(sources.resolve("Caller.java"), callerBase);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");

        String callerHead = "package demo;\nclass Caller {\n    void run(Target t) {\n    }\n    void sibling(Target t) {\n        t.one(2);\n    }\n}\n";
        Files.writeString(sources.resolve("Caller.java"), callerHead);
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        assertEquals(1, countRelationsFrom(response, "REMOVED", "CALLS", "base", "demo.Caller.run("),
                "The call that left run() must be REMOVED");
        assertEquals(1, countRelationsFrom(response, "ADDED", "CALLS", "head", "demo.Caller.sibling("),
                "The call that arrived in sibling() must be ADDED");
        assertEquals(0, countRelationsFrom(response, "UNCHANGED", "CALLS", "head", "demo.Caller.sibling("),
                "A moved call must not be paired UNCHANGED across different source methods");
    }

    @Test
    void publishesPartialCaptureAndReportsMalformedJavaDiagnostics() throws Exception {
        Path repo = repository("partial-parser");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        String valid = "package demo;\nclass Good { void ok() {} }\n";
        Files.writeString(sources.resolve("Good.java"), valid);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        Path malformed = sources.resolve("Broken.java");
        Files.writeString(malformed, "package demo;\nclass Broken { void incomplete( {\n");
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        String headSnapshot = response.path("head").path("snapshotId").asText();
        assertEquals("published", snapshot(headSnapshot).path("status").asText());
        assertEquals(1, sourceCount(headSnapshot, "src/main/java/demo/Broken.java"));
        assertEquals("demo.Good", findNode(response, "demo.Good", "UNCHANGED").path("head").path("qualifiedName").asText());
        assertNull(find(response.path("nodes"), node -> node.path("head").path("qualifiedName").asText().equals("demo.Broken")));
        JsonNode parseWarning = find(response.path("diagnostics"), diagnostic ->
                diagnostic.path("code").asText().equals("ANALYSIS_WARNING_HEAD") &&
                        diagnostic.path("message").asText().contains("Broken.java"));
        assertNotNull(parseWarning, "A malformed file must remain visible as an analysis diagnostic");
        assertEquals("WARNING", parseWarning.path("severity").asText());
    }

    @Test
    void aFileThatNoLongerParsesIsUnknownNotRemovedWhileARealDeletionStaysRemoved() throws Exception {
        Path repo = repository("unparsed-head");
        Path sources = repo.resolve("src/main/java/demo");
        Files.createDirectories(sources);
        Files.writeString(sources.resolve("Target.java"), "package demo;\nclass Target { void one() {} }\n");
        Files.writeString(sources.resolve("Service.java"), "package demo;\nclass Service { void run(Target t) { t.one(); } }\n");
        Files.writeString(sources.resolve("Client.java"), "package demo;\nclass Client { void use(Service s) { s.run(null); } }\n");
        Files.writeString(sources.resolve("Gone.java"), "package demo;\nclass Gone { void call(Target t) { t.one(); } }\n");
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        Files.writeString(sources.resolve("Service.java"), "package demo;\nclass Service { Object run(Target t) { return  null\n } }\n");
        Files.delete(sources.resolve("Gone.java"));
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        assertNotNull(findNode(response, "demo.Service", "UNKNOWN").path("base").path("id").asText(null));
        assertNull(find(response.path("nodes"), n -> n.path("change").asText().equals("REMOVED") &&
                n.path("base").path("qualifiedName").asText().startsWith("demo.Service")), "An unparsed declaration is not a deletion");
        assertEquals(1, countRelationsFrom(response, "UNKNOWN", "CALLS", "base", "demo.Service.run("), "The unparsed file's own call is unknown");
        assertEquals(1, countRelationsFrom(response, "UNKNOWN", "CALLS", "base", "demo.Client.use("), "A call into the unparsed file is unknown");
        assertEquals(0, countRelationsFrom(response, "REMOVED", "CALLS", "base", "demo.Service.run("));
        assertEquals(0, countRelationsFrom(response, "REMOVED", "CALLS", "base", "demo.Client.use("));
        findNode(response, "demo.Gone", "REMOVED");
        assertEquals(1, countRelationsFrom(response, "REMOVED", "CALLS", "base", "demo.Gone.call("), "A deleted file stays REMOVED");
        findNode(response, "demo.Target", "UNCHANGED");
    }

    @Test
    void reportsBadBaseAsClientErrorBeforeCreatingReviewSnapshots() throws Exception {
        Path repo = repository("bad-base");
        Files.writeString(repo.resolve("Example.java"), "class Example {}\n");
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        String workspace = registerWorkspace(repo);

        MvcResult result = mvc.perform(post("/api/workspaces/{id}/reviews", workspace)
                        .contentType(APPLICATION_JSON)
                        .content("{\"schemaVersion\":\"1\",\"baseRef\":\"missing-local-review-base\"}"))
                .andReturn();

        assertEquals(400, result.getResponse().getStatus());
        JsonNode error = mapper.readTree(result.getResponse().getContentAsString());
        assertEquals("Bad Request", error.path("error").asText());
        // The message names the revision and the repository it was looked up in, and says what to do: a base typed
        // for one repository does not exist in another.
        assertEquals("Base revision \"missing-local-review-base\" is not a commit in the Git repository at " + repo.toRealPath()
                + ". Clear Base revision to compare with the default (the merge base with the upstream branch, else HEAD),"
                + " or enter a commit, branch or tag from that repository.", error.path("message").asText());
        assertEquals(0, reviewSnapshotCount(workspace));
    }

    @Test
    void replacedWorkspaceRootCannotMakeRetainedSourceAppearLiveExact() throws Exception {
        Path repo = repository("replaced-workspace-root");
        Path source = repo.resolve("Example.java");
        String content = "class Example {}\n";
        Files.writeString(source, content);
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        String workspace = registerWorkspace(repo);

        JsonNode response = createReview(workspace, "HEAD");
        String snapshot = response.path("head").path("snapshotId").asText();
        String symbolId = findNode(response, "Example", "UNCHANGED").path("head").path("id").asText();

        Path moved = temporary.resolve("replaced-workspace-root-real");
        Files.move(repo, moved);
        Path outside = temporary.resolve("outside-workspace-root");
        Files.createDirectories(outside);
        Files.writeString(outside.resolve("Example.java"), content);
        Files.createSymbolicLink(repo, outside);

        MvcResult result = mvc.perform(get("/api/snapshots/{snapshot}/symbols/{id}/source", snapshot, symbolId))
                .andReturn();
        assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
        JsonNode retained = mapper.readTree(result.getResponse().getContentAsString());
        assertEquals(content, retained.path("content").asText());
        assertFalse(retained.path("exact").asBoolean(), "A replaced workspace root must not make retained source appear live-exact");
    }

    @Test
    void removesBaseSnapshotAndSourceWhenHeadSnapshotCreationFails() throws Exception {
        Path repo = repository("head-insert-failure");
        Files.writeString(repo.resolve("Example.java"), "class Example {}\n");
        git(repo, "add", ".");
        git(repo, "commit", "-m", "base");
        String workspace = registerWorkspace(repo);
        String activeSnapshot = addActiveAnalysisSnapshot(workspace);
        String trigger = "review_test_fail_head_insert";
        db.execute("CREATE TRIGGER " + trigger + " BEFORE INSERT ON snapshots WHEN NEW.purpose='REVIEW_HEAD' " +
                "BEGIN SELECT RAISE(ABORT, 'forced review test failure'); END");

        try {
            MvcResult result = mvc.perform(post("/api/workspaces/{id}/reviews", workspace)
                            .contentType(APPLICATION_JSON)
                            .content("{\"schemaVersion\":\"1\",\"baseRef\":\"HEAD\"}"))
                    .andReturn();

            assertEquals(500, result.getResponse().getStatus());
            assertEquals(0, reviewSnapshotCount(workspace));
            assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM source_file_versions f JOIN snapshots s ON s.id=f.snapshot_id " +
                    "WHERE s.workspace_id=? AND s.purpose LIKE 'REVIEW_%'", Integer.class, workspace));
            assertEquals(activeSnapshot, db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id=?", String.class, workspace));
        } finally {
            db.execute("DROP TRIGGER IF EXISTS " + trigger);
        }
    }

    private JsonNode createReview(String workspace, String baseRef) throws Exception {
        MvcResult result = mvc.perform(post("/api/workspaces/{id}/reviews", workspace)
                        .contentType(APPLICATION_JSON)
                        .content(mapper.createObjectNode().put("schemaVersion", "1").put("baseRef", baseRef).toString()))
                .andReturn();
        assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private Path repository(String name) throws Exception {
        Path repo = Files.createDirectories(temporary.resolve(name));
        git(repo, "init", "--initial-branch=main");
        git(repo, "config", "user.name", "Review API Test");
        git(repo, "config", "user.email", "review@example.invalid");
        git(repo, "config", "commit.gpgsign", "false");
        return repo;
    }

    private String registerWorkspace(Path repo) {
        String workspace = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces(id,canonical_root,display_name,created_at,updated_at) VALUES(?,?,?,datetime('now'),datetime('now'))",
                workspace, repo.toAbsolutePath().normalize().toString(), "review-api-test");
        return workspace;
    }

    private String addActiveAnalysisSnapshot(String workspace) {
        String snapshot = UUID.randomUUID().toString();
        db.update("INSERT INTO snapshots(id,workspace_id,status,purpose,created_at) VALUES(?,?,'published','ANALYSIS',datetime('now'))",
                snapshot, workspace);
        db.update("UPDATE workspaces SET active_snapshot_id=? WHERE id=?", snapshot, workspace);
        return snapshot;
    }

    private String source(String snapshot, String relativePath) {
        return db.queryForObject("SELECT source_content FROM source_file_versions WHERE snapshot_id=? AND relative_path=?",
                String.class, snapshot, relativePath);
    }

    private int sourceCount(String snapshot, String relativePath) {
        return db.queryForObject("SELECT COUNT(*) FROM source_file_versions WHERE snapshot_id=? AND relative_path=?",
                Integer.class, snapshot, relativePath);
    }

    private JsonNode snapshot(String id) {
        return mapper.valueToTree(db.queryForMap("SELECT status,purpose FROM snapshots WHERE id=?", id));
    }

    private String snapshotLanguage(String id) {
        return db.queryForObject("SELECT language FROM snapshots WHERE id=?", String.class, id);
    }

    private JsonNode relationshipEvidence(String snapshot, String relationshipId) throws Exception {
        MvcResult result = mvc.perform(post("/api/snapshots/{snapshot}/relationships/source", snapshot)
                        .contentType(APPLICATION_JSON)
                        .content(mapper.createObjectNode()
                                .set("ids", mapper.createArrayNode().add(relationshipId)).toString()))
                .andReturn();
        assertEquals(200, result.getResponse().getStatus(), result.getResponse().getContentAsString());
        return mapper.readTree(result.getResponse().getContentAsString());
    }

    private int reviewSnapshotCount(String workspace) {
        return db.queryForObject("SELECT COUNT(*) FROM snapshots WHERE workspace_id=? AND purpose IN ('REVIEW_BASE','REVIEW_HEAD')",
                Integer.class, workspace);
    }

    private JsonNode findFile(JsonNode response, String path) {
        JsonNode file = find(response.path("files"), item -> item.path("path").asText().equals(path));
        assertNotNull(file, "Missing review file " + path);
        return file;
    }

    private JsonNode findPackage(JsonNode response, String qualifiedName) {
        JsonNode node = find(response.path("nodes"), item -> {
            JsonNode graphNode = item.path("head").isObject() ? item.path("head") : item.path("base");
            return graphNode.path("kind").asText().equals("PACKAGE") && graphNode.path("qualifiedName").asText().equals(qualifiedName);
        });
        assertNotNull(node, "Missing package review node " + qualifiedName);
        return node;
    }

    private JsonNode findNode(JsonNode response, String qualifiedNameFragment, String change) {
        JsonNode node = find(response.path("nodes"), item -> item.path("change").asText().equals(change) &&
                (item.path("head").path("qualifiedName").asText().contains(qualifiedNameFragment) ||
                        item.path("base").path("qualifiedName").asText().contains(qualifiedNameFragment)));
        assertNotNull(node, "Missing " + change + " review node matching " + qualifiedNameFragment);
        return node;
    }

    private JsonNode findRelationFrom(JsonNode response, String change, String kind, String sourceName) {
        return find(response.path("relationships"), relation -> {
            JsonNode edge = relation.path("head");
            if (!relation.path("change").asText().equals(change) || !edge.path("kind").asText().equals(kind)) return false;
            String sourceId = edge.path("sourceId").asText();
            JsonNode source = find(response.path("nodes"), node -> node.path("head").path("id").asText().equals(sourceId));
            return source != null && source.path("head").path("qualifiedName").asText().contains(sourceName);
        });
    }

    private long countRelationsFrom(JsonNode response, String change, String kind, String side, String sourceName) {
        long count = 0;
        JsonNode relationships = response.path("relationships");
        if (!relationships.isArray()) return count;
        for (JsonNode relation : relationships) {
            JsonNode edge = relation.path(side);
            if (!relation.path("change").asText().equals(change) || !edge.path("kind").asText().equals(kind)) continue;
            String sourceId = edge.path("sourceId").asText();
            JsonNode source = find(response.path("nodes"), node -> node.path(side).path("id").asText().equals(sourceId));
            if (source != null && source.path(side).path("qualifiedName").asText().contains(sourceName)) count++;
        }
        return count;
    }

    private Set<String> comparisonKeys(JsonNode response, String change, String kind) {
        Set<String> keys = new HashSet<>();
        JsonNode relationships = response.path("relationships");
        if (relationships.isArray()) for (JsonNode relation : relationships) {
            if (relation.path("change").asText().equals(change) && relation.path("head").path("kind").asText().equals(kind)) {
                keys.add(relation.path("comparisonKey").asText());
            }
        }
        return keys;
    }

    private JsonNode find(JsonNode array, Predicate<JsonNode> predicate) {
        if (array.isArray()) for (JsonNode node : array) if (predicate.test(node)) return node;
        return null;
    }

    private String git(Path repo, String... arguments) throws Exception {
        List<String> command = new ArrayList<>(List.of("git", "-C", repo.toString()));
        command.addAll(List.of(arguments));
        ProcessBuilder builder = new ProcessBuilder(command).redirectErrorStream(true);
        builder.environment().put("GIT_CONFIG_NOSYSTEM", "1");
        builder.environment().put("GIT_CONFIG_GLOBAL", "/dev/null");
        builder.environment().put("GIT_TERMINAL_PROMPT", "0");
        builder.environment().put("GIT_OPTIONAL_LOCKS", "0");
        Process process = builder.start();
        assertTrue(process.waitFor(20, TimeUnit.SECONDS), "Git setup timed out: " + command);
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals(0, process.exitValue(), output);
        return output;
    }

    private static Path createDataDirectory() {
        try {
            return Files.createDirectories(Files.createTempDirectory("atlas-review-api-").resolve("build/application-data"));
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Could not create isolated review test data.", e);
        }
    }
}
