package dev.codeatlas.explanations;

import dev.codeatlas.modelclient.ModelRequestBudget;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.config.CodeAtlasProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class ContextBuilder {
    private final JdbcTemplate db;
    private final CodeAtlasProperties properties;
    private final PromptTemplate templates;
    private final ObjectMapper json = new ObjectMapper();
    public record EvidenceItem(String id, String label, String content) {}
    public record SymbolContext(String symbolId, String simpleName, String qualifiedName, String kind,
        String parentName, List<String> roles, List<String> annotations, String sourceSnippet,
        List<EvidenceItem> evidenceItems, String formattedContext, List<ContextDependency> dependencies) {}
    public record ContextDependency(String symbolId, String kind, String version) {}
    public record PriorExplanation(ContextDependency dependency, String content) {}
    public record ArchitectureContext(Set<String> classIds, List<EvidenceItem> evidenceItems, String formattedContext, Map<String, String> classInventory) {}
    public ContextBuilder(JdbcTemplate db, CodeAtlasProperties properties, PromptTemplate templates) { this.db = db; this.properties = properties; this.templates = templates; }

    public SymbolContext buildSymbolContext(String snapshotId, String subjectId) { return buildContext(snapshotId, subjectId, "symbol"); }

    /**
     * Cheap signature of the only input to buildContext() that can change while a
     * (published, otherwise immutable) snapshot is being explained: project documents.
     * Used to detect mid-generation staleness without re-running the full context build.
     */
    public String documentsFingerprint(String snapshotId) {
        String workspace = db.queryForObject("SELECT workspace_id FROM snapshots WHERE id = ?", String.class, snapshotId);
        List<String> parts = db.queryForList(
            "SELECT id || ':' || revision FROM project_documents WHERE workspace_id = ? ORDER BY id",
            String.class, workspace);
        return String.join(",", parts);
    }
    public SymbolContext buildContext(String snapshotId, String subjectId, String subjectType) {
        boolean edge = "relationship".equals(subjectType);
        var rows = db.queryForList(edge
            ? "SELECT r.*, s.qualified_name, s.simple_name, s.parent_symbol_id, s.roles, s.annotations, s.content_hash, s.id AS context_symbol FROM relationship_occurrences r JOIN symbol_versions s ON s.id = r.source_symbol_id WHERE r.snapshot_id = ? AND r.id = ?"
            : "SELECT *, id AS context_symbol FROM symbol_versions WHERE snapshot_id = ? AND (id = ? OR qualified_name = ?) ORDER BY id LIMIT 1",
            edge ? new Object[]{snapshotId, subjectId} : new Object[]{snapshotId, subjectId, subjectId});
        if (rows.isEmpty()) throw new IllegalArgumentException("Subject not found in snapshot");
        var subject = rows.get(0);
        String id = (String) subject.get("id");
        String symbolId = (String) subject.get("context_symbol");
        String workspace = db.queryForObject("SELECT workspace_id FROM snapshots WHERE id = ?", String.class, snapshotId);
        List<EvidenceItem> evidence = new ArrayList<>();
        List<ContextDependency> dependencies = new ArrayList<>();
        StringBuilder out = new StringBuilder("TARGET " + (edge ? "RELATIONSHIP" : "SYMBOL") + ": " + id + " " + subject.get("kind") + " " + subject.get("qualified_name") + "\n");
        List<String> omissions = new ArrayList<>();
        // Token estimate with framing/variance margin and reserved template/repair space.
        int budget = Math.max(0, new ModelRequestBudget(properties.getModel().getContextBudget(), properties.getModel().getOutputBudget()).inputTokens(properties.getModel().getOutputBudget()) - ModelRequestBudget.estimate(templates.getSystemPrompt()) - 1024);
        Budget writer = new Budget(out, evidence, omissions, budget);
        String source = source(snapshotId, symbolId, (String) subject.get("content_hash"));
        writer.add("ev-source", "Target source declaration", source, Math.max(300, budget / 5));
        if (edge) {
            var targets = db.queryForList("SELECT qualified_name FROM symbol_versions WHERE id = ? AND snapshot_id = ?", String.class, subject.get("target_symbol_id"), snapshotId);
            writer.add("ev-relationship", "Static relationship occurrence", subject.get("qualified_name") + " --" + subject.get("kind") + "--> " + (targets.isEmpty() ? subject.get("unresolved_target") : targets.get(0)) + " [" + subject.get("resolution") + "] " + subject.get("reason"), 1500);
            var sites = db.queryForList("SELECT f.relative_path, e.snippet, e.start_line, e.start_column, e.end_line, e.end_column FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id JOIN source_file_versions f ON f.id = e.source_file_version_id WHERE re.relationship_id = ? ORDER BY e.start_line, e.start_column, e.id", id);
            for (int i=0; i<sites.size(); i++) writer.add("ev-site-" + i, "Relationship source occurrence", sites.get(i).toString(), 1000);
        }
        var roles = strings(subject.get("roles"));
        if (!roles.isEmpty()) writer.add("ev-roles", "Spring Stereotypes (static recognition)", roles.toString(), 500);
        String parent = (String)subject.get("parent_symbol_id");
        String parentName = null;
        if (parent != null) {
            var parents = db.queryForList("SELECT qualified_name, kind, content_hash FROM symbol_versions WHERE id = ? AND snapshot_id = ?", parent, snapshotId);
            if (!parents.isEmpty()) {
                parentName = (String)parents.get(0).get("qualified_name");
                writer.add("ev-enclosing", "Enclosing declaration", parentName, 500);
            }
        }
        var rels = db.queryForList("SELECT r.id, r.kind, r.resolution, r.source_symbol_id, r.target_symbol_id, s.qualified_name AS caller, COALESCE(t.qualified_name, r.unresolved_target) AS target FROM relationship_occurrences r JOIN symbol_versions s ON s.id = r.source_symbol_id LEFT JOIN symbol_versions t ON t.id = r.target_symbol_id WHERE r.snapshot_id = ? AND (s.id = ? OR t.id = ? OR s.parent_symbol_id = ? OR t.parent_symbol_id = ?) ORDER BY r.kind, s.qualified_name, t.qualified_name, r.id", snapshotId, symbolId, symbolId, symbolId, symbolId);
        Set<String> neighbors = new LinkedHashSet<>();
        writer.add("ev-relations", "Incoming/outgoing parser relationships", lines(rels), Math.max(200, budget / 8));
        for (var rel : rels) {
            if (rel.get("source_symbol_id") != null) neighbors.add((String)rel.get("source_symbol_id"));
            if (rel.get("target_symbol_id") != null) neighbors.add((String)rel.get("target_symbol_id"));
        }
        // Endpoint and enclosing context precede broad inventories. Members without an edge
        // still contribute to class behavior. Related method owners supply architectural context.
        Set<String> resources = new LinkedHashSet<>();
        resources.add(symbolId);
        if (edge && subject.get("target_symbol_id") != null) resources.add((String) subject.get("target_symbol_id"));
        if (parent != null) resources.add(parent);
        resources.addAll(neighbors);
        if ("CLASS".equals(subject.get("kind")) && !edge) resources.addAll(db.queryForList(
            "SELECT id FROM symbol_versions WHERE snapshot_id = ? AND parent_symbol_id = ? AND kind = 'METHOD' ORDER BY qualified_name, id",
            String.class, snapshotId, symbolId));
        for (String resource : List.copyOf(resources)) {
            resources.addAll(db.queryForList("SELECT p.id FROM symbol_versions s JOIN symbol_versions p ON p.id = s.parent_symbol_id AND p.snapshot_id = s.snapshot_id WHERE s.snapshot_id = ? AND s.id = ? AND p.kind IN ('CLASS','INTERFACE','ENUM','RECORD')", String.class, snapshotId, resource));
        }
        resources.removeIf(resource -> db.queryForObject("SELECT COUNT(*) FROM symbol_versions WHERE snapshot_id = ? AND id = ? AND kind = 'PACKAGE'", Integer.class, snapshotId, resource) > 0);
        // Share finite space across every resource, rather than allowing the first neighbor to
        // consume the window. All omissions are disclosed. Source remains the factual authority.
        int resourceAllowance = Math.max(160, budget / 3 / Math.max(1, resources.size()));
        for (String resource : resources) {
            var n = db.queryForList("SELECT qualified_name, content_hash FROM symbol_versions WHERE snapshot_id = ? AND id = ?", snapshotId, resource);
            if (n.isEmpty()) continue;
            if (!resource.equals(symbolId)) writer.add("neighbor-" + resource, "Collaborator source: " + n.get(0).get("qualified_name"), source(snapshotId, resource, (String)n.get(0).get("content_hash")), resourceAllowance);
            var prior = priorExplanation(snapshotId, resource, !edge && resource.equals(symbolId) && "CLASS".equals(subject.get("kind")));
            if (prior != null && writer.add("ai-" + resource, "Prior generated interpretation: " + n.get(0).get("qualified_name") + " (not parser facts)", prior.content(), resourceAllowance)) {
                if (!resource.equals(symbolId) || !prior.dependency().kind().equals("full")) dependencies.add(prior.dependency());
            }
        }
        // Whole-codebase inventory is deterministic and sampled fairly across sections, never model summaries.
        var counts = db.queryForList("SELECT kind, COUNT(*) AS count FROM symbol_versions WHERE snapshot_id = ? GROUP BY kind ORDER BY kind", snapshotId);
        writer.add("ev-codebase", "Whole-codebase scope", counts.toString(), 800);
        var packages = db.queryForList("SELECT qualified_name FROM symbol_versions WHERE snapshot_id = ? AND kind = 'PACKAGE' ORDER BY qualified_name", String.class, snapshotId);
        writer.add("ev-packages", "Package inventory (entire snapshot)", String.join("\n", packages), Math.max(200, budget / 16));
        var coupling = packageCoupling(snapshotId);
        writer.add("ev-architecture", "Whole-codebase package dependencies (static)", lines(coupling), Math.max(300, budget / 10));
        var types = db.queryForList("SELECT qualified_name, roles FROM symbol_versions WHERE snapshot_id = ? AND kind IN ('CLASS','INTERFACE','ENUM','RECORD','ANNOTATION') ORDER BY qualified_name", snapshotId);
        writer.add("ev-types", "Type and responsibility inventory (static roles)", lines(types), Math.max(250, budget / 12));
        var docs = db.queryForList("SELECT id, title, content, revision FROM project_documents WHERE workspace_id = ? ORDER BY created_at, id", workspace);
        int docAllowance = Math.max(200, budget / 6 / Math.max(1, docs.size()));
        for (var doc : docs) writer.add("doc-" + doc.get("id") + "-r" + doc.get("revision"), "User document: " + doc.get("title") + " (untrusted contextual assertions, not parser facts)", (String)doc.get("content"), docAllowance);
        var routes = db.queryForList("SELECT hr.http_method, hr.path, s.qualified_name FROM http_routes hr JOIN symbol_versions s ON s.id = hr.symbol_version_id WHERE hr.snapshot_id = ? ORDER BY hr.path, s.qualified_name", snapshotId);
        int routeIndex = 1;
        for (var route : routes) writer.add("ev-route-" + routeIndex++, "HTTP Route (static)", route.toString(), Math.max(100, budget / 16 / Math.max(1, routes.size())));
        var injections = db.queryForList("SELECT target_type_name, injection_kind, resolution FROM injection_points WHERE snapshot_id = ? AND (source_symbol_id = ? OR source_symbol_id = ?) ORDER BY target_type_name", snapshotId, symbolId, parent);
        int injectionIndex = 1;
        for (var inj : injections) writer.add("ev-inj-" + injectionIndex++, "Dependency Injection", inj.toString(), Math.max(100, budget / 20 / Math.max(1, injections.size())));
        if (!omissions.isEmpty()) out.append("\nCONTEXT LIMITS: Some evidence was shortened or omitted to fit the configured budget: ").append(String.join(", ", omissions.stream().distinct().limit(12).toList())).append(". Do not imply complete source coverage.\n");
        else out.append("\nCONTEXT LIMITS: Inventory covers this indexed snapshot; source is target and relevant collaborators, not every file. Runtime behavior and missing classpaths are not established.\n");
        return new SymbolContext(id, (String)subject.get("simple_name"), (String)subject.get("qualified_name"), (String)subject.get("kind"), parentName, roles, strings(subject.get("annotations")), source, evidence, out.toString(), List.copyOf(dependencies));
    }
    /** Complete, untruncated inventory and documents for resumable architecture preparation. */
    public ArchitectureContext buildArchitectureContext(String snapshotId) {
        String workspace = db.queryForObject("SELECT workspace_id FROM snapshots WHERE id = ?", String.class, snapshotId);
        var types = db.queryForList("SELECT id AS symbolId, qualified_name, parent_symbol_id, kind, roles FROM symbol_versions WHERE snapshot_id = ? AND kind IN ('CLASS','INTERFACE','ENUM','RECORD','ANNOTATION') AND COALESCE(source_status, 'ACTIVE') = 'ACTIVE' ORDER BY qualified_name, id", snapshotId);
        Set<String> classIds = new LinkedHashSet<>();
        types.stream().filter(t -> "CLASS".equals(t.get("kind"))).forEach(t -> classIds.add((String)t.get("symbolId")));
        List<EvidenceItem> evidence = new ArrayList<>();
        evidence.add(new EvidenceItem("ev-packages", "Complete package tree", lines(db.queryForList("SELECT id, qualified_name, parent_symbol_id FROM symbol_versions WHERE snapshot_id = ? AND kind = 'PACKAGE' ORDER BY qualified_name", snapshotId))));
        evidence.add(new EvidenceItem("ev-types", "Complete type inventory and static stereotypes", lines(types)));
        evidence.add(new EvidenceItem("ev-architecture", "Package coupling with static resolution", lines(packageCoupling(snapshotId))));
        for (var doc : db.queryForList("SELECT id, title, content, revision FROM project_documents WHERE workspace_id = ? ORDER BY id", workspace)) {
            evidence.add(new EvidenceItem("doc-" + doc.get("id") + "-r" + doc.get("revision"), "Untrusted project document: " + doc.get("title"), (String)doc.get("content")));
        }
        StringBuilder out = new StringBuilder("Snapshot: " + snapshotId + "\n");
        evidence.forEach(e -> out.append("\n[").append(e.id()).append("] ").append(e.label()).append(":\n").append(e.content()).append('\n'));
        Map<String, String> classInventory = new LinkedHashMap<>();
        types.stream().filter(t -> "CLASS".equals(t.get("kind"))).forEach(t -> classInventory.put((String)t.get("symbolId"), t.toString()));
        return new ArchitectureContext(Collections.unmodifiableSet(classIds), List.copyOf(evidence), out.toString(), Collections.unmodifiableMap(classInventory));
    }

    private List<Map<String, Object>> packageCoupling(String snapshotId) {
        return db.queryForList("WITH RECURSIVE owners(id, ancestor, parent, kind, name) AS (SELECT id, id, parent_symbol_id, kind, qualified_name FROM symbol_versions WHERE snapshot_id = ? UNION ALL SELECT o.id, p.id, p.parent_symbol_id, p.kind, p.qualified_name FROM owners o JOIN symbol_versions p ON p.id = o.parent) SELECT a.name AS source_package, b.name AS target_package, r.kind, r.resolution, COUNT(*) AS occurrences FROM relationship_occurrences r JOIN owners a ON a.id = r.source_symbol_id AND a.kind = 'PACKAGE' JOIN owners b ON b.id = r.target_symbol_id AND b.kind = 'PACKAGE' WHERE r.snapshot_id = ? AND a.ancestor != b.ancestor GROUP BY a.name,b.name,r.kind,r.resolution ORDER BY a.name,b.name,r.kind", snapshotId, snapshotId);
    }

    public PriorExplanation priorExplanation(String snapshot, String symbol) {
        return priorExplanation(snapshot, symbol, false);
    }

    private PriorExplanation priorExplanation(String snapshot, String symbol, boolean preferDraft) {
        String kind = preferDraft ? "pre" : "full";
        var full = generatedRow(snapshot, symbol, kind);
        if (full.isEmpty()) { kind = preferDraft ? "full" : "pre"; full = generatedRow(snapshot, symbol, kind); }
        if (full.isEmpty()) return null;
        var row = full.get(0);
        String content = kind.equals("full")
            ? "Full explanation (READY; generated interpretation): " + row.get("short_label") + "\n" + row.get("hover_summary") + "\nClaims (citations belong to its original context): " + row.get("claims") + "\nUnknowns: " + row.get("unknowns")
            : "Architectural pre-explanation (DRAFT; inferred purpose): " + row.get("business_logic");
        content += "\nProvenance: " + row.get("model_id") + "; prompt " + row.get("prompt_version") + "; input " + row.get("input_fingerprint");
        return new PriorExplanation(new ContextDependency(symbol, kind, digest(row.toString())), content);
    }

    private List<Map<String, Object>> generatedRow(String snapshot, String symbol, String kind) {
        return db.queryForList(kind.equals("full") ? """
            SELECT id, short_label, hover_summary, claims, unknowns, model_id, prompt_version, input_fingerprint
            FROM explanations WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = 'symbol' AND status = 'READY'
            ORDER BY updated_at DESC, id LIMIT 1
            """ : """
            SELECT p.business_logic, a.id, a.model_id, a.prompt_version, a.input_fingerprint
            FROM class_pre_explanations p JOIN explanation_syntheses a ON a.id = p.synthesis_id
            WHERE a.snapshot_id = ? AND p.symbol_id = ? AND a.status = 'READY'
            """, snapshot, symbol);
    }

    /** Only consumed outputs are dependencies. Newly available prose does not stale earlier work. */
    public boolean dependenciesFresh(String snapshot, List<ContextDependency> dependencies) {
        for (var input : dependencies) {
            var rows = generatedRow(snapshot, input.symbolId(), input.kind());
            if (rows.isEmpty() || !digest(rows.get(0).toString()).equals(input.version())) return false;
        }
        return true;
    }

    private String digest(String value) {
        try { return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private String source(String snapshot, String id, String hash) {
        var exact = db.queryForList("SELECT e.snippet FROM symbol_evidence se JOIN evidence e ON e.id = se.evidence_id JOIN source_file_versions f ON f.id = e.source_file_version_id WHERE se.symbol_version_id = ? AND f.snapshot_id = ? ORDER BY e.start_line LIMIT 1", String.class, id, snapshot);
        if (!exact.isEmpty()) return exact.get(0);
        var files = db.queryForList("SELECT source_content FROM source_file_versions WHERE snapshot_id = ? AND content_hash = ? ORDER BY relative_path LIMIT 1", String.class, snapshot, hash);
        return files.isEmpty() ? "Source unavailable; re-index for exact evidence." : "Legacy index: enclosing file, declaration span unavailable.\n" + files.get(0);
    }
    private String lines(List<Map<String, Object>> rows) { return String.join("\n", rows.stream().map(Map::toString).toList()); }
    private List<String> strings(Object value) {
        try { return value == null ? List.of() : json.readValue(value.toString(), json.getTypeFactory().constructCollectionType(List.class, String.class)); }
        catch (Exception e) { return List.of(); }
    }
    private static class Budget {
        private final StringBuilder out; private final List<EvidenceItem> evidence; private final List<String> omissions; private int remaining;
        Budget(StringBuilder out, List<EvidenceItem> evidence, List<String> omissions, int budget) { this.out=out; this.evidence=evidence; this.omissions=omissions; this.remaining=budget; }
        boolean add(String id, String label, String content, int allowance) {
            if (content == null || content.isBlank()) return false;
            String header = "\n[" + id + "] " + label + ":\n";
            int limit = Math.min(allowance, remaining - ModelRequestBudget.estimate(header) - 40);
            if (limit < 80) { omissions.add(label); return false; }
            String actual = content;
            if (ModelRequestBudget.estimate(actual) > limit) {
                actual = ModelRequestBudget.prefix(actual, limit) + "\n[Context shortened]"; omissions.add(label);
            }
            out.append(header).append(actual).append('\n'); remaining -= ModelRequestBudget.estimate(header) + ModelRequestBudget.estimate(actual) + 1;
            evidence.add(new EvidenceItem(id, label, actual));
            return true;
        }
    }
}
