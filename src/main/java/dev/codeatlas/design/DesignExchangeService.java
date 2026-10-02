package dev.codeatlas.design;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Export and import of the map as one Markdown "design brief": prose an AI agent can read cold
 * (reading contract, module tree with explanations, relations, the API guide) followed by a fenced
 * {@code json codeatlas-design} block that import parses to rebuild the same map. Import reads only
 * that block, validates it strictly, upserts by key and never deletes.
 */
@Service
public class DesignExchangeService {
    public static final String FORMAT = "codeatlas-design";
    static final int MAX_PARSED_RESOURCES = 4_000, MAX_PARSED_RELATIONS = 8_000, MAX_LAYOUT_CHARS = 2_000_000, MAX_IMPORT_CHARS = 8_000_000;
    private static final Pattern FENCE_OPEN = Pattern.compile("(?m)^(`{3,})json[ \\t]+" + FORMAT + "[ \\t]*$");

    private final JdbcTemplate db;
    private final DesignService design;
    private final TransactionTemplate transactions;
    private final ObjectMapper json = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);

    public DesignExchangeService(JdbcTemplate db, DesignService design, PlatformTransactionManager transactionManager) {
        this.db = db;
        this.design = design;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /** Scope by stable keys; null or mode ALL exports the whole snapshot. */
    public record Scope(String mode, List<String> packageKeys, List<String> classKeys) {}
    public record ExportRequest(Scope scope, JsonNode layout) {}
    public record ImportRequest(String content, String author) {}
    public record ImportResult(String schemaVersion, int resourcesCreated, int resourcesUpdated, int relationsCreated, int relationsUpdated,
                               int placeholders, List<String> warnings, JsonNode layout, String sourceWorkspace) {}

    // ------------------------------------------------------------------ export

    public String export(String workspaceId, ExportRequest request) {
        design.requireWorkspace(workspaceId);
        if (request != null && request.layout() != null && request.layout().toString().length() > MAX_LAYOUT_CHARS)
            throw new IllegalArgumentException("Layout exceeds " + MAX_LAYOUT_CHARS + " characters");
        var workspace = db.queryForMap("SELECT id, canonical_root, display_name, language, active_snapshot_id FROM workspaces WHERE id = ?", workspaceId);
        String snapshot = (String) workspace.get("active_snapshot_id");
        DesignService.CodeIndex code = design.codeIndex(snapshot);
        Scope scope = request == null || request.scope() == null ? new Scope("ALL", List.of(), List.of()) : request.scope();
        boolean all = scope.mode() == null || "ALL".equalsIgnoreCase(scope.mode());

        // Parsed resources in scope (packages, types, members), never fields and never source code.
        Set<String> pkgScope = new HashSet<>(Optional.ofNullable(scope.packageKeys()).orElse(List.of()));
        Set<String> classScope = new HashSet<>(Optional.ofNullable(scope.classKeys()).orElse(List.of()));
        List<DesignService.CodeSymbol> parsed = new ArrayList<>();
        for (var s : code.byId().values()) {
            if (!DesignKeys.isResourceKind(s.kind())) continue;
            if (all || inScope(s, code, pkgScope, classScope)) parsed.add(s);
        }
        parsed.sort(Comparator.comparing(DesignService.CodeSymbol::key));
        int omittedResources = Math.max(0, parsed.size() - MAX_PARSED_RESOURCES);
        if (omittedResources > 0) parsed = new ArrayList<>(parsed.subList(0, MAX_PARSED_RESOURCES));

        Map<String, String> generated = new HashMap<>();
        if (snapshot != null) db.query("SELECT sv.qualified_name, substr(e.hover_summary, 1, 600) AS summary FROM explanations e JOIN symbol_versions sv ON sv.id = e.subject_version_id WHERE e.snapshot_id = ? AND e.subject_type = 'symbol' AND e.status = 'READY' AND e.hover_summary IS NOT NULL",
            rs -> { generated.putIfAbsent(rs.getString(1), rs.getString(2)); }, snapshot);

        var overlay = design.overlay(workspaceId, snapshot);
        Map<String, DesignService.ResourceView> designByKey = new LinkedHashMap<>();
        for (var r : overlay.resources()) designByKey.put(r.key(), r);

        // Spring roles of parsed resources, so an import elsewhere draws each card like the original (ADR 0016).
        Map<String, String> roles = new HashMap<>();
        if (snapshot != null) db.query("SELECT id, roles FROM symbol_versions WHERE snapshot_id = ? AND roles IS NOT NULL AND roles NOT IN ('', '[]')",
            rs -> { roles.put(rs.getString(1), rs.getString(2)); }, snapshot);

        // Resource entries: every parsed one in scope (with its design explanation, if any), then every design row.
        Map<String, ObjectNode> resources = new LinkedHashMap<>();
        for (var s : parsed) {
            ObjectNode n = json.createObjectNode();
            n.put("key", s.key()).put("kind", s.kind()).put("name", s.simpleName());
            String parentKey = code.parentKey(s);
            if (parentKey != null) n.put("parentKey", parentKey);
            n.put("origin", "CODE").put("status", "PRESENT");
            List<String> parsedRoles = design.params(roles.get(s.id()));
            if (parsedRoles != null && !parsedRoles.isEmpty()) n.set("roles", json.valueToTree(parsedRoles));
            if (generated.containsKey(s.key())) n.put("generatedSummary", generated.get(s.key()));
            resources.put(s.key(), n);
        }
        for (var r : overlay.resources()) {
            ObjectNode n = resources.computeIfAbsent(r.key(), k -> json.createObjectNode());
            n.put("key", r.key()).put("kind", r.kind()).put("name", r.name());
            if (r.parentKey() != null) n.put("parentKey", r.parentKey());
            if (r.parameterTypes() != null) n.set("parameterTypes", json.valueToTree(r.parameterTypes()));
            if (r.signature() != null) n.put("signature", r.signature());
            if (r.roles() != null && !r.roles().isEmpty() && !n.has("roles")) n.set("roles", json.valueToTree(r.roles()));
            n.put("origin", r.origin()).put("status", r.status());
            if (!r.explanation().isEmpty()) n.put("explanation", r.explanation());
            n.put("createdBy", r.createdBy()).put("updatedBy", r.updatedBy()).put("updatedAt", r.updatedAt());
        }

        // Parsed relations among exported parsed resources, aggregated per (source, target, kind).
        Set<String> exportedParsed = new HashSet<>();
        for (var s : parsed) exportedParsed.add(s.id());
        Map<String, ObjectNode> relations = new LinkedHashMap<>();
        int[] omittedRelations = {0};
        if (snapshot != null) db.query("SELECT source_symbol_id, target_symbol_id, kind, resolution FROM relationship_occurrences WHERE snapshot_id = ? AND target_symbol_id IS NOT NULL ORDER BY kind", rs -> {
            String sid = rs.getString(1), tid = rs.getString(2);
            if (!exportedParsed.contains(sid) || !exportedParsed.contains(tid)) return;
            String source = code.byId().get(sid).key(), target = code.byId().get(tid).key(), kind = rs.getString(3);
            String id = DesignService.relationIdentity(source, target, kind);
            ObjectNode n = relations.get(id);
            if (n == null) {
                if (relations.size() >= MAX_PARSED_RELATIONS) { omittedRelations[0]++; return; }
                n = json.createObjectNode();
                n.put("sourceKey", source).put("targetKey", target).put("kind", kind).put("layer", "CODE").put("resolution", rs.getString(4)).put("occurrences", 0);
                relations.put(id, n);
            }
            n.put("occurrences", n.get("occurrences").asInt() + 1);
            n.put("resolution", worse(n.get("resolution").asText(), rs.getString(4)));
        }, snapshot);
        for (var r : overlay.relations()) {
            String id = DesignService.relationIdentity(r.sourceKey(), r.targetKey(), r.kind());
            ObjectNode n = json.createObjectNode();
            boolean carried = "CODE".equals(r.origin());
            ObjectNode parsedTwin = relations.get(id);
            n.put("sourceKey", r.sourceKey()).put("targetKey", r.targetKey()).put("kind", r.kind()).put("layer", carried ? "CODE" : "DESIGN")
                .put("resolution", carried ? (parsedTwin != null ? parsedTwin.get("resolution").asText() : "CODE") : "DESIGNED").put("status", r.status());
            if (!r.explanation().isEmpty()) n.put("explanation", r.explanation());
            n.put("createdBy", r.createdBy()).put("updatedBy", r.updatedBy()).put("updatedAt", r.updatedAt());
            if (parsedTwin != null) n.put("occurrences", parsedTwin.get("occurrences").asInt());
            relations.put(id, n);
        }

        ObjectNode doc = json.createObjectNode();
        doc.put("format", FORMAT).put("schemaVersion", DesignService.SCHEMA_VERSION).put("exportedAt", Instant.now().toString());
        ObjectNode ws = doc.putObject("workspace");
        ws.put("id", workspaceId).put("name", (String) workspace.get("display_name")).put("path", (String) workspace.get("canonical_root"))
            .put("language", (String) workspace.get("language"));
        if (snapshot != null) ws.put("snapshotId", snapshot);
        ObjectNode scopeNode = doc.putObject("scope");
        scopeNode.put("mode", all ? "ALL" : "CUSTOM");
        scopeNode.set("packageKeys", json.valueToTree(new TreeSet<>(pkgScope)));
        scopeNode.set("classKeys", json.valueToTree(new TreeSet<>(classScope)));
        ArrayNode resourceArray = doc.putArray("resources");
        resources.values().forEach(resourceArray::add);
        ArrayNode relationArray = doc.putArray("relations");
        relations.values().forEach(relationArray::add);
        doc.set("layout", request == null || request.layout() == null ? null : request.layout());
        doc.putObject("omitted").put("parsedResources", omittedResources).put("parsedRelations", omittedRelations[0]);
        return renderMarkdown(doc, workspaceId);
    }

    private static boolean inScope(DesignService.CodeSymbol s, DesignService.CodeIndex code, Set<String> packages, Set<String> classes) {
        if ("PACKAGE".equals(s.kind())) {
            if (packages.contains(s.key())) return true;
            // A package is drawn when any selected class sits in it.
            for (String c : classes) { var cs = code.get(c); if (cs != null && s.key().equals(packageOf(cs, code))) return true; }
            return false;
        }
        Set<String> seen = new HashSet<>();
        for (var c = s; c != null && seen.add(c.id()); c = c.parentId() == null ? null : code.byId().get(c.parentId())) {
            if (classes.contains(c.key()) || packages.contains(c.key())) return true;
        }
        return false;
    }

    private static String packageOf(DesignService.CodeSymbol s, DesignService.CodeIndex code) {
        Set<String> seen = new HashSet<>();
        for (var c = s; c != null && seen.add(c.id()); c = c.parentId() == null ? null : code.byId().get(c.parentId()))
            if ("PACKAGE".equals(c.kind())) return c.key();
        return null;
    }

    private static String worse(String a, String b) {
        List<String> order = List.of("RESOLVED", "CANDIDATE", "UNRESOLVED");
        return order.indexOf(b) > order.indexOf(a) ? b : a;
    }

    // ------------------------------------------------------------------ Markdown rendering

    String renderMarkdown(ObjectNode doc, String workspaceId) {
        StringBuilder md = new StringBuilder();
        JsonNode ws = doc.get("workspace");
        md.append("# Design brief: ").append(inline(ws.path("name").asText("workspace"))).append("\n\n");
        md.append("Exported from Code Atlas on ").append(doc.get("exportedAt").asText()).append(" (format `").append(FORMAT).append("` v")
            .append(DesignService.SCHEMA_VERSION).append("). Language: ").append(ws.path("language").asText("java"))
            .append(". Scope: ").append("ALL".equals(doc.path("scope").path("mode").asText()) ? "whole system" : "selected packages/classes")
            .append(".\n\n");

        md.append("""
            ## How to read this brief

            This brief describes a software system as a map with two layers:

            1. **Code facts** (`origin: CODE`) are packages, types and methods found by static analysis of the
               current source, and the dependencies between them (`layer: CODE`, with resolution `RESOLVED`,
               `CANDIDATE` or `UNRESOLVED` and an occurrence count). They describe what the code *is*.
            2. **The design layer** is what the software engineer (or an AI agent working for them) *intends*:
               resources added to the map (`origin: AUTHORED`), relations added between any two resources
               (`layer: DESIGN`, resolution `DESIGNED`), and explanations attached to any element.

            Every **explanation** leads with **intent**: its first paragraph states what the element is for and
            why it exists. Later paragraphs give design rationale, constraints, contracts and any intended change
            to existing code. Treat explanations as the engineer's requirements and design decisions. Where an
            explanation contradicts the code facts, the code is what exists today and the explanation is the
            target. `generatedSummary` is text written by a local language model about existing code: a hint,
            not a requirement.

            **Status** compares the design with the latest analysis: `PLANNED` (designed, not in the code yet),
            `IMPLEMENTED` (designed and now present in the code), `PRESENT` (existing code), `MISSING`
            (referenced, but not found in the code) and `ORPHANED` (its parent or an endpoint no longer exists).

            Resources are identified by **key**, the fully qualified name: `com.acme.billing` (package),
            `com.acme.billing.InvoiceService` (type), `com.acme.billing.InvoiceService.issue(OrderId)` (method).

            """);

        // Summary counts.
        Map<String, Integer> counts = new TreeMap<>();
        for (JsonNode r : doc.get("resources")) counts.merge(r.get("status").asText(), 1, Integer::sum);
        int designRelations = 0, codeRelations = 0;
        for (JsonNode r : doc.get("relations")) if ("DESIGN".equals(r.get("layer").asText())) designRelations++; else codeRelations++;
        md.append("## Summary\n\n");
        md.append("- Resources: ").append(doc.get("resources").size()).append(" (");
        md.append(String.join(", ", counts.entrySet().stream().map(e -> e.getValue() + " " + e.getKey().toLowerCase()).toList())).append(")\n");
        md.append("- Relations: ").append(codeRelations).append(" from code, ").append(designRelations).append(" designed\n");
        JsonNode omitted = doc.get("omitted");
        if (omitted.get("parsedResources").asInt() > 0 || omitted.get("parsedRelations").asInt() > 0)
            md.append("- Omitted for size: ").append(omitted.get("parsedResources").asInt()).append(" parsed resources, ")
              .append(omitted.get("parsedRelations").asInt()).append(" parsed relations (export a narrower scope to include them)\n");
        md.append("\n");

        // Module structure.
        Map<String, List<JsonNode>> children = new HashMap<>();
        Set<String> keys = new HashSet<>();
        for (JsonNode r : doc.get("resources")) keys.add(r.get("key").asText());
        List<JsonNode> roots = new ArrayList<>();
        for (JsonNode r : doc.get("resources")) {
            String parent = r.path("parentKey").asText(null);
            if (parent != null && keys.contains(parent)) children.computeIfAbsent(parent, k -> new ArrayList<>()).add(r);
            else roots.add(r);
        }
        md.append("## Module structure\n\n");
        roots.sort(Comparator.comparing(r -> r.get("key").asText()));
        for (JsonNode root : roots) renderResource(md, root, children, 0);

        // Relations: designed first, then code facts grouped by source.
        md.append("\n## Relations\n\n");
        List<JsonNode> designed = new ArrayList<>(), facts = new ArrayList<>();
        for (JsonNode r : doc.get("relations")) ("DESIGN".equals(r.get("layer").asText()) ? designed : facts).add(r);
        md.append("### Designed relations\n\n");
        if (designed.isEmpty()) md.append("None.\n");
        for (JsonNode r : designed) {
            md.append("- `").append(inline(r.get("sourceKey").asText())).append("` **").append(verb(r.get("kind").asText())).append("** `")
              .append(inline(r.get("targetKey").asText())).append("` · ").append(r.get("status").asText().toLowerCase());
            if (r.has("occurrences")) md.append(" · ").append(r.get("occurrences").asInt()).append(" occurrence(s) in code");
            md.append(" · by ").append(inline(r.path("updatedBy").asText())).append("\n");
            quote(md, r.path("explanation").asText(""), 1);
        }
        md.append("\n### Dependencies found in the code\n\n");
        if (facts.isEmpty()) md.append("None in scope.\n");
        for (JsonNode r : facts) {
            md.append("- `").append(inline(r.get("sourceKey").asText())).append("` ").append(verb(r.get("kind").asText())).append(" `")
              .append(inline(r.get("targetKey").asText())).append("` (")
              // A carried relation of a design-only project has no occurrences here: it came from another map.
              .append(r.has("occurrences") ? r.get("occurrences").asInt() + "×, " : "imported, ")
              .append(r.get("resolution").asText().toLowerCase()).append(")\n");
            quote(md, r.path("explanation").asText(""), 1);
        }
        md.append("\n").append(AgentGuide.markdown(workspaceId)).append("\n");

        String body;
        try { body = json.writeValueAsString(doc); } catch (Exception e) { throw new IllegalStateException(e); }
        String fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
        md.append("## Machine-readable map\n\n");
        md.append("Code Atlas imports this block to rebuild the same map (resources, relations, explanations and layout). ")
          .append("Agents may read it instead of the prose above; keep it intact when passing the brief on.\n\n");
        md.append(fence).append("json ").append(FORMAT).append("\n").append(body).append("\n").append(fence).append("\n");
        return md.toString();
    }

    private void renderResource(StringBuilder md, JsonNode r, Map<String, List<JsonNode>> children, int depth) {
        String kind = r.get("kind").asText(), key = r.get("key").asText();
        String indent = "  ".repeat(depth);
        String label = "PACKAGE".equals(kind) ? key : DesignKeys.MEMBER_KINDS.contains(kind) ? key.substring(Math.max(0, key.lastIndexOf('.', key.indexOf('(')) + 1)) : r.get("name").asText();
        md.append(indent).append("- **").append(kind.toLowerCase()).append("** `").append(inline(label)).append("` · ")
          .append(r.get("status").asText().toLowerCase());
        if ("AUTHORED".equals(r.get("origin").asText())) md.append(" · designed");
        if (r.has("signature")) md.append(" · `").append(inline(r.get("signature").asText())).append("`");
        if (!"PACKAGE".equals(kind)) md.append(" · key `").append(inline(key)).append("`");
        if (r.has("updatedBy") && r.has("explanation")) md.append(" · by ").append(inline(r.get("updatedBy").asText()));
        md.append("\n");
        quote(md, r.path("explanation").asText(""), depth + 1);
        if (r.has("generatedSummary")) quote(md, "_Generated summary (model, not a requirement):_ " + r.get("generatedSummary").asText(), depth + 1);
        List<JsonNode> kids = new ArrayList<>(children.getOrDefault(key, List.of()));
        kids.sort(Comparator.comparing((JsonNode c) -> DesignService.category(c.get("kind").asText())).thenComparing(c -> c.get("key").asText()));
        for (JsonNode c : kids) renderResource(md, c, children, depth + 1);
    }

    private static void quote(StringBuilder md, String text, int depth) {
        if (text == null || text.isBlank()) return;
        String indent = "  ".repeat(depth);
        for (String line : text.strip().split("\\R", -1)) md.append(indent).append("> ").append(line).append("\n");
    }

    private static String verb(String kind) { return kind.toLowerCase(Locale.ROOT).replace('_', ' '); }
    /** Backticks would end an inline code span early. */
    private static String inline(String s) { return s == null ? "" : s.replace("`", "'").replace("\n", " "); }

    private static int longestBacktickRun(String s) {
        int best = 0, run = 0;
        for (int i = 0; i < s.length(); i++) { if (s.charAt(i) == '`') best = Math.max(best, ++run); else run = 0; }
        return best;
    }

    // ------------------------------------------------------------------ import

    public ImportResult importBrief(String workspaceId, ImportRequest request) {
        design.requireWorkspace(workspaceId);
        if (request == null || request.content() == null || request.content().isBlank()) throw new IllegalArgumentException("Import needs the brief's content");
        if (request.content().length() > MAX_IMPORT_CHARS) throw new IllegalArgumentException("A brief may hold at most " + MAX_IMPORT_CHARS + " characters");
        String author = DesignKeys.author(request.author());
        JsonNode doc = extract(request.content());
        if (!FORMAT.equals(doc.path("format").asText()) || !DesignService.SCHEMA_VERSION.equals(doc.path("schemaVersion").asText()))
            throw new IllegalArgumentException("Unsupported brief: expected format " + FORMAT + " schemaVersion " + DesignService.SCHEMA_VERSION);
        if (!doc.path("resources").isArray() || !doc.path("relations").isArray()) throw new IllegalArgumentException("The brief's map needs resources and relations arrays");
        return transactions.execute(tx -> importDocument(workspaceId, doc, author));
    }

    JsonNode extract(String content) {
        Matcher m = FENCE_OPEN.matcher(content);
        if (!m.find()) throw new IllegalArgumentException("No ```json " + FORMAT + " block found; import accepts briefs exported by Code Atlas");
        String fence = m.group(1);
        int start = content.indexOf('\n', m.end());
        if (start < 0) throw new IllegalArgumentException("The " + FORMAT + " block is empty");
        Matcher close = Pattern.compile("(?m)^" + Pattern.quote(fence) + "[ \\t]*$").matcher(content);
        if (!close.find(start + 1)) throw new IllegalArgumentException("The " + FORMAT + " block is not closed");
        try { return json.readTree(content.substring(start + 1, close.start())); }
        catch (Exception e) { throw new IllegalArgumentException("The " + FORMAT + " block is not valid JSON"); }
    }

    private ImportResult importDocument(String ws, JsonNode doc, String author) {
        DesignService.CodeIndex code = design.codeIndex(design.snapshotFor(ws, null));
        List<String> warnings = new ArrayList<>();
        int[] c = new int[5]; // resources created, updated, relations created, updated, placeholders
        List<JsonNode> resources = new ArrayList<>();
        doc.get("resources").forEach(resources::add);
        // Parents first: packages, then types (outer before nested), then members.
        resources.sort(Comparator.comparing((JsonNode r) -> DesignService.category(r.path("kind").asText()))
            .thenComparing(r -> r.path("key").asText().length()).thenComparing(r -> r.path("key").asText()));
        for (JsonNode r : resources) {
            String key = text(r, "key"), kind = DesignService.upper(text(r, "kind")), origin = text(r, "origin");
            try {
                if (key == null || kind == null) throw new IllegalArgumentException("resource without key or kind");
                if (!DesignKeys.isResourceKind(kind)) throw new IllegalArgumentException("unsupported kind " + kind);
                String explanation = DesignKeys.explanation(text(r, "explanation"));
                String createdBy = safeAuthor(text(r, "createdBy"), author), updatedBy = safeAuthor(text(r, "updatedBy"), author);
                var row = design.designRow(ws, key);
                boolean present = code.get(key) != null;
                if ("AUTHORED".equals(origin)) {
                    String parentKey = text(r, "parentKey");
                    List<String> params = r.has("parameterTypes") ? strings(r.get("parameterTypes")) : null;
                    String built = DesignKeys.key(kind, parentKey, text(r, "name"), params);
                    if (!built.equals(key)) throw new IllegalArgumentException("key does not match kind/parentKey/name/parameterTypes (expected " + built + ")");
                    if (row == null) {
                        design.insertResource(ws, key, kind, text(r, "name").trim(), parentKey, DesignKeys.MEMBER_KINDS.contains(kind) ? DesignService.normalizedParams(params) : null,
                            DesignKeys.signature(text(r, "signature")), "AUTHORED", explanation == null ? "" : explanation, createdBy, updatedBy);
                        c[0]++;
                    } else if (updateImported(row, kind, DesignKeys.signature(text(r, "signature")), explanation, updatedBy)) c[1]++;
                } else if ("CODE".equals(origin)) {
                    boolean hasText = explanation != null && !explanation.isEmpty();
                    if (present && !hasText && row == null) continue; // plain parsed code: already on the target map
                    if (row == null) {
                        var s = code.get(key);
                        design.insertResource(ws, key, s != null ? s.kind() : kind, s != null ? s.simpleName() : Objects.requireNonNullElse(text(r, "name"), DesignKeys.simpleName(key)),
                            s != null ? code.parentKey(s) : text(r, "parentKey"), null, null, "CODE", explanation == null ? "" : explanation, createdBy, updatedBy);
                        // An imported reference keeps the original card's Spring roles, so it looks the same (ADR 0016).
                        if (s == null && r.has("roles") && r.get("roles").isArray() && !r.get("roles").isEmpty())
                            db.update("UPDATE design_resources SET roles = ? WHERE workspace_id = ? AND resource_key = ?", json.valueToTree(strings(r.get("roles"))).toString(), ws, key);
                        c[0]++;
                        if (!present) c[4]++;
                    } else if (hasText && updateImported(row, (String) row.get("kind"), null, explanation, updatedBy)) c[1]++;
                } else {
                    throw new IllegalArgumentException("origin must be AUTHORED or CODE");
                }
                if (explanation != null && !explanation.isEmpty()) design.staleSymbolExplanations(ws, key);
            } catch (IllegalArgumentException e) {
                warnings.add("Resource " + (key == null ? "?" : key) + " skipped: " + e.getMessage());
            }
        }
        for (JsonNode r : doc.get("relations")) {
            String source = text(r, "sourceKey"), target = text(r, "targetKey"), kind = DesignService.upper(text(r, "kind"));
            try {
                if (source == null || target == null || kind == null || !DesignKeys.RELATION_KINDS.contains(kind)) throw new IllegalArgumentException("needs sourceKey, targetKey and a known kind");
                String explanation = DesignKeys.explanation(text(r, "explanation"));
                boolean hasText = explanation != null && !explanation.isEmpty();
                boolean designLayer = "DESIGN".equals(text(r, "layer"));
                // A parsed dependency between two resources the target code has is already drawn; keep only its explanation.
                if (!designLayer && !hasText && code.get(source) != null && code.get(target) != null) continue;
                if (design.designRow(ws, source) == null && code.get(source) == null || design.designRow(ws, target) == null && code.get(target) == null)
                    throw new IllegalArgumentException("an endpoint is not in the imported map or the code");
                var rows = db.queryForList("SELECT id, explanation FROM design_relations WHERE workspace_id = ? AND source_key = ? AND target_key = ? AND kind = ?", ws, source, target, kind);
                if (rows.isEmpty()) {
                    // A parsed dependency is carried along as a CODE relation, drawn like the original and never
                    // prompt work; only a DESIGN-layer relation is design (ADR 0016).
                    design.insertRelation(ws, source, target, kind, explanation == null ? "" : explanation, safeAuthor(text(r, "createdBy"), author), safeAuthor(text(r, "updatedBy"), author),
                        designLayer ? "AUTHORED" : "CODE");
                    c[2]++;
                } else if (hasText && !explanation.equals(rows.get(0).get("explanation"))) {
                    db.update("UPDATE design_relations SET explanation = ?, updated_by = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", explanation, safeAuthor(text(r, "updatedBy"), author), rows.get(0).get("id"));
                    c[3]++;
                }
                if (hasText) design.staleRelationExplanations(ws, source, target, kind);
            } catch (IllegalArgumentException e) {
                warnings.add("Relation " + source + " -" + kind + "-> " + target + " skipped: " + e.getMessage());
            }
        }
        JsonNode layout = doc.get("layout");
        return new ImportResult(DesignService.SCHEMA_VERSION, c[0], c[1], c[2], c[3], c[4], warnings.size() > 200 ? warnings.subList(0, 200) : warnings,
            layout == null || layout.isNull() ? null : layout, doc.path("workspace").path("name").asText(null));
    }

    private boolean updateImported(Map<String, Object> row, String kind, String signature, String explanation, String updatedBy) {
        boolean kindChange = "AUTHORED".equals(row.get("origin")) && !kind.equals(row.get("kind")) && DesignService.category(kind) == DesignService.category((String) row.get("kind"));
        boolean changed = kindChange || signature != null && !signature.equals(row.get("signature"))
            || explanation != null && !explanation.isEmpty() && !explanation.equals(row.get("explanation"));
        if (!changed) return false;
        db.update("UPDATE design_resources SET kind = ?, signature = COALESCE(?, signature), explanation = CASE WHEN ? IS NULL OR ? = '' THEN explanation ELSE ? END, updated_by = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            kindChange ? kind : row.get("kind"), signature, explanation, explanation, explanation, updatedBy, row.get("id"));
        return true;
    }

    private static String safeAuthor(String value, String fallback) {
        try { return value == null ? fallback : DesignKeys.author(value); } catch (IllegalArgumentException e) { return fallback; }
    }
    private static String text(JsonNode n, String field) { JsonNode v = n.get(field); return v == null || v.isNull() ? null : v.asText(); }
    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        if (array != null && array.isArray()) array.forEach(v -> out.add(v.asText()));
        return out;
    }
}
