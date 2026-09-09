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
import static org.mockito.ArgumentMatchers.anyInt;
import dev.codeatlas.modelclient.ModelRequestBudget;
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
        // Missing coverage may be retried in smaller batches; malformed/foreign IDs never publish.
    }

    @Test void synthesisFailureBlocksSymbolsButExplicitEdgesStillWork() throws Exception {
        when(model.getExplanation(anyString(), anyString())).thenReturn("{\"classes\":[]}");
        String job = queue.startExplainAllJob(ws, snapshot, 1);
        assertTrue(queue.processNextItem()); assertFalse(queue.processNextItem());
        assertEquals("FAILED", db.queryForObject("SELECT status FROM jobs WHERE id = ?", String.class, job));
        assertNotNull(queue.getQueueStatus(ws).errorMessage());
        when(model.getExplanation(anyString(), anyString())).thenReturn(full("An explicit edge"));
        queue.enqueueExplanation(ws, snapshot, id("call-one"), "relationship"); queue.processNextItem();
        assertEquals("READY", explanations.getExplanation(snapshot, id("call-one"), "relationship").status().name());
        assertEquals("READY", graph.getGraph(snapshot).edges().stream().filter(e -> e.id().equals(id("call-one"))).findFirst().orElseThrow().explanationStatus().name());
    }

    // Respond only to explicitly requested target IDs; inventing or omitting an ID fails validation.
    String batchResponse(String user) throws Exception {
        String selected = user.contains("TARGET CLASSES (complete declarations for this batch):")
            ? user.split("TARGET CLASSES \\(complete declarations for this batch\\):\n", 2)[1].split("\n\\[ev-neighbors\\]", 2)[0] : user;
        var matcher = java.util.regex.Pattern.compile("symbolId=([^,}]+),[^\n]*kind=CLASS").matcher(selected);
        List<Map<String, String>> entries = new ArrayList<>();
        while (matcher.find()) entries.add(Map.of("symbolId", matcher.group(1), "businessLogic", "Coordinates shipment processing; runtime rules need source verification."));
        assertFalse(entries.isEmpty(), selected);
        return json.writeValueAsString(Map.of("classes", entries));
    }

    @Test void fiveHundredClassesAndTenDocumentsUseCompleteBoundedResumableBatches() throws Exception {
        properties.getModel().setContextBudget(8192);
        properties.getModel().setOutputBudget(512);
        for (int i = 0; i < 498; i++) symbol("extra-" + i, "CLASS", "package-b", 4);
        for (int doc = 0; doc < 10; doc++) {
            StringBuilder document = new StringBuilder();
            for (int line = 0; line < 1200; line++) document.append("Guide ").append(doc).append(" rule ").append(line).append(": regional shipment requires validation before dispatch.\n");
            document.append("UNIQUE DOCUMENT TAIL ").append(doc);
            documents.save(ws, null, "Large guide " + doc, document.toString());
        }
        List<String> chunks = new ArrayList<>();
        var budget = new ModelRequestBudget(8192, 512);
        when(model.getExplanation(anyString(), anyString(), anyInt())).thenAnswer(inv -> {
            String system = inv.getArgument(0), user = inv.getArgument(1); int output = inv.getArgument(2);
            assertTrue(budget.fits(system, user, output)); chunks.add(user);
            return "{\"summary\":\"Regional shipment processing; documented rules require verification in source.\"}";
        });
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            assertTrue(budget.fits(inv.getArgument(0), inv.getArgument(1), 512));
            if (!((String)inv.getArgument(0)).startsWith("Infer concise")) return full("Shipment responsibility");
            String response = batchResponse(inv.getArgument(1));
            assertTrue(json.readTree(response).get("classes").size() <= 2);
            return response;
        });
        String job = queue.startExplainAllJob(ws, snapshot, 1);
        queue.processNextItem();
        assertEquals("READY", queue.getQueueStatus(ws).synthesisStatus());
        assertTrue(chunks.size() > 1);
        for (int doc = 0; doc < 10; doc++) assertTrue(String.join("", chunks).contains("UNIQUE DOCUMENT TAIL " + doc));
        // Each original character reaches a summary request; whitespace and split boundaries survive.
        String original = context.buildArchitectureContext(snapshot).formattedContext();
        StringBuilder firstRound = new StringBuilder();
        int firstRoundChunks = 0;
        while (firstRound.length() < original.length()) {
            String chunk = chunks.get(firstRoundChunks++);
            firstRound.append(chunk.substring(chunk.indexOf('\n') + 1));
        }
        assertEquals(original, firstRound.toString());
        assertEquals(500, db.queryForObject("SELECT COUNT(*) FROM class_pre_explanations p JOIN symbol_versions s ON s.id=p.symbol_id WHERE s.snapshot_id=?", Integer.class, snapshot));
        int saved = db.queryForObject("SELECT COUNT(*) FROM architecture_checkpoints WHERE snapshot_id=?", Integer.class, snapshot);
        assertEquals(chunks.size() + 250, saved);
        assertEquals(saved, queue.getQueueStatus(ws).synthesisCompleted());
        assertTrue(db.queryForObject("SELECT context_evidence FROM explanation_syntheses WHERE snapshot_id=?", String.class, snapshot).contains("stage-"));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id=?", Integer.class, snapshot));
        for (int i = 0; i < 505; i++) assertTrue(queue.processNextItem());
        assertEquals("COMPLETED", db.queryForObject("SELECT status FROM jobs WHERE id=?", String.class, job));
        assertEquals(505, db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id=? AND status='READY' AND subject_type='symbol'", Integer.class, snapshot));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id=? AND subject_type='relationship'", Integer.class, snapshot));
        clearInvocations(model);
        explanations.synthesizeArchitecture(snapshot);
        verifyNoInteractions(model);
    }

    @Test void largeOutputSettingStillShowsAConcreteBoundedBatchWhileModelIsWorking() throws Exception {
        properties.getModel().setContextBudget(1_000_000);
        properties.getModel().setOutputBudget(65_536);
        for (int i = 0; i < 260; i++) symbol("progress-" + i, "CLASS", "package-b", 4);

        when(model.getExplanation(argThat(system -> system.startsWith("Summarize a slice")),
            anyString(), anyInt())).thenReturn("{\"summary\":\"Shipment processing architecture.\"}");
        CountDownLatch enteredClassBatch = new CountDownLatch(1);
        CountDownLatch releaseClassBatch = new CountDownLatch(1);
        when(model.getExplanation(argThat(system -> system.startsWith("Infer concise")),
            anyString())).thenAnswer(invocation -> {
                enteredClassBatch.countDown();
                assertTrue(releaseClassBatch.await(5, TimeUnit.SECONDS));
                return batchResponse(invocation.getArgument(1));
            });

        String job = queue.startExplainAllJob(ws, snapshot, 1);
        var task = CompletableFuture.supplyAsync(queue::processNextItem);
        assertTrue(enteredClassBatch.await(5, TimeUnit.SECONDS));

        QueueStatus status = queue.getQueueStatus(ws);
        assertEquals("Drafting class purposes 1–16 of 262", status.synthesisStage());
        assertTrue(status.synthesisCompleted() > 0, "The completed context batch remains visible");
        assertNotNull(status.synthesisStageStartedAt());

        queue.cancelJob(job);
        releaseClassBatch.countDown();
        assertTrue(task.get(5, TimeUnit.SECONDS));
        assertEquals(0, db.queryForObject(
            "SELECT COUNT(*) FROM class_pre_explanations p JOIN symbol_versions s ON s.id=p.symbol_id WHERE s.snapshot_id=?",
            Integer.class, snapshot));
        assertEquals(16, json.readTree(db.queryForObject(
            "SELECT output_json FROM architecture_checkpoints WHERE snapshot_id=? AND stage_kind='classes'",
            String.class, snapshot)).get("classes").size());
    }

    @Test void providerContextRejectionSplitsSlicesAndClassBatches() throws Exception {
        properties.getModel().setContextBudget(8192);
        properties.getModel().setOutputBudget(512);
        documents.save(ws, null, "Guide", "Regional delivery rules. ".repeat(600));
        var accepted = new ArrayList<String>();
        java.util.concurrent.atomic.AtomicInteger rejections = new java.util.concurrent.atomic.AtomicInteger();
        when(model.getExplanation(anyString(), anyString(), anyInt())).thenAnswer(inv -> {
            String user = inv.getArgument(1);
            if (user.length() > 3000) { rejections.incrementAndGet(); throw new ModelClientService.ContextLimitException(); }
            accepted.add(user.substring(user.indexOf('\n') + 1));
            return "{\"summary\":\"Regional delivery.\"}";
        });
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            String response = batchResponse(inv.getArgument(1));
            if (json.readTree(response).get("classes").size() > 1) { rejections.incrementAndGet(); throw new ModelClientService.ContextLimitException(); }
            return response;
        });
        explanations.synthesizeArchitecture(snapshot);
        assertTrue(rejections.get() > 2);
        assertEquals(context.buildArchitectureContext(snapshot).formattedContext(), String.join("", accepted));
        assertNotNull(context.priorExplanation(snapshot, id("class-a")));
        assertNotNull(context.priorExplanation(snapshot, id("class-b")));
    }

    @Test void largeIndividualContextFitsWindowAndKeepsParentPurposeWithHonestOmissions() throws Exception {
        for (int i = 0; i < 40; i++) {
            symbol("neighbor-" + i, "METHOD", "class-b", 100);
            relationship("extra-call-" + i, "caller", "neighbor-" + i, "CALLS");
        }
        db.update("UPDATE evidence SET snippet=? WHERE id LIKE ?", "if (shipment.isReady()) dispatch(shipment);\n".repeat(300), snapshot + "%");
        when(model.getExplanation(anyString(), anyString())).thenReturn(synthesis());
        explanations.synthesizeArchitecture(snapshot);
        properties.getModel().setContextBudget(8192); properties.getModel().setOutputBudget(2048);
        var templates = new PromptTemplate();
        var result = context.buildSymbolContext(snapshot, id("caller"));
        assertTrue(new ModelRequestBudget(8192, 2048).fits(templates.getSystemPrompt(), templates.getUserPrompt(result), 2048));
        assertTrue(result.formattedContext().contains("Coordinates shipments."));
        assertTrue(result.formattedContext().contains("Context shortened"));
        assertTrue(result.formattedContext().contains("Do not imply complete source coverage"));
    }

    @Test void outputTruncationSplitsClassBatchesWithoutPublishingPartialCoverage() throws Exception {
        properties.getModel().setOutputBudget(512);
        when(model.getExplanation(anyString(), anyString(), anyInt())).thenReturn("{\"summary\":\"Shipment architecture.\"}");
        List<Integer> sizes = new ArrayList<>();
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            String response = batchResponse(inv.getArgument(1));
            int size = json.readTree(response).get("classes").size(); sizes.add(size);
            assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM class_pre_explanations WHERE symbol_id IN (?, ?)", Integer.class, id("class-a"), id("class-b")));
            if (size > 1) throw new ModelClientService.OutputLimitException();
            return response;
        });
        explanations.synthesizeArchitecture(snapshot);
        assertTrue(sizes.contains(2)); assertEquals(List.of(1, 1), sizes.subList(sizes.size() - 2, sizes.size()));
        assertNotNull(context.priorExplanation(snapshot, id("class-a")));
        assertNotNull(context.priorExplanation(snapshot, id("class-b")));
    }

    @Test void cancellationRetainsValidatedClassBatchAndResumeSkipsItsModelCall() throws Exception {
        properties.getModel().setOutputBudget(256); // One class per response.
        String job = queue.startExplainAllJob(ws, snapshot, 1);
        var calls = new ArrayList<String>();
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            String user = inv.getArgument(1); calls.add(user);
            if (calls.size() == 1) queue.cancelJob(job);
            return batchResponse(user);
        });
        queue.processNextItem();
        assertEquals("CANCELLED", db.queryForObject("SELECT status FROM jobs WHERE id=?", String.class, job));
        assertEquals(1, calls.size());
        assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM architecture_checkpoints WHERE snapshot_id=?", Integer.class, snapshot));
        assertNull(context.priorExplanation(snapshot, id("class-a")));
        queue.startExplainAllJob(ws, snapshot, 1); queue.processNextItem();
        assertEquals(2, calls.size()); // First class came from its durable checkpoint.
        assertEquals("READY", queue.getQueueStatus(ws).synthesisStatus());
        assertNotNull(context.priorExplanation(snapshot, id("class-b")));
    }

    @Test void failedBatchRetryUsesCheckpointButDocumentChangesPreventReuse() throws Exception {
        properties.getModel().setOutputBudget(256);
        var doc = documents.save(ws, null, "Guide", "Shipments");
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            if (calls.incrementAndGet() == 2) throw new RuntimeException("synthetic provider outage");
            return batchResponse(inv.getArgument(1));
        });
        assertThrows(RuntimeException.class, () -> explanations.synthesizeArchitecture(snapshot));
        assertNull(context.priorExplanation(snapshot, id("class-a")));
        explanations.synthesizeArchitecture(snapshot);
        assertEquals(3, calls.get());
        documents.save(ws, doc.id(), doc.title(), "Changed shipment policy");
        explanations.synthesizeArchitecture(snapshot);
        assertEquals(5, calls.get());
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
