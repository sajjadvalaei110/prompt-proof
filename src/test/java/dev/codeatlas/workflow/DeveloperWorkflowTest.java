package dev.codeatlas.workflow;

import dev.codeatlas.analysis.JavaParserAdapter;
import dev.codeatlas.explanations.*;
import dev.codeatlas.graph.SourceService;
import dev.codeatlas.modelclient.ModelClientService;
import dev.codeatlas.workspace.ProjectDocumentService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
class DeveloperWorkflowTest {
    static final Path data;
    static { try { data = Files.createTempDirectory("atlas-workflow-db-"); } catch(Exception e) {throw new RuntimeException(e);} }
    @DynamicPropertySource static void database(DynamicPropertyRegistry r) {r.add("codeatlas.data-dir",()->data.toString());r.add("spring.datasource.url",()->"jdbc:sqlite:"+data.resolve("test.db"));}
    @Autowired JdbcTemplate db;
    @Autowired JavaParserAdapter parser;
    @Autowired SourceService source;
    @Autowired ContextBuilder context;
    @Autowired ProjectDocumentService documents;
    @Autowired ExplanationQueueService queue;
    @Autowired ExplanationService explanations;
    @MockitoBean ModelClientService model;
    @TempDir Path root;
    String ws,snap,worker,run;
    @BeforeEach void setup() throws Exception {
        queue.stopWorker();
        ws=UUID.randomUUID().toString();snap=UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'workflow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",ws,root.toString());
        db.update("INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES (?, ?, 'published', CURRENT_TIMESTAMP)",snap,ws);
        Path java=root.resolve("src/main/java/demo");Files.createDirectories(java);
        Files.writeString(java.resolve("Worker.java"),"""
            package demo;
            public class Worker {
                public String work(String value) { return value.trim(); }
                public int work(int value) { return value + 1; }
                private void audit() { work(7); }
                public void run() { work("first"); work("second"); audit(); }
            }
            """);
        Files.writeString(java.resolve("Caller.java"),"""
            package demo;
            public class Caller {
                public void execute() { new Worker().run(); }
            }
            """);
        parser.setupSymbolSolver(root.toString());
        var files=List.of(java.resolve("Worker.java"),java.resolve("Caller.java"));
        Map<Path,String> before=new HashMap<>();for(var file:files){before.put(file,Files.readString(file));parser.parseDeclarations(file.toFile(),ws,snap);}
        for(var file:files){parser.parseRelationships(file.toFile(),ws,snap);assertEquals(before.get(file),Files.readString(file));}
        worker=id("demo.Worker");run=id("demo.Worker.run()");
    }
    String id(String name){return db.queryForObject("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?",String.class,snap,name);}
    @Test void overloadsPrivateMethodsAndRepeatedCallsKeepExactEvidence() {
        assertNotEquals(id("demo.Worker.work(String)"),id("demo.Worker.work(int)"));
        assertNotNull(id("demo.Worker.audit()"));
        var calls=db.queryForList("SELECT target_symbol_id FROM relationship_occurrences WHERE source_symbol_id = ? AND kind = 'CALLS' ORDER BY id",String.class,run);
        assertEquals(3,calls.size());assertEquals(2,Collections.frequency(calls,id("demo.Worker.work(String)")));assertTrue(calls.contains(id("demo.Worker.audit()")));
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM relationship_occurrences WHERE source_symbol_id = ? AND target_symbol_id = ? AND kind = 'CALLS'",Integer.class,id("demo.Worker.audit()"),id("demo.Worker.work(int)")));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM relationship_occurrences r WHERE snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM relationship_evidence e WHERE e.relationship_id = r.id)",Integer.class,snap));
        var code=source.symbol(snap,id("demo.Worker.work(int)"));assertTrue(code.exact());assertEquals("src/main/java/demo/Worker.java",code.path());
        assertTrue(code.content().contains("package demo;"));assertTrue(code.content().contains("public String work(String value)"));
        assertEquals(4,code.startLine());
        var lines=code.content().split("\n",-1);var declared=new StringBuilder();for(int line=code.startLine();line<=code.endLine();line++)declared.append(line>code.startLine()?"\n":"").append(lines[line-1]);
        assertEquals("public int work(int value) { return value + 1; }",declared.toString().strip());
    }
    @Test void documentsAreScopedAndExplanationContextContainsArchitectureAndNeighbors() {
        var doc=documents.save(ws,null,"Domain guide","Workers validate shipment requests for the fulfillment workflow.");
        var ctx=context.buildSymbolContext(snap,run);
        assertTrue(ctx.formattedContext().contains("fulfillment workflow"));
        assertTrue(ctx.formattedContext().contains("demo.Caller"));
        assertTrue(ctx.formattedContext().contains("demo.Worker"));
        assertTrue(ctx.formattedContext().contains("CONTEXT LIMITS"));
        assertTrue(ctx.evidenceItems().stream().anyMatch(e->e.id().startsWith("doc-"+doc.id())));
        assertThrows(NoSuchElementException.class,()->documents.list("unknown-workspace"));
        assertThrows(IllegalArgumentException.class,()->documents.save(ws,null,"x","x".repeat(100001)));
    }
    @Test void relationshipPromptContainsActualSourceAndTarget() {
        String edge=db.queryForObject("SELECT id FROM relationship_occurrences WHERE source_symbol_id = ? AND target_symbol_id = ? AND kind = 'CALLS' LIMIT 1",String.class,snap==null?"":run,id("demo.Worker.audit()"));
        var ctx=context.buildContext(snap,edge,"relationship");
        assertTrue(ctx.formattedContext().contains("demo.Worker.run() --CALLS--> demo.Worker.audit()"));
        assertTrue(ctx.evidenceItems().stream().anyMatch(e->e.id().startsWith("ev-site-")));
    }
    @Test void bulkIncludesOnlyClassesAndMethodsAndCanResume() {
        String job=queue.startExplainAllJob(ws,snap,1);
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE subject_id = ? AND job_id = ?",Integer.class,id("demo.Worker.audit()"),job));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE snapshot_id = ? AND subject_type = 'relationship'",Integer.class,snap));
        queue.cancelJob(job);String resumed=queue.startExplainAllJob(ws,snap,1);assertNotEquals(job,resumed);
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE snapshot_id = ? AND status = 'SKIPPED'",Integer.class,snap));
        assertThrows(IllegalArgumentException.class,()->queue.startExplainAllJob("other",snap,1));
    }
    @Test void invalidModelOutputIsNeverPromotedToSourceFacts() {
        when(model.getExplanation(anyString(),anyString())).thenReturn("This is not JSON");
        assertThrows(IllegalArgumentException.class,()->explanations.explainSubject(snap,run,"symbol"));
        when(model.getExplanation(anyString(),anyString())).thenReturn("{\"shortLabel\":\"Run\",\"hoverSummary\":\"Runs work\",\"claims\":[{\"description\":\"Invented\",\"basis\":\"SOURCE_FACT\",\"evidenceIds\":[\"invented-id\"]}]}");
        assertThrows(IllegalArgumentException.class,()->explanations.explainSubject(snap,run,"symbol"));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id = ?",Integer.class,snap));
    }
    static final String VALID="{\"shortLabel\":\"Coordinate work\",\"hoverSummary\":\"Runs work and audit\",\"claims\":[{\"description\":\"Calls audit\",\"basis\":\"SOURCE_FACT\",\"evidenceIds\":[\"ev-source\"]}]}";
    @Test void documentChangesInvalidateSavedExplanationsAndRetainEvidence() {
        var doc=documents.save(ws,null,"Workflow","Original context");
        when(model.getExplanation(anyString(),anyString())).thenReturn(VALID);
        explanations.explainSubject(snap,run,"symbol");
        assertEquals("READY",explanations.getExplanationForSymbol(snap,run).status().name());
        assertNotNull(db.queryForObject("SELECT input_fingerprint FROM explanations WHERE subject_version_id = ?",String.class,run));
        assertTrue(explanations.getEvidence(snap,run,"symbol").toString().contains("Original context"));
        documents.save(ws,doc.id(),doc.title(),"New context");
        assertEquals("STALE",explanations.getExplanationForSymbol(snap,run).status().name());
        assertTrue(explanations.getEvidence(snap,run,"symbol").toString().contains("Original context"));
    }
    @Test void oneRepairCanRecoverMalformedOutputWithoutInventingEvidence() {
        when(model.getExplanation(anyString(),anyString())).thenReturn("invalid JSON", VALID);
        explanations.explainSubject(snap,run,"symbol");
        assertEquals("READY",explanations.getExplanationForSymbol(snap,run).status().name());
        verify(model,times(2)).getExplanation(anyString(),anyString());
    }
    @Test void savedSuccessIsPreservedWhileRefreshIsQueued() {
        when(model.getExplanation(anyString(),anyString())).thenReturn(VALID);
        explanations.explainSubject(snap,run,"symbol");
        queue.enqueueExplanation(ws,snap,run,"symbol");
        var response=explanations.getExplanationForSymbol(snap,run);
        assertEquals("QUEUED",response.status().name());
        assertEquals("Coordinate work",response.shortLabel());
    }

    @Test void documentChangedDuringGenerationLeavesResponseStale() {
        var doc=documents.save(ws,null,"Workflow","Original context");
        when(model.getExplanation(anyString(),anyString())).thenAnswer(inv->{documents.save(ws,doc.id(),doc.title(),"Changed during request");return VALID;});
        explanations.explainSubject(snap,run,"symbol");
        assertEquals("STALE",explanations.getExplanationForSymbol(snap,run).status().name());
    }
}
