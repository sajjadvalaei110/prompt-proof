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
 * ADR 0010 (with its 2026-09-25 amendment) against test-fixtures/journey-candidates: a call the symbol solver cannot
 * resolve stays an UNRESOLVED CALLS occurrence with no target, even when its receiver type is in source (candidate
 * calls were withdrawn), and an in-source method that overrides or implements an in-source supertype method gets an
 * OVERRIDES fact.
 */
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class UnresolvedCallsAndOverridesTest {

    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-candidates-db-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
    }

    @Autowired private AnalysisService analysisService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private Map<String, String> idByName;
    private Map<String, String> nameById;
    private List<Map<String, Object>> relationships;

    @BeforeAll
    void analyzeFixture() {
        Path fixture = Path.of("test-fixtures/journey-candidates").toAbsolutePath();
        assertTrue(fixture.toFile().exists(), "Fixture must exist at " + fixture);
        String workspaceId = UUID.randomUUID().toString(), jobId = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'journey-candidates', datetime('now'), datetime('now'))", workspaceId, fixture.toString());
        jdbcTemplate.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);
        analysisService.runAnalysis(workspaceId, jobId);
        String snapshotId = jdbcTemplate.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertNotNull(snapshotId, "Analysis must publish a snapshot");
        List<Map<String, Object>> symbols = jdbcTemplate.queryForList("SELECT id, qualified_name FROM symbol_versions WHERE snapshot_id = ?", snapshotId);
        idByName = symbols.stream().collect(Collectors.toMap(s -> (String) s.get("qualified_name"), s -> (String) s.get("id")));
        nameById = symbols.stream().collect(Collectors.toMap(s -> (String) s.get("id"), s -> (String) s.get("qualified_name")));
        relationships = jdbcTemplate.queryForList("""
            SELECT r.id, r.source_symbol_id, r.target_symbol_id, r.unresolved_target, r.kind, r.resolution, r.reason,
                   (SELECT group_concat(e.snippet, ' | ') FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id WHERE re.relationship_id = r.id) AS snippets
            FROM relationship_occurrences r WHERE r.snapshot_id = ?""", snapshotId);
    }

    // --- Withdrawn D1: a call the solver cannot resolve is never upgraded, whatever its receiver.

    private static final String UNAVAILABLE = "Static target unavailable in indexed source";

    @Test
    void aCallWithARecordAccessorArgumentStaysUnresolved() {
        unresolved("journey.api.SignupController.register(String,SignupRequest)", "signupService.register(eventId, request.email())");
        assertNone("journey.api.SignupController.register(String,SignupRequest)", "journey.service.SignupService.register(String,String)");
        assertNone("journey.api.SignupController.register(String,SignupRequest)", "journey.service.SignupService");
    }

    @Test
    void aMatchOnAnInSourceSupertypeIsNotGuessed() {
        unresolved("journey.pricing.Checkout.total(SignupRequest)", "pricing.price(request.seats(), 1)");
        assertNone("journey.pricing.Checkout.total(SignupRequest)", "journey.pricing.Pricing.price(int,int)");
    }

    @Test
    void anOverriddenSignatureIsNotGuessed() {
        unresolved("journey.pricing.Checkout.flatTotal(SignupRequest)", "flat.price(request.seats())");
        assertNone("journey.pricing.Checkout.flatTotal(SignupRequest)", "journey.pricing.FlatPricing.price(int)");
        assertNone("journey.pricing.Checkout.flatTotal(SignupRequest)", "journey.pricing.Pricing.price(int)");
    }

    @Test
    void privateMethodCallsAreNotGuessed() {
        unresolved("journey.pricing.Coupon.total(SignupRequest)", "apply(request.email())");
        assertNone("journey.pricing.Coupon.total(SignupRequest)", "journey.pricing.Coupon.apply(String)");
        assertNone("journey.pricing.SeasonalCoupon.use(SignupRequest)", "journey.pricing.Coupon.apply(String)");
        unresolved("journey.pricing.SeasonalCoupon.use(SignupRequest)", "apply(request.seats())");
    }

    @Test
    void ambiguousInSourceOverloadsStayUnresolved() {
        unresolved("journey.api.SignupController.label(SignupRequest)", "formatter.format(request.email())");
        assertNone("journey.api.SignupController.label(SignupRequest)", "journey.service.Formatter");
        assertNone("journey.api.SignupController.label(SignupRequest)", "journey.service.Formatter.format(String)");
        assertNone("journey.api.SignupController.label(SignupRequest)", "journey.service.Formatter.format(Integer)");
    }

    @Test
    void aRecordAccessorStaysUnresolved() {
        unresolved("journey.api.SignupController.register(String,SignupRequest)", "request.email()");
        assertTrue(matching("CALLS", "journey.api.SignupController.register(String,SignupRequest)", "journey.dto.SignupRequest").isEmpty());
    }

    @Test
    void lombokGettersAndInheritedLibraryMethodsStayUnresolved() {
        String source = id("journey.service.SignupService.register(String,String)");
        Set<String> unresolved = relationships.stream()
                .filter(r -> "CALLS".equals(r.get("kind")) && source.equals(r.get("source_symbol_id")) && r.get("target_symbol_id") == null)
                .peek(r -> assertEquals("UNRESOLVED", r.get("resolution"), r.toString()))
                .peek(r -> assertEquals(UNAVAILABLE, r.get("reason"), r.toString()))
                .map(r -> (String) r.get("unresolved_target")).collect(Collectors.toSet());
        assertEquals(Set.of("store.findById(eventId)", "store.findById(eventId).orElseThrow()", "event.getParticipants()", "store.save(event)",
                "LocalDateTime.now()", "UnknownLib.helper()"), unresolved);
        assertTrue(matching("CALLS", "journey.service.SignupService.register(String,String)", "journey.service.EventStore").isEmpty());
        assertTrue(matching("CALLS", "journey.service.SignupService.register(String,String)", "journey.domain.Event").isEmpty());
    }

    @Test
    void anInterfaceCallThatResolvesKeepsItsResolvedTarget() {
        Map<String, Object> call = only("CALLS", "journey.service.SignupService.register(String,String)", "journey.service.Notifier.send(String)");
        assertEquals("RESOLVED", call.get("resolution"));
    }

    @Test
    void aSolverResolvedJdkCallOnAnInSourceReceiverStaysUnresolved() {
        String describe = id("journey.pricing.Checkout.describe(PricingError)");
        assertTrue(relationships.stream().anyMatch(r -> describe.equals(r.get("source_symbol_id")) && "error.getMessage()".equals(r.get("unresolved_target")) && "UNRESOLVED".equals(r.get("resolution"))),
                "error.getMessage() stays UNRESOLVED; found from source: " + outgoing(describe));
        String error = id("journey.pricing.PricingError");
        assertTrue(relationships.stream().noneMatch(r -> "CALLS".equals(r.get("kind")) && error.equals(r.get("target_symbol_id"))),
                "No CALLS targets PricingError: " + relationships.stream().filter(r -> error.equals(r.get("target_symbol_id"))).toList());
    }

    @Test
    void noCallIsEverACandidateAndEveryUnresolvedCallHasNoTarget() {
        assertTrue(relationships.stream().noneMatch(r -> "CANDIDATE".equals(r.get("resolution")) && "CALLS".equals(r.get("kind"))),
                "CALLS/CANDIDATE found: " + relationships.stream().filter(r -> "CANDIDATE".equals(r.get("resolution"))).toList());
        for (Map<String, Object> r : relationships) {
            if (!"CALLS".equals(r.get("kind")) || !"UNRESOLVED".equals(r.get("resolution"))) continue;
            assertNull(r.get("target_symbol_id"), r.toString());
            assertNotNull(r.get("unresolved_target"), r.toString());
            assertEquals(UNAVAILABLE, r.get("reason"), r.toString());
        }
    }

    // --- D3: OVERRIDES from an in-source method to the in-source supertype method it overrides or implements.

    @Test
    void anImplementationOverridesEachInterfaceMethodWithTheSameParameters() {
        Map<String, Object> one = only("OVERRIDES", "journey.service.MailNotifier.send(String)", "journey.service.Notifier.send(String)");
        assertEquals("RESOLVED", one.get("resolution"));
        assertEquals("send", one.get("snippets"));
        assertNotNull(one.get("reason"));
        only("OVERRIDES", "journey.service.MailNotifier.send(String,String)", "journey.service.Notifier.send(String,String)");
        assertNone("journey.service.MailNotifier.send(String)", "journey.service.Notifier.send(String,String)");
        assertNone("journey.service.MailNotifier.send(String,String)", "journey.service.Notifier.send(String)");
    }

    @Test
    void anAbstractMethodIsOverriddenByBothSubclasses() {
        only("OVERRIDES", "journey.pricing.FlatPricing.price(int)", "journey.pricing.Pricing.price(int)");
        only("OVERRIDES", "journey.pricing.TieredPricing.price(int)", "journey.pricing.Pricing.price(int)");
        assertNone("journey.pricing.FlatPricing.price(int)", "journey.pricing.Pricing.price(int,int)");
    }

    @Test
    void staticMethodsHideRatherThanOverride() {
        assertNone("journey.pricing.FlatPricing.describe()", "journey.pricing.Pricing.describe()");
    }

    @Test
    void overridesFactsAreTheOnlyOnesAndAllResolved() {
        Set<String> overrides = relationships.stream().filter(r -> "OVERRIDES".equals(r.get("kind")))
                .peek(r -> assertEquals("RESOLVED", r.get("resolution"), r.toString()))
                .map(r -> nameById.get((String) r.get("source_symbol_id")) + " -> " + nameById.get((String) r.get("target_symbol_id"))).collect(Collectors.toSet());
        assertEquals(Set.of(
                "journey.service.MailNotifier.send(String) -> journey.service.Notifier.send(String)",
                "journey.service.MailNotifier.send(String,String) -> journey.service.Notifier.send(String,String)",
                "journey.pricing.FlatPricing.price(int) -> journey.pricing.Pricing.price(int)",
                "journey.pricing.TieredPricing.price(int) -> journey.pricing.Pricing.price(int)"), overrides);
    }

    private List<Map<String, Object>> matching(String kind, String source, String target) {
        String sourceId = id(source), targetId = id(target);
        return relationships.stream().filter(r -> kind.equals(r.get("kind")) && sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id"))).toList();
    }

    private Map<String, Object> only(String kind, String source, String target) {
        List<Map<String, Object>> found = matching(kind, source, target);
        assertEquals(1, found.size(), "Expected one " + kind + " " + source + " -> " + target + "; found from source: " + outgoing(id(source)));
        return found.get(0);
    }

    private void unresolved(String source, String snippet) {
        String sourceId = id(source);
        List<Map<String, Object>> found = relationships.stream()
                .filter(r -> "CALLS".equals(r.get("kind")) && sourceId.equals(r.get("source_symbol_id")) && snippet.equals(r.get("unresolved_target"))).toList();
        assertEquals(1, found.size(), "Expected one CALLS " + source + " -> <" + snippet + ">; found from source: " + outgoing(sourceId));
        assertEquals("UNRESOLVED", found.get(0).get("resolution"));
        assertNull(found.get(0).get("target_symbol_id"));
        assertEquals(UNAVAILABLE, found.get(0).get("reason"));
        assertEquals(snippet, found.get(0).get("snippets"));
    }

    private void assertNone(String source, String target) {
        String sourceId = id(source), targetId = id(target);
        assertTrue(relationships.stream().noneMatch(r -> sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id"))),
                "Unexpected relationship " + source + " -> " + target + "; found from source: " + outgoing(sourceId));
    }

    private String id(String qualifiedName) {
        String id = idByName.get(qualifiedName);
        assertNotNull(id, "No symbol " + qualifiedName + "; symbols: " + new TreeSet<>(idByName.keySet()));
        return id;
    }

    private List<String> outgoing(String sourceId) {
        return relationships.stream().filter(r -> sourceId.equals(r.get("source_symbol_id")))
                .map(r -> r.get("kind") + " " + r.get("resolution") + " " + nameById.getOrDefault((String) r.get("target_symbol_id"), "<" + r.get("unresolved_target") + ">")).sorted().toList();
    }
}
