package dev.codeatlas.design;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.explanations.ContextBuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * The design layer (ADR 0014) end to end over REST against the analyzed spring-project fixture:
 * authoring at every level, validation and atomicity, computed status against parser facts,
 * renames, deletes, explanation context/staleness, and export → import into another workspace.
 */
@SpringBootTest
@AutoConfigureMockMvc
class DesignLayerIntegrationTest {
    private static final Path DATA_DIR = createDataDirectory();
    private static final String PKG = "com.example.spring.service";

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired AnalysisService analysis;
    @Autowired ContextBuilder contexts;
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();
    private String workspace, snapshot;

    @DynamicPropertySource
    static void isolatedDataDirectory(DynamicPropertyRegistry properties) {
        properties.add("codeatlas.data-dir", () -> DATA_DIR.toString());
        properties.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA_DIR.resolve("codeatlas.db"));
    }

    @BeforeEach void analyzedFixture() {
        Path fixture = Path.of("test-fixtures/spring-project").toAbsolutePath();
        var existing = db.queryForList("SELECT id FROM workspaces WHERE canonical_root = ?", String.class, fixture.toString());
        if (existing.isEmpty()) {
            workspace = UUID.randomUUID().toString();
            db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'spring-project', datetime('now'), datetime('now'))", workspace, fixture.toString());
            String job = UUID.randomUUID().toString();
            db.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", job, workspace);
            analysis.runAnalysis(workspace, job);
        } else workspace = existing.get(0);
        snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspace);
        db.update("DELETE FROM design_relations WHERE workspace_id = ?", workspace);
        db.update("DELETE FROM design_resources WHERE workspace_id = ?", workspace);
    }

    @Test void authoringAtEveryLevelComputesStatusAgainstTheCode() throws Exception {
        JsonNode result = changes(workspace, false, """
            {"author":"claude-code","operations":[
              {"op":"putResource","kind":"PACKAGE","name":"com.example.billing","explanation":"Billing context.\\n\\nOwns invoices."},
              {"op":"putResource","kind":"CLASS","parentKey":"com.example.billing","name":"InvoiceService","explanation":"Issues invoices."},
              {"op":"putResource","kind":"METHOD","parentKey":"com.example.billing.InvoiceService","name":"issue","parameterTypes":["Order"," boolean "],"signature":"Invoice issue(Order order, boolean draft)"},
              {"op":"putResource","kind":"INTERFACE","parentKey":"%1$s","name":"Invoicing"},
              {"op":"putResource","kind":"METHOD","parentKey":"%1$s.OrderService","name":"invoice","parameterTypes":["Long"]},
              {"op":"putResource","key":"%1$s.OrderService","explanation":"Order lifecycle.\\n\\nPlanned change: emit an OrderCompleted event."},
              {"op":"putRelation","sourceKey":"com.example.spring.controller.OrderController","targetKey":"%1$s.OrderService","kind":"CALLS","explanation":"Controller delegates."},
              {"op":"putRelation","sourceKey":"%1$s.OrderService","targetKey":"com.example.billing.InvoiceService","kind":"CALLS","explanation":"Completed orders are invoiced."}
            ]}""".formatted(PKG));
        assertEquals(8, result.get("applied").asInt());

        JsonNode overlay = overlay(workspace);
        Map<String, JsonNode> byKey = byKey(overlay.get("resources"));
        assertEquals("PLANNED", byKey.get("com.example.billing").get("status").asText());
        assertEquals("Billing context.", byKey.get("com.example.billing").get("intent").asText());
        assertEquals("claude-code", byKey.get("com.example.billing").get("createdBy").asText());
        JsonNode method = byKey.get("com.example.billing.InvoiceService.issue(Order,boolean)");
        assertNotNull(method, "method key follows the parser's Owner.name(Types) format");
        assertEquals("PLANNED", method.get("status").asText());
        JsonNode iface = byKey.get(PKG + ".Invoicing");
        assertNotNull(iface.get("parentCodeId").asText(null), "a designed type in a parsed package points at the parsed package card");
        JsonNode orderService = byKey.get(PKG + ".OrderService");
        assertEquals("CODE", orderService.get("origin").asText());
        assertEquals("PRESENT", orderService.get("status").asText());
        assertNotNull(orderService.get("codeId").asText(null));
        assertEquals("PLANNED", byKey.get(PKG + ".OrderService.invoice(Long)").get("status").asText());

        Map<String, JsonNode> relations = new HashMap<>();
        overlay.get("relations").forEach(r -> relations.put(r.get("targetKey").asText(), r));
        // Explaining a relation the code already has carries it along as code (ADR 0016), not designed work.
        assertEquals("PRESENT", relations.get(PKG + ".OrderService").get("status").asText(), "OrderController's methods call OrderService's methods");
        assertEquals("CODE", relations.get(PKG + ".OrderService").get("origin").asText());
        assertEquals("CODE", relations.get(PKG + ".OrderService").get("resolution").asText());
        assertEquals("PLANNED", relations.get("com.example.billing.InvoiceService").get("status").asText());
    }

    @Test void invalidChangeSetsSaveNothingAndDryRunNeverPersists() throws Exception {
        mvc.perform(post("/api/workspaces/" + workspace + "/design/changes").contentType(MediaType.APPLICATION_JSON).content("""
            {"operations":[
              {"op":"putResource","kind":"PACKAGE","name":"com.example.ok"},
              {"op":"putResource","kind":"METHOD","parentKey":"com.example.ok","name":"misplaced"}
            ]}"""))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Operation 1 (putResource)")));
        assertEquals(0, count(workspace));
        for (String bad : List.of(
            "{\"op\":\"putResource\",\"kind\":\"CLASS\",\"parentKey\":\"" + PKG + "\",\"name\":\"9Bad\"}",
            "{\"op\":\"putResource\",\"kind\":\"CLASS\",\"parentKey\":\"no.such.pkg\",\"name\":\"X\"}",
            "{\"op\":\"putResource\",\"kind\":\"FIELD\",\"parentKey\":\"" + PKG + "\",\"name\":\"x\"}",
            "{\"op\":\"putRelation\",\"sourceKey\":\"" + PKG + ".OrderService\",\"targetKey\":\"nowhere.X\",\"kind\":\"CALLS\"}",
            "{\"op\":\"putRelation\",\"sourceKey\":\"" + PKG + ".OrderService\",\"targetKey\":\"" + PKG + ".UserService\",\"kind\":\"LIKES\"}",
            "{\"op\":\"updateResource\",\"key\":\"" + PKG + ".OrderService\",\"name\":\"Renamed\"}",
            "{\"op\":\"teleport\"}"))
            mvc.perform(post("/api/workspaces/" + workspace + "/design/changes").contentType(MediaType.APPLICATION_JSON).content("{\"operations\":[" + bad + "]}"))
                .andExpect(status().isBadRequest());
        JsonNode dry = changes(workspace, true, "{\"operations\":[{\"op\":\"putResource\",\"kind\":\"PACKAGE\",\"name\":\"com.example.dry\"}]}");
        assertTrue(dry.get("dryRun").asBoolean());
        assertEquals("created", dry.get("results").get(0).get("outcome").asText());
        assertEquals(0, count(workspace));
    }

    @Test void renamingCarriesChildrenAndRelationsAndDeletingCascades() throws Exception {
        changes(workspace, false, """
            {"operations":[
              {"op":"putResource","kind":"CLASS","parentKey":"%1$s","name":"Draft"},
              {"op":"putResource","kind":"CONSTRUCTOR","parentKey":"%1$s.Draft","name":"Draft","parameterTypes":["Long"]},
              {"op":"putResource","kind":"METHOD","parentKey":"%1$s.Draft","name":"run"},
              {"op":"putResource","key":"%1$s.UserService.findById(Long)","explanation":"Lookup by id."},
              {"op":"putRelation","sourceKey":"%1$s.Draft.run()","targetKey":"%1$s.OrderService","kind":"CALLS"},
              {"op":"updateResource","key":"%1$s.Draft","name":"Final","kind":"RECORD"}
            ]}""".formatted(PKG));
        Map<String, JsonNode> byKey = byKey(overlay(workspace).get("resources"));
        assertFalse(byKey.containsKey(PKG + ".Draft"));
        assertEquals("RECORD", byKey.get(PKG + ".Final").get("kind").asText());
        assertTrue(byKey.containsKey(PKG + ".Final.run()"), "members follow the rename");
        assertEquals("Final", byKey.get(PKG + ".Final.Final(Long)").get("name").asText(), "a constructor is renamed with its type");
        assertEquals(PKG + ".Final.run()", overlay(workspace).get("relations").get(0).get("sourceKey").asText());

        changes(workspace, false, "{\"operations\":[{\"op\":\"deleteResource\",\"key\":\"" + PKG + ".Final\"}]}");
        byKey = byKey(overlay(workspace).get("resources"));
        assertFalse(byKey.keySet().stream().anyMatch(k -> k.startsWith(PKG + ".Final")));
        assertEquals(0, overlay(workspace).get("relations").size());
        assertTrue(byKey.containsKey(PKG + ".UserService.findById(Long)"), "an unrelated explanation survives");
        changes(workspace, false, "{\"operations\":[{\"op\":\"deleteResource\",\"key\":\"" + PKG + ".UserService.findById(Long)\"}]}");
        assertEquals(0, count(workspace));
    }

    @Test void explanationFeedsTheModelContextAndStalesGeneratedProse() throws Exception {
        String orderService = db.queryForObject("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?", String.class, snapshot, PKG + ".OrderService");
        db.update("DELETE FROM explanations WHERE subject_version_id = ?", orderService);
        db.update("INSERT INTO explanations (id, subject_version_id, subject_type, snapshot_id, status, schema_version, created_at, updated_at) VALUES (?, ?, 'symbol', ?, 'READY', '1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            UUID.randomUUID().toString(), orderService, snapshot);
        changes(workspace, false, "{\"operations\":[{\"op\":\"putResource\",\"key\":\"" + PKG + ".OrderService\",\"explanation\":\"Owns the order lifecycle.\"}]}");
        assertEquals("STALE", db.queryForObject("SELECT status FROM explanations WHERE subject_version_id = ?", String.class, orderService));
        var context = contexts.buildSymbolContext(snapshot, orderService);
        var block = context.evidenceItems().stream().filter(e -> e.id().startsWith("design-")).findFirst().orElseThrow();
        assertTrue(block.content().contains("Owns the order lifecycle."));
        assertTrue(block.label().contains("not parser facts"));
    }

    @Test void exportedBriefImportsIntoAnotherWorkspaceAsTheSameMap() throws Exception {
        changes(workspace, false, """
            {"author":"engineer","operations":[
              {"op":"putResource","kind":"PACKAGE","name":"com.example.billing","explanation":"Billing context."},
              {"op":"putResource","kind":"CLASS","parentKey":"com.example.billing","name":"InvoiceService","explanation":"Issues invoices.\\n\\n```java\\nnever closes the fence\\n```"},
              {"op":"putResource","key":"%1$s.OrderService","explanation":"Order lifecycle."},
              {"op":"putRelation","sourceKey":"%1$s.OrderService","targetKey":"com.example.billing.InvoiceService","kind":"CALLS","explanation":"Invoices completed orders."}
            ]}""".formatted(PKG));
        String brief = mvc.perform(post("/api/workspaces/" + workspace + "/design/export").contentType(MediaType.APPLICATION_JSON)
                .content("{\"scope\":{\"mode\":\"CUSTOM\",\"packageKeys\":[\"" + PKG + "\"],\"classKeys\":[]},\"layout\":{\"version\":1,\"positions\":{\"" + PKG + "\":{\"x\":10,\"y\":20}}}}"))
            .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("text/markdown"))
            .andReturn().getResponse().getContentAsString();
        for (String section : List.of("## How to read this brief", "## Module structure", "## Relations", "## Working with this design through the Code Atlas API", "json codeatlas-design"))
            assertTrue(brief.contains(section), section);
        assertTrue(brief.contains("> Billing context."), "explanations are quoted under their resource");
        assertFalse(brief.contains("com.example.spring.model.User`"), "a package outside the scope is not exported");

        Path empty = Files.createDirectory(directory.resolve("fresh"));
        String other = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'fresh', datetime('now'), datetime('now'))", other, empty.toRealPath().toString());
        JsonNode imported = json.readTree(mvc.perform(post("/api/workspaces/" + other + "/design/import").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("content", "Pasted by the engineer:\n\n" + brief, "author", "importer"))))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertEquals(0, imported.get("warnings").size(), imported.get("warnings").toString());
        assertTrue(imported.get("placeholders").asInt() > 0, "parsed resources absent from the target code become placeholders");
        assertEquals(20, imported.get("layout").get("positions").get(PKG).get("y").asInt());

        Map<String, JsonNode> byKey = byKey(overlay(other).get("resources"));
        assertEquals("MISSING", byKey.get(PKG + ".OrderService").get("status").asText());
        assertEquals("Order lifecycle.", byKey.get(PKG + ".OrderService").get("explanation").asText());
        assertEquals("PLANNED", byKey.get("com.example.billing.InvoiceService").get("status").asText());
        assertTrue(byKey.get("com.example.billing.InvoiceService").get("explanation").asText().contains("never closes the fence"));
        assertEquals("engineer", byKey.get("com.example.billing.InvoiceService").get("createdBy").asText());
        assertTrue(overlay(other).get("relations").size() >= 2, "designed and parsed relations both redraw");

        JsonNode again = json.readTree(mvc.perform(post("/api/workspaces/" + other + "/design/import").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("content", brief)))).andReturn().getResponse().getContentAsString());
        assertEquals(0, again.get("resourcesCreated").asInt() + again.get("resourcesUpdated").asInt() + again.get("relationsCreated").asInt(), "import is idempotent");

        mvc.perform(post("/api/workspaces/" + other + "/design/import").contentType(MediaType.APPLICATION_JSON).content("{\"content\":\"# just prose\"}"))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/api/agent-guide")).andExpect(status().isOk()).andExpect(content().string(org.hamcrest.Matchers.containsString("putResource")));
    }

    /**
     * ADR 0016: the prompt is a plain request with no product vocabulary. It lists planned additions,
     * intentions on existing code (resources and relations) as changes, and designed relations not yet in
     * the code; it leaves out implemented and orphaned items.
     */
    @Test void promptIsAPlainRequestForOutstandingWork() throws Exception {
        String empty = mvc.perform(get("/api/workspaces/" + workspace + "/design/prompt")).andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse().getContentAsString();
        assertTrue(empty.contains("Nothing to change"), empty);
        changes(workspace, false, """
            {"author":"user","operations":[
              {"op":"putResource","kind":"PACKAGE","name":"com.example.billing","explanation":"Billing context."},
              {"op":"putResource","kind":"CLASS","parentKey":"com.example.billing","name":"InvoiceService","explanation":"Issues invoices.\\n\\nIdempotent per order."},
              {"op":"putResource","kind":"METHOD","parentKey":"%1$s.OrderService","name":"invoice","parameterTypes":["Long"],"explanation":"Invoices a completed order."},
              {"op":"putResource","key":"%1$s.OrderService","explanation":"Must emit an OrderCompleted event when an order completes."},
              {"op":"putRelation","sourceKey":"%1$s.OrderService","targetKey":"com.example.billing.InvoiceService","kind":"CALLS","explanation":"Completed orders are invoiced."},
              {"op":"putRelation","sourceKey":"%1$s.OrderService","targetKey":"com.example.billing","kind":"DEPENDS_ON"},
              {"op":"putRelation","sourceKey":"com.example.spring.controller.OrderController","targetKey":"%1$s.OrderService","kind":"CALLS","explanation":"Controller must validate before delegating."}
            ]}""".formatted(PKG));
        // A designed class the code now declares, and a type whose parent no longer exists.
        db.update("INSERT INTO design_resources (id, workspace_id, resource_key, kind, simple_name, parent_key, origin, explanation, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
            UUID.randomUUID().toString(), workspace, PKG + ".NotificationService", "CLASS", "NotificationService", PKG, "AUTHORED", "Sends notifications.", "user", "user");
        db.update("INSERT INTO design_resources (id, workspace_id, resource_key, kind, simple_name, parent_key, origin, explanation, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
            UUID.randomUUID().toString(), workspace, "com.gone.Ghost", "CLASS", "Ghost", "com.gone", "AUTHORED", "", "user", "user");
        // Explaining a relation the code already has carries it along as code, never as designed work.
        JsonNode overlay = json.readTree(mvc.perform(get("/api/workspaces/" + workspace + "/design")).andReturn().getResponse().getContentAsString());
        for (JsonNode r : overlay.get("relations"))
            assertEquals(r.get("sourceKey").asText().endsWith("OrderController") ? "CODE" : "AUTHORED", r.get("origin").asText(), r.toString());

        String prompt = mvc.perform(get("/api/workspaces/" + workspace + "/design/prompt")).andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith("text/markdown")).andReturn().getResponse().getContentAsString();
        int add = prompt.indexOf("## Add"), change = prompt.indexOf("## Change"), connect = prompt.indexOf("## Connect");
        assertTrue(add > 0 && change > add && connect > change, prompt);
        assertTrue(prompt.contains("1. Add a package `com.example.billing`. Purpose: Billing context."), prompt);
        assertTrue(prompt.contains("Add a class `InvoiceService` in package `com.example.billing`. Purpose: Issues invoices.\n   Idempotent per order."), prompt);
        assertTrue(prompt.contains("Add a method `invoice(Long)` to class `OrderService` (package `" + PKG + "`). Purpose: Invoices a completed order."), prompt);
        assertTrue(prompt.contains("Change class `OrderService`, in package `" + PKG + "`. What should change: Must emit an OrderCompleted event"), prompt);
        assertTrue(prompt.contains("Change how class `OrderController` calls class `OrderService`. What should change: Controller must validate"), prompt);
        assertTrue(prompt.contains("Class `OrderService` should call class `InvoiceService` (new). Reason: Completed orders are invoiced."), prompt);
        assertTrue(prompt.contains("Class `OrderService` should depend on package `com.example.billing` (new)."), prompt);
        // Nothing about the tool, and nothing already done or orphaned.
        for (String word : List.of("Code Atlas", "127.0.0.1", "/api/", "key", "IMPLEMENTED", "PLANNED", "design layer", "NotificationService", "Ghost", "UserServiceImpl", "```json"))
            assertFalse(prompt.contains(word), "the prompt must not mention " + word + "\n" + prompt);
    }

    /**
     * ADR 0016: a design-only project has no source folder, is never analyzed, and an exported map imported
     * into it comes back whole: parsed code becomes CODE references (relations too), not designed work.
     */
    @Test void designOnlyProjectHoldsAnImportedMap() throws Exception {
        changes(workspace, false, """
            {"author":"user","operations":[
              {"op":"putResource","kind":"CLASS","parentKey":"%1$s","name":"AuditLog","explanation":"Audit trail."},
              {"op":"putRelation","sourceKey":"%1$s.OrderService","targetKey":"%1$s.AuditLog","kind":"CALLS","explanation":"Record completions."}
            ]}""".formatted(PKG));
        String brief = mvc.perform(get("/api/workspaces/" + workspace + "/design/export")).andReturn().getResponse().getContentAsString();

        JsonNode project = json.readTree(mvc.perform(post("/api/workspaces/design-only").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Shared map\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String ws = project.get("id").asText();
        assertTrue(project.get("designOnly").asBoolean());
        assertEquals("Shared map", project.get("name").asText());
        String snap = project.get("activeSnapshotId").asText();
        assertFalse(snap.isBlank());
        mvc.perform(get("/api/snapshots/" + snap + "/graph")).andExpect(status().isOk());
        mvc.perform(post("/api/workspaces/" + ws + "/analysis-jobs").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isBadRequest());

        JsonNode imported = json.readTree(mvc.perform(post("/api/workspaces/" + ws + "/design/import").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("content", brief)))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertTrue(imported.get("relationsCreated").asInt() > 1, imported.toString());
        JsonNode overlay = json.readTree(mvc.perform(get("/api/workspaces/" + ws + "/design")).andReturn().getResponse().getContentAsString());
        boolean designed = false, carried = false;
        for (JsonNode r : overlay.get("relations")) {
            if (r.get("targetKey").asText().endsWith("AuditLog")) { designed = true; assertEquals("AUTHORED", r.get("origin").asText()); assertEquals("PLANNED", r.get("status").asText()); }
            else { carried = true; assertEquals("CODE", r.get("origin").asText(), r.toString()); assertEquals("MISSING", r.get("status").asText()); assertEquals("CODE", r.get("resolution").asText()); }
        }
        assertTrue(designed && carried, overlay.toString());
        // Imported references keep the original card's Spring roles, so they are drawn the same.
        JsonNode service = null;
        for (JsonNode r : overlay.get("resources")) if (r.get("key").asText().equals(PKG + ".OrderService")) service = r;
        assertNotNull(service);
        assertEquals("CODE", service.get("origin").asText());
        assertEquals("MISSING", service.get("status").asText());
        assertTrue(service.get("roles").toString().contains("SERVICE"), service.toString());
        // Imported code dependencies are never prompt work; the designed relation and class are.
        String prompt = mvc.perform(get("/api/workspaces/" + ws + "/design/prompt")).andReturn().getResponse().getContentAsString();
        assertTrue(prompt.contains("Add a class `AuditLog` in package `" + PKG + "`") && prompt.contains("should call class `AuditLog` (new)"), prompt);
        assertEquals(1, prompt.split("should ", -1).length - 1, prompt);
        // Exporting the design-only project again keeps parsed dependencies as code, not design.
        var exportAgain = mvc.perform(get("/api/workspaces/" + ws + "/design/export")).andReturn();
        assertEquals(200, exportAgain.getResponse().getStatus(), String.valueOf(exportAgain.getResolvedException()));
        String again = exportAgain.getResponse().getContentAsString();
        assertTrue(again.contains("\"layer\" : \"CODE\""), "carried relations re-export as code");
        var listed = json.readTree(mvc.perform(get("/api/workspaces")).andReturn().getResponse().getContentAsString());
        boolean found = false;
        for (JsonNode w : listed) if (w.get("id").asText().equals(ws)) found = w.get("designOnly").asBoolean();
        assertTrue(found);
    }

    private JsonNode changes(String ws, boolean dryRun, String body) throws Exception {
        return json.readTree(mvc.perform(post("/api/workspaces/" + ws + "/design/changes?dryRun=" + dryRun).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private JsonNode overlay(String ws) throws Exception {
        return json.readTree(mvc.perform(get("/api/workspaces/" + ws + "/design")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private static Map<String, JsonNode> byKey(JsonNode array) {
        Map<String, JsonNode> out = new HashMap<>();
        array.forEach(r -> out.put(r.get("key").asText(), r));
        return out;
    }

    private int count(String ws) {
        return db.queryForObject("SELECT COUNT(*) FROM design_resources WHERE workspace_id = ?", Integer.class, ws);
    }

    private static Path createDataDirectory() {
        try { return Files.createTempDirectory("codeatlas-design-test"); } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
