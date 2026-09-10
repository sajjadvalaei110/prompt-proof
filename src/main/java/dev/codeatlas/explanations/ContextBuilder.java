package dev.codeatlas.explanations;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.modelclient.ModelRequestBudget;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Builds one bounded explanation context through the same interface for symbols and edges. */
@Component
public class ContextBuilder {
    private final JdbcTemplate db;
    private final CodeAtlasProperties properties;
    private final PromptTemplate templates;
    private final BoundedWorkMetrics metrics;
    private final ObjectMapper json = new ObjectMapper();

    public record EvidenceItem(String id, String label, String content) {}
    public record Omission(String category, int included, int omitted, boolean truncated) {}
    public record SymbolContext(String symbolId, String simpleName, String qualifiedName, String kind,
        String parentName, List<String> roles, List<String> annotations, String sourceSnippet,
        List<EvidenceItem> evidenceItems, String formattedContext, List<ContextDependency> dependencies,
        List<Omission> omissions) {}
    public record ContextDependency(String symbolId, String kind, String version) {}
    public record PriorExplanation(ContextDependency dependency, String content) {}

    public ContextBuilder(JdbcTemplate db, CodeAtlasProperties properties, PromptTemplate templates,
                          BoundedWorkMetrics metrics) {
        this.db = db;
        this.properties = properties;
        this.templates = templates;
        this.metrics = metrics;
    }

    public SymbolContext buildSymbolContext(String snapshotId, String subjectId) {
        return buildContext(snapshotId, subjectId, "symbol");
    }

    /** Revisions are bounded by the document contract and avoid fetching document bodies. */
    public String documentsFingerprint(String snapshotId) {
        String workspace = db.queryForObject("SELECT workspace_id FROM snapshots WHERE id=?", String.class, snapshotId);
        var parts = db.queryForList("SELECT id,revision,length(content) AS chars FROM project_documents WHERE workspace_id=? ORDER BY id LIMIT 31", workspace);
        metrics.rowsLoaded(parts.size());
        return digest(parts.toString());
    }

    public String architectureFingerprint(String snapshotId, String profileIdentity) {
        String facts = db.queryForObject("""
            SELECT id||'|'||COALESCE(parser_version,'')||'|'||COALESCE(rule_version,'')||'|'||
                   COALESCE(roots_fingerprint,'')||'|'||COALESCE(classpath_fingerprint,'')||'|'||
                   COALESCE(symbol_count,0)||'|'||COALESCE(relationship_count,0)
            FROM snapshots WHERE id=?
            """, String.class, snapshotId);
        return digest(ArchitectureBatchProcessor.VERSION + "|" + facts + "|" + documentsFingerprint(snapshotId)
            + "|" + profileIdentity + "|" + limitIdentity());
    }

    public SymbolContext buildContext(String snapshotId, String subjectId, String subjectType) {
        return buildContext(snapshotId, subjectId, subjectType, 1);
    }

    /**
     * {@code shrink} divides the prompt token budget so a caller can rebuild the same subject
     * smaller after a provider rejects the input size. A declared context window is a claim about
     * the model, not a measurement; only the provider's rejection is authoritative.
     */
    public SymbolContext buildContext(String snapshotId, String subjectId, String subjectType, int shrink) {
        boolean edge = "relationship".equals(subjectType);
        var rows = db.queryForList(edge ? """
            SELECT r.*,s.qualified_name,s.simple_name,s.parent_symbol_id,s.roles,s.annotations,s.content_hash,s.id AS context_symbol
            FROM relationship_occurrences r JOIN symbol_versions s ON s.id=r.source_symbol_id
            WHERE r.snapshot_id=? AND r.id=? LIMIT 1
            """ : """
            SELECT *,id AS context_symbol FROM symbol_versions
            WHERE snapshot_id=? AND (id=? OR qualified_name=?) ORDER BY id LIMIT 1
            """, edge ? new Object[]{snapshotId, subjectId} : new Object[]{snapshotId, subjectId, subjectId});
        metrics.rowsLoaded(rows.size());
        if (rows.isEmpty()) throw new IllegalArgumentException("Subject not found in snapshot");
        var subject = rows.get(0);
        String id = String.valueOf(subject.get("id"));
        String symbolId = String.valueOf(subject.get("context_symbol"));
        String workspace = db.queryForObject("SELECT workspace_id FROM snapshots WHERE id=?", String.class, snapshotId);
        var limits = properties.getExplanations();
        List<EvidenceItem> evidence = new ArrayList<>();
        List<ContextDependency> dependencies = new ArrayList<>();
        List<Omission> omissions = new ArrayList<>();
        StringBuilder out = new StringBuilder("TARGET " + (edge ? "RELATIONSHIP" : "SYMBOL") + ": " + id + " " + subject.get("kind") + " " + subject.get("qualified_name") + "\n");
        int tokenBudget = Math.max(0, new ModelRequestBudget(properties.getModel().getContextBudget(), properties.getModel().getOutputBudget())
            .inputTokens(properties.getModel().getOutputBudget()) - ModelRequestBudget.estimate(templates.getSystemPrompt()) - 1024);
        // A token setting cannot authorize an arbitrarily large Java String. The factor
        // covers worst-case JSON escaping plus prompt framing before the exact byte gate.
        tokenBudget = Math.min(tokenBudget, Math.max(0, (properties.getModel().getMaxRequestBytes() - 8_192) / 18));
        tokenBudget = tokenBudget / Math.max(1, shrink);
        Budget writer = new Budget(out, evidence, omissions, tokenBudget);

        String source = source(snapshotId, symbolId, String.valueOf(subject.get("content_hash")), limits.getSourceChars());
        writer.add("ev-source", "Target source declaration", source, Math.max(300, tokenBudget / 5), limits.getSourceChars());

        if (edge) addEdgeEvidence(snapshotId, subject, writer, omissions);
        var roles = strings(subject.get("roles"));
        if (!roles.isEmpty()) writer.add("ev-roles", "Spring stereotypes (static recognition)", roles.toString(), 500, 2000);

        String parent = (String) subject.get("parent_symbol_id");
        String parentName = null;
        if (parent != null) {
            var parents = db.queryForList("SELECT qualified_name FROM symbol_versions WHERE id=? AND snapshot_id=? LIMIT 1", parent, snapshotId);
            metrics.rowsLoaded(parents.size());
            if (!parents.isEmpty()) {
                parentName = String.valueOf(parents.get(0).get("qualified_name"));
                writer.add("ev-enclosing", "Enclosing declaration", parentName, 500, 1000);
            }
        }

        int relatedLimit = limits.getRelatedSymbols();
        var rels = db.queryForList("""
            WITH relevant AS (
              SELECT r.id,r.kind,r.resolution,r.source_symbol_id,r.target_symbol_id,
                     s.qualified_name AS caller,COALESCE(t.qualified_name,r.unresolved_target) AS target,
                     CASE WHEN s.id=? OR t.id=? THEN 0 ELSE 1 END AS relevance
              FROM relationship_occurrences r
              JOIN symbol_versions s ON s.id=r.source_symbol_id
              LEFT JOIN symbol_versions t ON t.id=r.target_symbol_id
              WHERE r.snapshot_id=? AND (s.id=? OR t.id=? OR s.parent_symbol_id=? OR t.parent_symbol_id=?)
            )
            SELECT * FROM relevant ORDER BY relevance,
              CASE resolution WHEN 'RESOLVED' THEN 0 WHEN 'CANDIDATE' THEN 1 ELSE 2 END,
              kind,caller,target,id LIMIT ?
            """, symbolId, symbolId, snapshotId, symbolId, symbolId, symbolId, symbolId, relatedLimit + 1);
        metrics.rowsLoaded(rels.size());
        boolean relationsOmitted = rels.size() > relatedLimit;
        if (relationsOmitted) rels = new ArrayList<>(rels.subList(0, relatedLimit));
        writer.add("ev-relations", "Bounded incoming/outgoing parser relationships", lines(rels), Math.max(200, tokenBudget / 8), limits.getSourceChars());
        omissions.add(new Omission("relationships", rels.size(), relationsOmitted ? 1 : 0, relationsOmitted));

        LinkedHashSet<String> resources = new LinkedHashSet<>();
        resources.add(symbolId);
        if (edge && subject.get("target_symbol_id") != null) resources.add(String.valueOf(subject.get("target_symbol_id")));
        if (parent != null) resources.add(parent);
        for (var rel : rels) {
            if (resources.size() >= relatedLimit) break;
            if (rel.get("source_symbol_id") != null) resources.add(String.valueOf(rel.get("source_symbol_id")));
            if (resources.size() < relatedLimit && rel.get("target_symbol_id") != null) resources.add(String.valueOf(rel.get("target_symbol_id")));
        }
        if ("CLASS".equals(subject.get("kind")) && !edge && resources.size() < relatedLimit) {
            int memberLimit = Math.min(limits.getRelatedMethods(), relatedLimit - resources.size());
            var members = db.queryForList("""
                SELECT m.id FROM symbol_versions m
                WHERE m.snapshot_id=? AND m.parent_symbol_id=? AND m.kind='METHOD'
                ORDER BY
                  ((SELECT COUNT(*) FROM relationship_occurrences r WHERE r.snapshot_id=m.snapshot_id AND r.source_symbol_id=m.id)+
                   (SELECT COUNT(*) FROM relationship_occurrences r WHERE r.snapshot_id=m.snapshot_id AND r.target_symbol_id=m.id)),
                  COALESCE((SELECT MAX(e.end_line-e.start_line+1) FROM symbol_evidence se JOIN evidence e ON e.id=se.evidence_id WHERE se.symbol_version_id=m.id),2147483647),m.id
                LIMIT ?
                """, String.class, snapshotId, symbolId, memberLimit + 1);
            metrics.rowsLoaded(members.size());
            boolean omitted = members.size() > memberLimit;
            members.stream().limit(memberLimit).forEach(resources::add);
            omissions.add(new Omission("member methods", Math.min(memberLimit, members.size()), omitted ? 1 : 0, omitted));
        }
        addOwners(snapshotId, resources, relatedLimit);
        metrics.symbolsRetained(resources.size());

        int resourceAllowance = Math.max(160, tokenBudget / 3 / Math.max(1, resources.size()));
        int resourceIndex = 0;
        for (String resource : resources) {
            if (writer.remaining() < 200) {
                omissions.add(new Omission("related symbol contexts", resourceIndex, resources.size() - resourceIndex, false));
                break;
            }
            resourceIndex++;
            var related = db.queryForList("SELECT qualified_name,content_hash,kind FROM symbol_versions WHERE snapshot_id=? AND id=? AND kind!='PACKAGE' LIMIT 1", snapshotId, resource);
            metrics.rowsLoaded(related.size());
            if (related.isEmpty()) continue;
            var row = related.get(0);
            if (!resource.equals(symbolId)) writer.add("neighbor-" + resource, "Collaborator source: " + row.get("qualified_name"),
                source(snapshotId, resource, String.valueOf(row.get("content_hash")), limits.getSourceChars()), resourceAllowance, limits.getSourceChars());
            var prior = priorExplanation(snapshotId, resource, !edge && resource.equals(symbolId) && "CLASS".equals(subject.get("kind")));
            if (prior != null && writer.add("ai-" + resource, "Prior generated interpretation: " + row.get("qualified_name") + " (not parser facts)",
                    prior.content(), resourceAllowance, limits.getExplanationChars())) {
                if (!resource.equals(symbolId) || !prior.dependency().kind().equals("full")) dependencies.add(prior.dependency());
            }
        }

        addBoundedGlobalContext(snapshotId, workspace, symbolId, parent, writer, omissions);
        appendLimits(out, evidence, omissions);
        return new SymbolContext(id, String.valueOf(subject.get("simple_name")), String.valueOf(subject.get("qualified_name")),
            String.valueOf(subject.get("kind")), parentName, roles, strings(subject.get("annotations")), source,
            List.copyOf(evidence), out.toString(), List.copyOf(dependencies), List.copyOf(omissions));
    }

    private void addEdgeEvidence(String snapshot, Map<String, Object> subject, Budget writer, List<Omission> omissions) {
        var limits = properties.getExplanations();
        var targets = db.queryForList("SELECT qualified_name FROM symbol_versions WHERE id=? AND snapshot_id=? LIMIT 1", String.class, subject.get("target_symbol_id"), snapshot);
        metrics.rowsLoaded(targets.size());
        writer.add("ev-relationship", "Static relationship occurrence", subject.get("qualified_name") + " --" + subject.get("kind") + "--> "
            + (targets.isEmpty() ? subject.get("unresolved_target") : targets.get(0)) + " [" + subject.get("resolution") + "] " + subject.get("reason"), 1500, 4000);
        int limit = limits.getEvidenceOccurrences();
        var sites = db.queryForList("""
            SELECT f.relative_path,substr(COALESCE(e.snippet,''),1,?) AS snippet,e.start_line,e.start_column,e.end_line,e.end_column
            FROM relationship_evidence re JOIN evidence e ON e.id=re.evidence_id
            JOIN source_file_versions f ON f.id=e.source_file_version_id
            WHERE re.relationship_id=? ORDER BY e.start_line,e.start_column,e.id LIMIT ?
            """, limits.getSourceChars(), subject.get("id"), limit + 1);
        metrics.rowsLoaded(sites.size());
        boolean omitted = sites.size() > limit;
        for (int i = 0; i < Math.min(limit, sites.size()); i++)
            writer.add("ev-site-" + i, "Relationship source occurrence", sites.get(i).toString(), 1000, limits.getSourceChars());
        omissions.add(new Omission("edge call-site evidence", Math.min(limit, sites.size()), omitted ? 1 : 0, omitted));
    }

    private void addOwners(String snapshot, LinkedHashSet<String> resources, int limit) {
        for (String resource : List.copyOf(resources)) {
            if (resources.size() >= limit) break;
            var owners = db.queryForList("""
                SELECT p.id FROM symbol_versions s JOIN symbol_versions p ON p.id=s.parent_symbol_id AND p.snapshot_id=s.snapshot_id
                WHERE s.snapshot_id=? AND s.id=? AND p.kind IN ('CLASS','INTERFACE','ENUM','RECORD') LIMIT 1
                """, String.class, snapshot, resource);
            metrics.rowsLoaded(owners.size());
            resources.addAll(owners);
        }
    }

    private void addBoundedGlobalContext(String snapshot, String workspace, String symbol, String parent,
                                         Budget writer, List<Omission> omissions) {
        var limits = properties.getExplanations();
        int rowsLimit = limits.getInventoryRows();
        if (!room(writer, omissions, "global codebase context")) return;
        var counts = db.queryForList("SELECT kind,COUNT(*) AS count FROM symbol_versions WHERE snapshot_id=? GROUP BY kind ORDER BY kind LIMIT 32", snapshot);
        metrics.rowsLoaded(counts.size());
        writer.add("ev-codebase", "Whole-codebase counts", counts.toString(), 800, 4000);

        if (!room(writer, omissions, "package inventory")) return;
        var packages = db.queryForList("SELECT substr(qualified_name,1,1000) FROM symbol_versions WHERE snapshot_id=? AND kind='PACKAGE' ORDER BY qualified_name,id LIMIT ?", String.class, snapshot, rowsLimit + 1);
        metrics.rowsLoaded(packages.size());
        boolean packageOmitted = packages.size() > rowsLimit;
        writer.add("ev-packages", "Bounded package inventory", String.join("\n", packages.stream().limit(rowsLimit).toList()), 1000, limits.getSourceChars());
        omissions.add(new Omission("packages", Math.min(rowsLimit, packages.size()), packageOmitted ? 1 : 0, packageOmitted));

        if (!room(writer, omissions, "type inventory")) return;
        var types = db.queryForList("SELECT substr(qualified_name,1,1000) AS qualified_name,substr(COALESCE(roles,'[]'),1,1000) AS roles FROM symbol_versions WHERE snapshot_id=? AND kind IN ('CLASS','INTERFACE','ENUM','RECORD','ANNOTATION') ORDER BY qualified_name,id LIMIT ?", snapshot, rowsLimit + 1);
        metrics.rowsLoaded(types.size());
        boolean typeOmitted = types.size() > rowsLimit;
        writer.add("ev-types", "Bounded type and static-role inventory", lines(types.stream().limit(rowsLimit).toList()), 1000, limits.getSourceChars());
        omissions.add(new Omission("types", Math.min(rowsLimit, types.size()), typeOmitted ? 1 : 0, typeOmitted));

        if (!room(writer, omissions, "HTTP routes")) return;
        var routes = db.queryForList("""
            SELECT hr.http_method,hr.path,s.qualified_name FROM http_routes hr JOIN symbol_versions s ON s.id=hr.symbol_version_id
            WHERE hr.snapshot_id=? AND (s.id=? OR s.parent_symbol_id=?) ORDER BY hr.path,s.qualified_name,hr.id LIMIT ?
            """, snapshot, symbol, parent, limits.getEvidenceOccurrences() + 1);
        metrics.rowsLoaded(routes.size());
        addRows(writer, omissions, "HTTP routes", "ev-route-", routes, limits.getEvidenceOccurrences());

        if (!room(writer, omissions, "dependency injections")) return;
        var injections = db.queryForList("""
            SELECT target_type_name,injection_kind,resolution FROM injection_points
            WHERE snapshot_id=? AND (source_symbol_id=? OR source_symbol_id=?) ORDER BY target_type_name,id LIMIT ?
            """, snapshot, symbol, parent, limits.getEvidenceOccurrences() + 1);
        metrics.rowsLoaded(injections.size());
        addRows(writer, omissions, "dependency injections", "ev-inj-", injections, limits.getEvidenceOccurrences());

        if (!room(writer, omissions, "project documents")) return;
        int docLimit = limits.getProjectDocuments();
        var docs = db.queryForList("SELECT id,substr(title,1,160) AS title,revision FROM project_documents WHERE workspace_id=? ORDER BY id LIMIT ?", workspace, docLimit + 1);
        metrics.rowsLoaded(docs.size());
        boolean docsOmitted = docs.size() > docLimit;
        int allowance = Math.max(200, writer.remaining() / 6 / Math.max(1, Math.min(docLimit, docs.size())));
        int included = 0;
        for (int i = 0; i < Math.min(docLimit, docs.size()); i++) {
            if (writer.remaining() < 200) break;
            var doc = docs.get(i);
            String content = db.queryForObject("SELECT substr(content,1,?) FROM project_documents WHERE id=?", String.class, limits.getSourceChars(), doc.get("id"));
            if (writer.add("doc-" + doc.get("id") + "-r" + doc.get("revision"), "User document: " + doc.get("title") + " (untrusted assertions, not parser facts)",
                content, allowance, limits.getSourceChars())) included++;
        }
        int observedOmitted = Math.max(0, docs.size() - included);
        omissions.add(new Omission("project documents", included, observedOmitted, docsOmitted || observedOmitted > 0));
    }

    private void addRows(Budget writer, List<Omission> omissions, String category, String prefix,
                         List<Map<String, Object>> rows, int limit) {
        boolean omitted = rows.size() > limit;
        for (int i = 0; i < Math.min(limit, rows.size()); i++) writer.add(prefix + (i + 1), category, rows.get(i).toString(), 500, 4000);
        omissions.add(new Omission(category, Math.min(limit, rows.size()), omitted ? 1 : 0, omitted));
    }

    private void appendLimits(StringBuilder out, List<EvidenceItem> evidence, List<Omission> omissions) {
        var material = omissions.stream().filter(o -> o.omitted() > 0 || o.truncated()).toList();
        String detail = material.stream().map(o -> o.category() + " included=" + o.included()
            + (o.omitted() > 0 ? " omitted-at-least=" + o.omitted() : "") + (o.truncated() ? " truncated" : "")).toList().toString();
        String content = (material.isEmpty() ? "No selected block reached a hard row/character limit. " : detail + ". ")
            + "The inventory and related evidence are selected slices, not complete source coverage. Do not imply omitted facts are absent; runtime behavior and missing classpaths remain uncertain.";
        out.append("\n[context-limits] BOUNDED EVIDENCE RECORD: ").append(content).append('\n');
        evidence.add(new EvidenceItem("context-limits", "Bounded evidence omissions", content));
    }

    private boolean room(Budget writer, List<Omission> omissions, String category) {
        if (writer.remaining() >= 200) return true;
        omissions.add(new Omission(category, 0, 1, false));
        return false;
    }

    public PriorExplanation priorExplanation(String snapshot, String symbol) { return priorExplanation(snapshot, symbol, false); }

    private PriorExplanation priorExplanation(String snapshot, String symbol, boolean preferDraft) {
        String kind = preferDraft ? "pre" : "full";
        var rows = generatedRow(snapshot, symbol, kind);
        if (rows.isEmpty()) { kind = preferDraft ? "full" : "pre"; rows = generatedRow(snapshot, symbol, kind); }
        if (rows.isEmpty()) return null;
        var row = rows.get(0);
        String content = kind.equals("full")
            ? "Full explanation (READY; generated interpretation): " + row.get("short_label") + "\n" + row.get("hover_summary")
                + "\nClaims (citations belong to its original context): " + row.get("claims") + "\nUnknowns: " + row.get("unknowns")
            : "Architectural pre-explanation (DRAFT; inferred purpose): " + row.get("business_logic");
        content += "\nProvenance: " + row.get("model_id") + "; prompt " + row.get("prompt_version") + "; input " + row.get("input_fingerprint");
        return new PriorExplanation(new ContextDependency(symbol, kind, digest(row.toString())), content);
    }

    private List<Map<String, Object>> generatedRow(String snapshot, String symbol, String kind) {
        int chars = properties.getExplanations().getExplanationChars();
        var rows = db.queryForList(kind.equals("full") ? """
            SELECT id,substr(COALESCE(short_label,''),1,?) AS short_label,substr(COALESCE(hover_summary,''),1,?) AS hover_summary,
                   substr(COALESCE(claims,'[]'),1,?) AS claims,substr(COALESCE(unknowns,'[]'),1,?) AS unknowns,
                   model_id,prompt_version,input_fingerprint
            FROM explanations WHERE snapshot_id=? AND subject_version_id=? AND subject_type='symbol' AND status='READY'
            ORDER BY updated_at DESC,id LIMIT 1
            """ : """
            SELECT substr(p.business_logic,1,?) AS business_logic,a.id,a.model_id,a.prompt_version,a.input_fingerprint
            FROM class_pre_explanations p JOIN explanation_syntheses a ON a.id=p.synthesis_id
            WHERE a.snapshot_id=? AND p.symbol_id=? AND a.status='READY' LIMIT 1
            """, kind.equals("full") ? new Object[]{chars, chars, chars, chars, snapshot, symbol} : new Object[]{chars, snapshot, symbol});
        metrics.rowsLoaded(rows.size());
        return rows;
    }

    public boolean dependenciesFresh(String snapshot, List<ContextDependency> dependencies) {
        for (var input : dependencies) {
            var rows = generatedRow(snapshot, input.symbolId(), input.kind());
            if (rows.isEmpty() || !digest(rows.get(0).toString()).equals(input.version())) return false;
        }
        return true;
    }

    private String source(String snapshot, String id, String hash, int maxChars) {
        var exact = db.queryForList("""
            SELECT substr(COALESCE(e.snippet,''),1,?) FROM symbol_evidence se JOIN evidence e ON e.id=se.evidence_id
            JOIN source_file_versions f ON f.id=e.source_file_version_id
            WHERE se.symbol_version_id=? AND f.snapshot_id=? ORDER BY e.start_line,e.start_column,e.id LIMIT 1
            """, String.class, maxChars, id, snapshot);
        metrics.rowsLoaded(exact.size());
        if (!exact.isEmpty()) return exact.get(0);
        var files = db.queryForList("SELECT substr(source_content,1,?) FROM source_file_versions WHERE snapshot_id=? AND content_hash=? ORDER BY relative_path LIMIT 1", String.class, maxChars, snapshot, hash);
        metrics.rowsLoaded(files.size());
        return files.isEmpty() ? "Source unavailable; re-index for exact evidence." : "Legacy index: bounded enclosing file; declaration span unavailable.\n" + files.get(0);
    }

    private String lines(List<Map<String, Object>> rows) {
        StringBuilder value = new StringBuilder();
        for (var row : rows) value.append(row).append('\n');
        return value.toString();
    }

    private List<String> strings(Object value) {
        try { return value == null ? List.of() : json.readValue(value.toString(), json.getTypeFactory().constructCollectionType(List.class, String.class)); }
        catch (Exception e) { return List.of(); }
    }

    private String limitIdentity() {
        var l = properties.getExplanations();
        return l.getArchitecturePageRows() + "|" + l.getArchitectureDocumentChars() + "|" + l.getArchitectureSummaryFanIn()
            + "|" + l.getArchitectureClassBatch() + "|" + l.getClassNeighborRows() + "|" + l.getExplanationChars();
    }

    private String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static final class Budget {
        private final StringBuilder out;
        private final List<EvidenceItem> evidence;
        private final List<Omission> omissions;
        private int remaining;

        Budget(StringBuilder out, List<EvidenceItem> evidence, List<Omission> omissions, int budget) {
            this.out = out; this.evidence = evidence; this.omissions = omissions; this.remaining = budget;
        }
        int remaining() { return remaining; }
        boolean add(String id, String label, String content, int tokenAllowance, int charAllowance) {
            if (content == null || content.isBlank()) return false;
            String header = "\n[" + id + "] " + label + ":\n";
            int limit = Math.min(tokenAllowance, remaining - ModelRequestBudget.estimate(header) - 40);
            if (limit < 80) { omissions.add(new Omission(label, 0, 1, false)); return false; }
            boolean truncated = content.length() > charAllowance || ModelRequestBudget.estimate(content) > limit;
            String actual = content.length() > charAllowance ? content.substring(0, safeEnd(content, charAllowance)) : content;
            if (ModelRequestBudget.estimate(actual) > limit) actual = ModelRequestBudget.prefix(actual, limit);
            if (truncated) { actual += "\n[Context shortened]"; omissions.add(new Omission(label, 1, 0, true)); }
            out.append(header).append(actual).append('\n');
            remaining -= ModelRequestBudget.estimate(header) + ModelRequestBudget.estimate(actual) + 1;
            evidence.add(new EvidenceItem(id, label, actual));
            return true;
        }
        private static int safeEnd(String value, int max) {
            int end = Math.min(value.length(), max);
            if (end > 0 && end < value.length() && Character.isHighSurrogate(value.charAt(end - 1))) end--;
            return end;
        }
    }
}
