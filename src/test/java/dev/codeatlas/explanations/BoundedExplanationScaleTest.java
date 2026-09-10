package dev.codeatlas.explanations;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.modelclient.ModelClientService;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** The synthetic repository is created directly as parser-owned facts; no target code is executed. */
@SpringBootTest
class BoundedExplanationScaleTest {
    private static final int CLASSES = 10_000;
    private static final int METHODS = 50_000;
    private static final int RELATIONSHIPS = 100_000;
    private static final String WORKSPACE = "scale-workspace";
    private static final String SNAPSHOT = "scale-snapshot";
    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-bounded-scale-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("scale.db"));
    }

    @Autowired JdbcTemplate db;
    @Autowired ExplanationQueueService queue;
    @Autowired ExplanationService explanations;
    @Autowired ContextBuilder contexts;
    @Autowired CodeAtlasProperties properties;
    @Autowired BoundedWorkMetrics metrics;
    @MockitoBean ModelClientService model;
    private final ObjectMapper json = new ObjectMapper();

    @BeforeAll
    static void heapContract() {
        assertTrue(Runtime.getRuntime().maxMemory() <= 300L * 1024 * 1024,
            "Run with the constrainedMemoryTest task (-Xmx256m)");
    }

    @Test
    void tenThousandClassesArePreparedAndSixtyThousandQueueRowsAreClaimedBoundedly() throws Exception {
        AtomicBoolean sampling = new AtomicBoolean(true);
        AtomicLong peakUsedHeap = new AtomicLong();
        Thread sampler = Thread.ofPlatform().daemon().name("bounded-heap-sampler").start(() -> {
            while (sampling.get()) {
                Runtime runtime = Runtime.getRuntime();
                peakUsedHeap.accumulateAndGet(runtime.totalMemory() - runtime.freeMemory(), Math::max);
                try { Thread.sleep(20); } catch (InterruptedException ignored) { return; }
            }
        });
        queue.stopWorker();
        configureLimits();
        createFixture();
        stubBoundedProvider();
        metrics.reset();

        String job = queue.startExplainAllJob(WORKSPACE, SNAPSHOT, 8);
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE job_id=?", Integer.class, job));
        assertTrue(queue.processNextItem(), "the first bounded action completes architecture preparation");

        assertEquals(CLASSES, db.queryForObject("SELECT COUNT(*) FROM class_pre_explanations", Integer.class));
        assertEquals(CLASSES + METHODS, db.queryForObject("SELECT total_items FROM jobs WHERE id=?", Integer.class, job));
        assertEquals(CLASSES + METHODS, db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE job_id=? AND subject_type='symbol'", Integer.class, job));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM explanation_queue WHERE subject_type='relationship'", Integer.class));
        assertTrue(db.queryForObject("SELECT COUNT(*) FROM architecture_checkpoints WHERE reduction_level>0", Integer.class) > 1);

        List<Map<String, Object>> first = db.queryForList("SELECT relation_count,loc,subject_id FROM explanation_queue WHERE job_id=? ORDER BY relation_count,loc,subject_id LIMIT 500", job);
        for (int i = 1; i < first.size(); i++) assertTrue(compare(first.get(i - 1), first.get(i)) <= 0);

        var context = contexts.buildSymbolContext(SNAPSHOT, methodId(0));
        assertTrue(context.formattedContext().contains("BOUNDED EVIDENCE RECORD"));
        assertTrue(context.omissions().stream().anyMatch(o -> o.truncated() || o.omitted() > 0));

        var observed = metrics.snapshot();
        assertTrue(observed.maximumRowsLoadedPerQuery() <= 129, observed.toString());
        assertTrue(observed.maximumSymbolsRetainedPerBatch() <= 24, observed.toString());
        assertEquals(1, observed.maximumSimultaneousRequests(), observed.toString());
        assertTrue(observed.maximumPromptBytes() <= properties.getModel().getMaxRequestBytes(), observed.toString());
        assertTrue(observed.maximumResponseBytes() <= properties.getModel().getMaxResponseBytes(), observed.toString());

        clearInvocations(model);
        explanations.synthesizeArchitecture(SNAPSHOT);
        verifyNoInteractions(model);

        String firstId = db.queryForObject("SELECT id FROM explanation_queue WHERE job_id=? ORDER BY relation_count,loc,subject_id,id LIMIT 1", String.class, job);
        db.update("UPDATE explanation_queue SET status='IN_PROGRESS' WHERE id=?", firstId);
        queue.recoverAbandonedWork();
        assertEquals("PENDING", db.queryForObject("SELECT status FROM explanation_queue WHERE id=?", String.class, firstId));
        sampling.set(false);
        sampler.join(1_000);
        System.out.println("BOUNDED_SCALE_METRICS " + observed + " sampledPeakUsedHeapBytes=" + peakUsedHeap.get()
            + " maxHeapBytes=" + Runtime.getRuntime().maxMemory());
    }

    private void configureLimits() {
        properties.getModel().setBaseUrl("http://127.0.0.1:1/v1");
        properties.getModel().setModelId("bounded-mock");
        properties.getModel().setContextBudget(16_384);
        properties.getModel().setOutputBudget(3_072);
        properties.getModel().setMaxRequestBytes(262_144);
        properties.getModel().setMaxResponseBytes(65_536);
        properties.getExplanations().setArchitecturePageRows(128);
        properties.getExplanations().setArchitectureDocumentChars(4_096);
        properties.getExplanations().setArchitectureSummaryFanIn(8);
        properties.getExplanations().setArchitectureClassBatch(16);
        properties.getExplanations().setClassNeighborRows(64);
        properties.getExplanations().setRelatedSymbols(24);
        properties.getExplanations().setQueueClaimRows(4);
    }

    private void createFixture() {
        db.update("INSERT INTO workspaces(id,canonical_root,display_name,created_at,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", WORKSPACE, DATA.resolve("read-only-source").toString(), "Scale fixture");
        db.update("INSERT INTO snapshots(id,workspace_id,status,symbol_count,relationship_count,created_at) VALUES(?,?, 'published',?,?,CURRENT_TIMESTAMP)", SNAPSHOT, WORKSPACE, CLASSES + METHODS + 100, RELATIONSHIPS);
        db.update("INSERT INTO source_file_versions(id,snapshot_id,relative_path,content_hash,source_content) VALUES('scale-file',?,'src/main/java/Scale.java','scale-hash','class Scale {}')", SNAPSHOT);

        batch(100 + CLASSES + METHODS, 1_000,
            "INSERT INTO logical_symbols(workspace_id,key) VALUES(?,?)",
            (ps, i) -> { ps.setString(1, WORKSPACE); ps.setString(2, logicalKey(i)); });
        batch(100, 100,
            "INSERT INTO symbol_versions(id,snapshot_id,logical_symbol_key,workspace_id,kind,qualified_name,simple_name,content_hash) VALUES(?,?,?,?,?,?,?,'scale-hash')",
            (ps, i) -> symbol(ps, packageId(i), packageId(i), "PACKAGE", "fixture.p" + padded(i), "p" + i, null));
        batch(CLASSES, 1_000,
            "INSERT INTO symbol_versions(id,snapshot_id,logical_symbol_key,workspace_id,kind,qualified_name,simple_name,parent_symbol_id,roles,content_hash) VALUES(?,?,?,?,?,?,?,?,?, 'scale-hash')",
            (ps, i) -> {
                ps.setString(1, classId(i)); ps.setString(2, SNAPSHOT); ps.setString(3, classId(i)); ps.setString(4, WORKSPACE);
                ps.setString(5, "CLASS"); ps.setString(6, "fixture.p" + padded(i % 100) + ".C" + padded(i)); ps.setString(7, "C" + i);
                ps.setString(8, packageId(i % 100)); ps.setString(9, i % 10 == 0 ? "[\"SERVICE\"]" : "[]");
            });
        batch(METHODS, 1_000,
            "INSERT INTO symbol_versions(id,snapshot_id,logical_symbol_key,workspace_id,kind,qualified_name,simple_name,parent_symbol_id,content_hash) VALUES(?,?,?,?,?,?,?,?, 'scale-hash')",
            (ps, i) -> {
                int owner = i % CLASSES;
                ps.setString(1, methodId(i)); ps.setString(2, SNAPSHOT); ps.setString(3, methodId(i)); ps.setString(4, WORKSPACE);
                ps.setString(5, "METHOD"); ps.setString(6, "fixture.C" + padded(owner) + ".m" + padded(i) + "()"); ps.setString(7, "m" + i); ps.setString(8, classId(owner));
            });

        batch(CLASSES + METHODS, 1_000,
            "INSERT INTO evidence(id,source_file_version_id,start_line,start_column,end_line,end_column,snippet) VALUES(?,'scale-file',1,1,?,?,?)",
            (ps, i) -> { ps.setString(1, "symbol-evidence-" + padded(i)); ps.setInt(2, 2 + i % 200); ps.setInt(3, 10); ps.setString(4, "void boundedDeclaration" + i + "() {}"); });
        batch(CLASSES + METHODS, 1_000,
            "INSERT INTO symbol_evidence(symbol_version_id,evidence_id) VALUES(?,?)",
            (ps, i) -> { ps.setString(1, i < CLASSES ? classId(i) : methodId(i - CLASSES)); ps.setString(2, "symbol-evidence-" + padded(i)); });

        batch(RELATIONSHIPS, 1_000,
            "INSERT INTO relationship_occurrences(id,snapshot_id,source_symbol_id,target_symbol_id,kind,resolution) VALUES(?,?,?,?, 'CALLS','RESOLVED')",
            (ps, i) -> { ps.setString(1, relationshipId(i)); ps.setString(2, SNAPSHOT); ps.setString(3, methodId(i % METHODS)); ps.setString(4, methodId((i * 31 + 7) % METHODS)); });
        batch(RELATIONSHIPS, 1_000,
            "INSERT INTO evidence(id,source_file_version_id,start_line,start_column,end_line,end_column,snippet) VALUES(?,'scale-file',1,1,1,20,'target.call()')",
            (ps, i) -> ps.setString(1, "relationship-evidence-" + padded(i)));
        batch(RELATIONSHIPS, 1_000,
            "INSERT INTO relationship_evidence(relationship_id,evidence_id) VALUES(?,?)",
            (ps, i) -> { ps.setString(1, relationshipId(i)); ps.setString(2, "relationship-evidence-" + padded(i)); });

        for (int i = 0; i < 4; i++) db.update("INSERT INTO project_documents(id,workspace_id,title,content) VALUES(?,?,?,?)",
            "scale-doc-" + i, WORKSPACE, "Large project guide " + i, ("Rule " + i + ": validate bounded workflow state before publication.\n").repeat(1_500));
    }

    private void stubBoundedProvider() throws Exception {
        when(model.getExplanation(anyString(), anyString(), anyInt())).thenAnswer(inv -> tracked(inv.getArgument(0), inv.getArgument(1), "{\"summary\":\"Bounded fixture workflows, persistence rules, and package responsibilities; source verification remains required.\"}"));
        when(model.getExplanation(anyString(), anyString())).thenAnswer(inv -> {
            String system = inv.getArgument(0), user = inv.getArgument(1);
            if (system.startsWith("Infer concise")) {
                var matcher = Pattern.compile("symbolId=([^,}]+),[^\n]*kind=CLASS").matcher(user);
                List<Map<String, String>> values = new ArrayList<>();
                while (matcher.find()) values.add(Map.of("symbolId", matcher.group(1), "businessLogic", "Coordinates one bounded fixture responsibility."));
                return tracked(system, user, json.writeValueAsString(Map.of("classes", values)));
            }
            return tracked(system, user, "{\"shortLabel\":\"Bounded method\",\"hoverSummary\":\"Explains one bounded method.\",\"claims\":[{\"description\":\"The declaration is indexed.\",\"basis\":\"SOURCE_FACT\",\"evidenceIds\":[\"ev-source\"]}],\"unknowns\":[]}");
        });
    }

    private String tracked(String system, String user, String response) throws Exception {
        metrics.prompt(system, user);
        try (AutoCloseable ignored = metrics.requestStarted()) {
            metrics.responseBytes(response.getBytes(StandardCharsets.UTF_8).length);
            return response;
        }
    }

    private int compare(Map<String, Object> a, Map<String, Object> b) {
        int value = Integer.compare(((Number) a.get("relation_count")).intValue(), ((Number) b.get("relation_count")).intValue());
        if (value == 0) value = Integer.compare(((Number) a.get("loc")).intValue(), ((Number) b.get("loc")).intValue());
        if (value == 0) value = String.valueOf(a.get("subject_id")).compareTo(String.valueOf(b.get("subject_id")));
        return value;
    }

    private void batch(int count, int size, String sql, Setter setter) {
        for (int start = 0; start < count; start += size) {
            int from = start, length = Math.min(size, count - start);
            db.batchUpdate(sql, new BatchPreparedStatementSetter() {
                public void setValues(PreparedStatement ps, int i) throws SQLException { setter.set(ps, from + i); }
                public int getBatchSize() { return length; }
            });
        }
    }

    private void symbol(PreparedStatement ps, String id, String logical, String kind, String qualified, String simple, String parent) throws SQLException {
        ps.setString(1, id); ps.setString(2, SNAPSHOT); ps.setString(3, logical); ps.setString(4, WORKSPACE);
        ps.setString(5, kind); ps.setString(6, qualified); ps.setString(7, simple);
    }
    private String logicalKey(int i) { return i < 100 ? packageId(i) : i < 100 + CLASSES ? classId(i - 100) : methodId(i - 100 - CLASSES); }
    private String packageId(int i) { return "package-" + padded(i); }
    private String classId(int i) { return "class-" + padded(i); }
    private String methodId(int i) { return "method-" + padded(i); }
    private String relationshipId(int i) { return "relationship-" + padded(i); }
    private String padded(int i) { return String.format("%06d", i); }
    @FunctionalInterface private interface Setter { void set(PreparedStatement statement, int index) throws SQLException; }
}
