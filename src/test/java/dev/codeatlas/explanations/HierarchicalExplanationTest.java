package dev.codeatlas.explanations;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.graph.GraphQueryService;
import dev.codeatlas.modelclient.ModelClientService;
import dev.codeatlas.workspace.ProjectDocumentService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@SpringBootTest
class HierarchicalExplanationTest {
    static final Path data;
    static { try { data = Files.createTempDirectory("atlas-hierarchy-"); } catch (Exception e) { throw new RuntimeException(e); } }
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", () -> data.toString());
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + data.resolve("test.db"));
    }
    @Autowired JdbcTemplate db;
    @Autowired ExplanationQueueService queue;
    @Autowired ExplanationService explanations;
    @Autowired ContextBuilder context;
    @Autowired ProjectDocumentService documents;
    @Autowired CodeAtlasProperties properties;
    @Autowired GraphQueryService graph;
    @MockitoBean ModelClientService model;
    final ObjectMapper json = new ObjectMapper();
    String ws, snapshot;

    @BeforeEach void fixture() {
        queue.stopWorker();
        // Tests use independent snapshot identities; no target repository is evaluated.
        db.update("UPDATE jobs SET status = 'CANCELLED' WHERE status = 'RUNNING'");
        db.update("UPDATE explanation_queue SET status = 'SKIPPED' WHERE status IN ('PENDING','IN_PROGRESS')");
        ws = UUID.randomUUID().toString(); snapshot = UUID.randomUUID().toString();
        properties.getModel().setContextBudget(100_000);
        properties.getModel().setOutputBudget(4096);
        properties.getModel().setModelId("fixture-model");
        properties.getModel().setBaseUrl("http://127.0.0.1:19999/v1");
        db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'Hierarchy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", ws, "/tmp/hierarchy-" + ws);
        db.update("INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES (?, ?, 'published', CURRENT_TIMESTAMP)", snapshot, ws);
        symbol("package-a", "PACKAGE", null, 1);
        symbol("package-b", "PACKAGE", null, 1);
        symbol("class-a", "CLASS", "package-a", 20);
        symbol("class-b", "CLASS", "package-b", 8);
        symbol("a-short", "METHOD", "class-a", 2);
        symbol("b-tie", "METHOD", "class-a", 2);
        symbol("long", "METHOD", "class-a", 5);
        symbol("caller", "METHOD", "class-a", 4);
        symbol("called", "METHOD", "class-b", 3);
        symbol("field", "FIELD", "class-a", 1);
        symbol("constructor", "CONSTRUCTOR", "class-a", 1);
        symbol("interface", "INTERFACE", "package-b", 5);
        relationship("inject", "class-a", "class-b", "INJECTS");
        relationship("call-one", "caller", "called", "CALLS");
        relationship("call-two", "caller", "called", "CALLS");
        relationship("unresolved", "caller", null, "CALLS");
    }

    String id(String name) { return snapshot + ":" + name; }
    void symbol(String name, String kind, String parent, int loc) {
        db.update("INSERT INTO logical_symbols (workspace_id, key) VALUES (?, ?)", ws, name);
        db.update("INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, parent_symbol_id, roles, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[\"SERVICE\"]', ?)", id(name), snapshot, name, ws, kind, "demo." + name, name, parent == null ? null : id(parent), name);
        db.update("INSERT INTO source_file_versions (id, snapshot_id, relative_path, content_hash, source_content) VALUES (?, ?, ?, ?, ?)", id("file-" + name), snapshot, name + ".java", name, "// source of " + name);
        db.update("INSERT INTO evidence (id, source_file_version_id, start_line, start_column, end_line, end_column, snippet) VALUES (?, ?, 1, 1, ?, 10, ?)", id("ev-" + name), id("file-" + name), loc, "// exact declaration of " + name);
        db.update("INSERT INTO symbol_evidence (symbol_version_id, evidence_id) VALUES (?, ?)", id(name), id("ev-" + name));
    }
    void relationship(String name, String source, String target, String kind) {
        db.update("INSERT INTO relationship_occurrences (id, snapshot_id, source_symbol_id, target_symbol_id, unresolved_target, kind, resolution) VALUES (?, ?, ?, ?, ?, ?, ?)", id(name), snapshot, id(source), target == null ? null : id(target), target == null ? "external.send()" : null, kind, target == null ? "UNRESOLVED" : "CANDIDATE");
        db.update("INSERT INTO relationship_evidence (relationship_id, evidence_id) VALUES (?, ?)", id(name), id("ev-" + source));
    }
    String synthesis() throws Exception {
        return json.writeValueAsString(Map.of("classes", List.of(Map.of("symbolId", id("class-a"), "businessLogic", "Coordinates shipments."), Map.of("symbolId", id("class-b"), "businessLogic", "Stores shipment records."))));
    }
    String full(String label) throws Exception {
        return json.writeValueAsString(Map.of("shortLabel", label, "hoverSummary", "Behavior for " + label, "claims", List.of(Map.of("description", "Visible declaration", "basis", "SOURCE_FACT", "evidenceIds", List.of("ev-source"))), "unknowns", List.of("Runtime dispatch is not established.")));
    }
    void normalModel(List<String> calls) throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenAnswer(invocation -> {
            String system = invocation.getArgument(0), user = invocation.getArgument(1);
            if (system.startsWith("Infer concise")) { calls.add("architecture"); return synthesis(); }
            String subject = user.substring(user.indexOf("TARGET SYMBOL: ") + 15).split(" ")[0];
            calls.add(subject);
            assertEquals(2, db.queryForObject("SELECT COUNT(*) FROM class_pre_explanations p JOIN explanation_syntheses a ON a.id = p.synthesis_id WHERE a.snapshot_id = ? AND a.status = 'READY'", Integer.class, snapshot));
            return full(subject);
        });
    }
    List<String> ordered() { return List.of("a-short", "b-tie", "long", "class-b", "class-a", "called", "caller").stream().map(this::id).toList(); }

    @Test void synthesisPrecedesExactDegreeLocOrderAndExcludesEveryNonClassMethod() throws Exception {
        documents.save(ws, null, "Purpose", "Shipments cross package boundaries. Last document sentence.");
        var requests = new ArrayList<String>(); normalModel(requests);
        String job = queue.startExplainAllJob(ws, snapshot, 4);
        assertEquals(ordered(), db.queryForList("SELECT subject_id FROM explanation_queue WHERE job_id = ? ORDER BY relation_count, loc, subject_id", String.class, job));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE snapshot_id = ? AND subject_type = 'relationship'", Integer.class, snapshot));
        assertEquals(3, db.queryForObject("SELECT relation_count FROM explanation_queue WHERE subject_id = ?", Integer.class, id("caller")));
        for (int i = 0; i < 8; i++) assertTrue(queue.processNextItem());
        assertFalse(queue.processNextItem());
        var expected = new ArrayList<>(List.of("architecture")); expected.addAll(ordered()); assertEquals(expected, requests);
        assertEquals("COMPLETED", db.queryForObject("SELECT status FROM jobs WHERE id = ?", String.class, job));
        assertEquals(7, db.queryForObject("SELECT completed_items FROM jobs WHERE id = ?", Integer.class, job));
        verify(model).getExplanation(argThat(s -> s.startsWith("Infer concise")), argThat(s -> s.contains("Last document sentence.") && s.contains("Complete package tree") && s.contains("Package coupling") && s.contains("SERVICE")));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id = ? AND subject_type = 'relationship'", Integer.class, snapshot));
    }

    @Test void draftsDoNotCountAsReadyAndResumeReusesSynthesisAndSuccessfulItems() throws Exception {
        var requests = new ArrayList<String>(); normalModel(requests);
        String first = queue.startExplainAllJob(ws, snapshot, 1);
        queue.processNextItem();
        var draft = explanations.getExplanationForSymbol(snapshot, id("class-a"));
        assertEquals("QUEUED", draft.status().name());
        assertEquals("DRAFT", draft.preExplanation().status());
        assertTrue(draft.preExplanation().provenance().contains("fixture-model"));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id = ?", Integer.class, snapshot));
        queue.processNextItem(); queue.cancelJob(first);
        String resumed = queue.startExplainAllJob(ws, snapshot, 1);
        assertNotEquals(first, resumed);
        assertEquals(6, db.queryForObject("SELECT total_items FROM jobs WHERE id = ?", Integer.class, resumed));
        queue.processNextItem(); // Cached synthesis establishes barrier without another request.
        assertEquals(List.of("architecture", id("a-short")), requests);
        queue.processNextItem(); assertEquals(id("b-tie"), requests.getLast());
    }

    @Test void incompleteDuplicateAndForeignIdsNeverPartiallySaveDrafts() throws Exception {
        for (String response : List.of("not JSON", "{\"classes\":[]}", json.writeValueAsString(Map.of("classes", List.of(Map.of("symbolId", "foreign", "businessLogic", "Invented")))), json.writeValueAsString(Map.of("classes", List.of(Map.of("symbolId", id("class-a"), "businessLogic", "Purpose"), Map.of("symbolId", id("class-a"), "businessLogic", "Duplicate")))))) {
            when(model.getExplanation(anyString(), anyString())).thenReturn(response);
            assertThrows(ExplanationService.SynthesisException.class, () -> explanations.synthesizeArchitecture(snapshot));
            assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanation_syntheses WHERE snapshot_id = ?", Integer.class, snapshot));
        }
        verify(model, times(4)).getExplanation(anyString(), anyString()); // No hidden repair turns.
    }

    @Test void synthesisFailureBlocksSymbolsButExplicitEdgesStillWork() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn("{\"classes\":[]}");
        String job = queue.startExplainAllJob(ws, snapshot, 1);
        assertTrue(queue.processNextItem()); assertFalse(queue.processNextItem());
        assertEquals("FAILED", db.queryForObject("SELECT status FROM jobs WHERE id = ?", String.class, job));
        assertTrue(queue.getQueueStatus(ws).errorMessage().contains("every CLASS"));
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("An explicit edge"));
        queue.enqueueExplanation(ws, snapshot, id("call-one"), "relationship"); queue.processNextItem();
        assertEquals("READY", explanations.getExplanation(snapshot, id("call-one"), "relationship").status().name());
        assertEquals("READY", graph.getGraph(snapshot).edges().stream().filter(e -> e.id().equals(id("call-one"))).findFirst().orElseThrow().explanationStatus().name());
    }

    @Test void oversizedGlobalContextFailsWithoutDroppingDocumentsOrCallingModel() {
        properties.getModel().setContextBudget(8192);
        documents.save(ws, null, "Large guide", "x".repeat(12000) + "TAIL");
        assertTrue(context.buildArchitectureContext(snapshot).formattedContext().contains("TAIL"));
        assertThrows(ExplanationService.SynthesisException.class, () -> explanations.synthesizeArchitecture(snapshot));
        verifyNoInteractions(model);
    }

    @Test void methodClassAndEdgePromptsPropagateCurrentExplanationsAndEndpointEvidence() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn(synthesis()); explanations.synthesizeArchitecture(snapshot);
        var initial = context.buildSymbolContext(snapshot, id("caller"));
        assertTrue(initial.formattedContext().contains("Coordinates shipments."));
        assertTrue(initial.formattedContext().contains("Stores shipment records."));
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Called method explanation")); explanations.explainSubject(snapshot, id("called"), "symbol");
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Full owner explanation")); explanations.explainSubject(snapshot, id("class-a"), "symbol");
        var method = context.buildSymbolContext(snapshot, id("caller"));
        assertTrue(method.formattedContext().contains("Full owner explanation"));
        assertTrue(method.formattedContext().contains("Called method explanation"));
        assertTrue(method.formattedContext().contains("// exact declaration of called"));
        var owner = context.buildSymbolContext(snapshot, id("class-b"));
        assertTrue(owner.formattedContext().contains("Stores shipment records."));
        assertTrue(owner.formattedContext().contains("Called method explanation"));
        assertTrue(owner.formattedContext().contains("Full owner explanation"));
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Caller method explanation")); explanations.explainSubject(snapshot, id("caller"), "symbol");
        var edge = context.buildContext(snapshot, id("call-one"), "relationship");
        for (String expected : List.of("Caller method explanation", "Called method explanation", "// exact declaration of caller", "// exact declaration of called", "start_column=1", "caller.java", "CANDIDATE")) assertTrue(edge.formattedContext().contains(expected), expected);
        var unresolved = context.buildContext(snapshot, id("unresolved"), "relationship");
        assertTrue(unresolved.formattedContext().contains("external.send()"));
        assertTrue(unresolved.formattedContext().contains("UNRESOLVED"));
    }

    @Test void generatedOnlyCitationsCannotBecomeSourceFacts() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn(synthesis()); explanations.synthesizeArchitecture(snapshot);
        String invented = json.writeValueAsString(Map.of("shortLabel", "Invented", "hoverSummary", "Invented", "claims", List.of(Map.of("description", "Generated prose is proof", "basis", "SOURCE_FACT", "evidenceIds", List.of("ai-" + id("class-a"))))));
        when(model.getExplanation(anyString(), anyString())).thenReturn(invented);
        assertThrows(IllegalArgumentException.class, () -> explanations.explainSubject(snapshot, id("caller"), "symbol"));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id = ?", Integer.class, snapshot));
    }

    @Test void documentChangesStaleDraftsAndBlockMidFlightSynthesisPublication() throws Exception {
        var doc = documents.save(ws, null, "Purpose", "Original");
        when(model.getExplanation(anyString(), anyString())).thenReturn(synthesis()); explanations.synthesizeArchitecture(snapshot);
        documents.save(ws, doc.id(), doc.title(), "Changed");
        assertEquals("STALE", explanations.getExplanationForSymbol(snapshot, id("class-a")).preExplanation().status());
        assertNull(context.priorExplanation(snapshot, id("class-a")));
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> { documents.save(ws, doc.id(), doc.title(), "Changed during generation"); return synthesis(); });
        assertThrows(ExplanationService.SynthesisException.class, () -> explanations.synthesizeArchitecture(snapshot));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanation_syntheses WHERE snapshot_id = ? AND status = 'READY'", Integer.class, snapshot));
    }

    @Test void consumedProseRefreshInvalidatesDependentButNewProseDoesNot() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Old callee")); explanations.explainSubject(snapshot, id("called"), "symbol");
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Caller")); explanations.explainSubject(snapshot, id("caller"), "symbol");
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Independent")); explanations.explainSubject(snapshot, id("a-short"), "symbol");
        assertEquals("READY", explanations.getExplanationForSymbol(snapshot, id("caller")).status().name());
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Changed callee")); explanations.explainSubject(snapshot, id("called"), "symbol");
        assertEquals("STALE", explanations.getExplanationForSymbol(snapshot, id("caller")).status().name());
        assertEquals("READY", explanations.getExplanationForSymbol(snapshot, id("a-short")).status().name());
        assertTrue(explanations.getEvidence(snapshot, id("caller"), "symbol").toString().contains("Old callee"));
    }

    @Test void cancelDuringSynthesisDoesNotReleaseSymbolsAndRestartRecoversBarrier() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> { entered.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return synthesis(); });
        String job = queue.startExplainAllJob(ws, snapshot, 4);
        var task = CompletableFuture.supplyAsync(queue::processNextItem);
        assertTrue(entered.await(5, TimeUnit.SECONDS)); queue.cancelJob(job); release.countDown(); assertTrue(task.get(5, TimeUnit.SECONDS));
        assertEquals("CANCELLED", db.queryForObject("SELECT status FROM jobs WHERE id = ?", String.class, job));
        assertFalse(queue.processNextItem());
        String resumed = queue.startExplainAllJob(ws, snapshot, 1);
        db.update("UPDATE jobs SET synthesis_status = 'RUNNING' WHERE id = ?", resumed);
        db.update("UPDATE explanation_queue SET status = 'IN_PROGRESS' WHERE job_id = ? AND subject_id = ?", resumed, id("a-short"));
        queue.recoverAbandonedWork();
        assertEquals("PENDING", db.queryForObject("SELECT synthesis_status FROM jobs WHERE id = ?", String.class, resumed));
        assertEquals("PENDING", db.queryForObject("SELECT status FROM explanation_queue WHERE subject_id = ?", String.class, id("a-short")));
        assertTrue(queue.processNextItem()); verify(model, times(1)).getExplanation(anyString(), anyString());
    }
    @Test void cancellationDuringFailedItemDoesNotResurrectPendingWork() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn(synthesis());
        String job = queue.startExplainAllJob(ws, snapshot, 1);
        queue.processNextItem();
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            queue.cancelJob(job);
            throw new IllegalStateException("PRIVATE_RESPONSE_CANARY");
        });
        queue.processNextItem();
        assertEquals("CANCELLED", db.queryForObject("SELECT status FROM jobs WHERE id = ?", String.class, job));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE job_id = ? AND status IN ('PENDING','IN_PROGRESS')", Integer.class, job));
        assertFalse(db.queryForObject("SELECT last_error FROM explanation_queue WHERE subject_id = ?", String.class, id("a-short")).contains("PRIVATE_RESPONSE_CANARY"));
        assertFalse(queue.processNextItem());
    }

    @Test void incomingCallerExplanationsAndMidGenerationChangesAreTracked() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("Existing caller"));
        explanations.explainSubject(snapshot, id("caller"), "symbol");
        assertTrue(context.buildSymbolContext(snapshot, id("called")).formattedContext().contains("Existing caller"));
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            db.update("UPDATE explanations SET status = 'STALE' WHERE subject_version_id = ?", id("caller"));
            return full("Callee with changed context");
        });
        explanations.explainSubject(snapshot, id("called"), "symbol");
        assertEquals("STALE", explanations.getExplanationForSymbol(snapshot, id("called")).status().name());
    }

}
