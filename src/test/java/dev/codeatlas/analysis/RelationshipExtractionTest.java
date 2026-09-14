package dev.codeatlas.analysis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Relationship coverage against test-fixtures/microservice-java, whose {@code dtos} package is only ever
 * reached through constructors ({@code new EmailRequestDTO(..)}), constructor bodies
 * ({@code Event(EventRequestDTO)}), parameter types and record accessors -- none of which were extracted when
 * only method-body calls were indexed, leaving the package disconnected on the map.
 */
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RelationshipExtractionTest {

    private static final String BASE = "com.kipper.eventsmicroservice.";
    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-relationships-db-"); } catch (Exception e) { throw new RuntimeException(e); } }

    /** A private database per test class: never the developer's ./data/codeatlas.db. */
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
    }

    @Autowired private AnalysisService analysisService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private String snapshotId;
    private Map<String, Map<String, Object>> symbols;
    private List<Map<String, Object>> relationships;

    /** Every test only reads the published snapshot, so the fixture is analyzed once for the class. */
    @BeforeAll
    void analyzeFixture() {
        Path fixturePath = Path.of("test-fixtures/microservice-java").toAbsolutePath();
        assertTrue(fixturePath.toFile().exists(), "Fixture must exist at " + fixturePath);
        List<String> existing = jdbcTemplate.queryForList("SELECT id FROM workspaces WHERE canonical_root = ?", String.class, fixturePath.toString());
        String workspaceId = existing.isEmpty() ? UUID.randomUUID().toString() : existing.get(0);
        if (existing.isEmpty()) {
            jdbcTemplate.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'relationship-extraction', datetime('now'), datetime('now'))",
                    workspaceId, fixturePath.toString());
        }
        String jobId = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);

        analysisService.runAnalysis(workspaceId, jobId);

        snapshotId = jdbcTemplate.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertNotNull(snapshotId, "Analysis must publish a snapshot");
        symbols = jdbcTemplate.queryForList("SELECT id, kind, qualified_name, parent_symbol_id FROM symbol_versions WHERE snapshot_id = ?", snapshotId)
                .stream().collect(Collectors.toMap(row -> (String) row.get("id"), row -> row));
        relationships = jdbcTemplate.queryForList("SELECT id, source_symbol_id, target_symbol_id, kind, resolution FROM relationship_occurrences WHERE snapshot_id = ?", snapshotId);
    }

    @Test
    void indexesExplicitConstructors() {
        Set<String> constructors = symbols.values().stream().filter(s -> "CONSTRUCTOR".equals(s.get("kind"))).map(s -> (String) s.get("qualified_name")).collect(Collectors.toSet());
        assertTrue(constructors.containsAll(Set.of(
                BASE + "domain.Event.Event(EventRequestDTO)",
                BASE + "domain.Subscription.Subscription(Event,String)",
                BASE + "exceptions.EventFullException.EventFullException()",
                BASE + "exceptions.EventFullException.EventFullException(String)")), constructors.toString());
        for (Map<String, Object> constructor : symbols.values().stream().filter(s -> "CONSTRUCTOR".equals(s.get("kind"))).toList()) {
            assertEquals("CLASS", symbols.get((String) constructor.get("parent_symbol_id")).get("kind"), "constructor parent is its class");
        }
    }

    @Test
    void constructorCallsTargetTheDeclaredConstructorOrTheType() {
        assertHas("CONSTRUCTS", "services.EventService.createEvent(EventRequestDTO)", "domain.Event.Event(EventRequestDTO)");
        assertHas("CONSTRUCTS", "services.EventService.registerParticipant(String,String)", "domain.Subscription.Subscription(Event,String)");
        assertHas("CONSTRUCTS", "services.EventService.registerParticipant(String,String)", "exceptions.EventFullException.EventFullException()");
        // Records without an explicit constructor: the type is the target.
        assertHas("CONSTRUCTS", "services.EventService.registerParticipant(String,String)", "dtos.EmailRequestDTO");
        // Constructor reference EventNotFoundException::new.
        assertHas("CONSTRUCTS", "services.EventService.registerParticipant(String,String)", "exceptions.EventNotFoundException");
        assertHas("CONSTRUCTS", "infra.RestExceptionHandler.eventFullErrorHandler(EventFullException)", "infra.RestErrorMessage");
    }

    @Test
    void declaredAndUsedTypesAreRelationships() {
        assertHas("USES_TYPE", "controllers.EventController.createEvent(EventRequestDTO)", "dtos.EventRequestDTO");
        assertHas("USES_TYPE", "controllers.EventController.registerParticipant(String,SubscriptionRequestDTO)", "dtos.SubscriptionRequestDTO");
        assertHas("USES_TYPE", "domain.Event.Event(EventRequestDTO)", "dtos.EventRequestDTO");
        assertHas("USES_TYPE", "services.EmailServiceClient.sendEmail(EmailRequestDTO)", "dtos.EmailRequestDTO");
        // Field type in the same package, generic arguments of a supertype, class literal in an annotation.
        assertHas("USES_TYPE", "domain.Subscription", "domain.Event");
        assertHas("USES_TYPE", "repositories.EventRepository", "domain.Event");
        assertHas("USES_TYPE", "infra.RestExceptionHandler.eventNotFoundHandler(EventNotFoundException)", "exceptions.EventNotFoundException");
        // One USES_TYPE per (member, type) pair: further sites are evidence on it, never duplicate edges.
        Map<String, Long> pairs = relationships.stream().filter(r -> "USES_TYPE".equals(r.get("kind")))
                .collect(Collectors.groupingBy(r -> r.get("source_symbol_id") + "->" + r.get("target_symbol_id"), Collectors.counting()));
        assertFalse(pairs.isEmpty());
        assertTrue(pairs.values().stream().allMatch(count -> count == 1), pairs.toString());
    }

    @Test
    void classLevelDependsOnSummarizesEveryKind() {
        assertHas("DEPENDS_ON", "domain.Event", "dtos.EventRequestDTO");
        assertHas("DEPENDS_ON", "controllers.EventController", "dtos.SubscriptionRequestDTO");
        assertHas("DEPENDS_ON", "services.EventService", "dtos.EmailRequestDTO");
        assertHas("DEPENDS_ON", "services.EventService", "exceptions.EventFullException");
        // Lombok getters never resolve (no annotation processing), but the receiver's declared type still links.
        assertHas("DEPENDS_ON", "services.EventService", "domain.Event");
        assertHas("DEPENDS_ON", "repositories.SubscriptionRepository", "domain.Subscription");
        // One DEPENDS_ON per class pair.
        Map<String, Long> pairs = relationships.stream().filter(r -> "DEPENDS_ON".equals(r.get("kind")))
                .collect(Collectors.groupingBy(r -> r.get("source_symbol_id") + "->" + r.get("target_symbol_id"), Collectors.counting()));
        assertTrue(pairs.values().stream().allMatch(count -> count == 1), pairs.toString());
    }

    @Test
    void dtoPackageIsConnectedAtPackageLevel() {
        Set<String> packageLinks = new TreeSet<>();
        for (Map<String, Object> r : relationships) {
            if (r.get("target_symbol_id") == null) continue;
            String from = packageOf((String) r.get("source_symbol_id")), to = packageOf((String) r.get("target_symbol_id"));
            if (!from.equals(to)) packageLinks.add(from + " -> " + to);
        }
        assertTrue(packageLinks.containsAll(Set.of(
                "controllers -> dtos", "services -> dtos", "domain -> dtos",
                "controllers -> domain", "services -> domain", "repositories -> domain",
                "services -> exceptions", "infra -> exceptions")), packageLinks.toString());
        // The DTO records reference only JDK types: nothing outgoing is invented.
        assertTrue(packageLinks.stream().noneMatch(link -> link.startsWith("dtos -> ")), packageLinks.toString());
    }

    @Test
    void newRelationshipsAreResolvedWithEvidenceAndNeverTargetUnindexedTypes() {
        for (Map<String, Object> r : relationships) {
            String kind = (String) r.get("kind");
            if (!Set.of("CONSTRUCTS", "USES_TYPE", "DEPENDS_ON").contains(kind)) continue;
            assertNotNull(r.get("target_symbol_id"), kind + " is only recorded for indexed targets");
            assertEquals("RESOLVED", r.get("resolution"));
            Integer evidence = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM relationship_evidence WHERE relationship_id = ?", Integer.class, r.get("id"));
            assertTrue(evidence != null && evidence > 0, kind + " " + r.get("id") + " must carry source evidence");
        }
        for (Map<String, Object> r : relationships) {
            if (r.get("target_symbol_id") != null) assertNotEquals(r.get("source_symbol_id"), r.get("target_symbol_id"), "no self edges");
        }
    }

    private void assertHas(String kind, String source, String target) {
        String sourceId = idOf(BASE + source), targetId = idOf(BASE + target);
        boolean found = relationships.stream().anyMatch(r -> kind.equals(r.get("kind")) && sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id")));
        assertTrue(found, "Expected " + kind + " " + source + " -> " + target + "; found from source: "
                + relationships.stream().filter(r -> sourceId.equals(r.get("source_symbol_id")) && r.get("target_symbol_id") != null)
                .map(r -> r.get("kind") + " " + symbols.get((String) r.get("target_symbol_id")).get("qualified_name")).sorted().toList());
    }

    private String idOf(String qualifiedName) {
        List<String> ids = symbols.values().stream().filter(s -> qualifiedName.equals(s.get("qualified_name"))).map(s -> (String) s.get("id")).toList();
        assertEquals(1, ids.size(), "exactly one symbol named " + qualifiedName);
        return ids.get(0);
    }

    private String packageOf(String symbolId) {
        Map<String, Object> current = symbols.get(symbolId);
        while (current != null && !"PACKAGE".equals(current.get("kind"))) current = symbols.get((String) current.get("parent_symbol_id"));
        String name = current == null ? "?" : (String) current.get("qualified_name");
        return name.substring(name.lastIndexOf('.') + 1);
    }
}
