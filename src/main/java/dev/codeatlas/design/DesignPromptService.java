package dev.codeatlas.design;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * The design "prompt" (ADR 0015): a work order for an AI coding agent, rendered from the design layer
 * only. Unlike the design brief (ADR 0014) it carries no parsed dependency dump and no import block:
 * it lists what the engineer designed (planned resources, intentions on any resource, designed
 * relations) with just enough parsed context to find each item (key, kind, parent chain, signature),
 * states what a designed relation asks for, and ends with how to report back through the change-set API.
 *
 * Always the whole workspace: a designed item outside the tab's scope is still work.
 */
@Service
public class DesignPromptService {
    private final JdbcTemplate db;
    private final DesignService design;

    public DesignPromptService(JdbcTemplate db, DesignService design) {
        this.db = db;
        this.design = design;
    }

    /** What a designed relation of each kind asks the source to do to the target. */
    static String ask(String kind) {
        return switch (kind) {
            case "CALLS" -> "call";
            case "DEPENDS_ON" -> "depend on";
            case "USES_TYPE" -> "use the type";
            case "INJECTS" -> "have injected";
            case "CONSTRUCTS" -> "construct (instantiate)";
            case "EXTENDS" -> "extend";
            case "IMPLEMENTS" -> "implement";
            case "OVERRIDES" -> "override";
            case "READS_FIELD" -> "read a field of";
            case "WRITES_FIELD" -> "write a field of";
            case "DECLARES_BEAN" -> "declare as a bean";
            case "HANDLES_ROUTE" -> "handle the route of";
            default -> kind.toLowerCase(Locale.ROOT).replace('_', ' ');
        };
    }

    public String render(String workspaceId) {
        design.requireWorkspace(workspaceId);
        var workspace = db.queryForMap("SELECT display_name, active_snapshot_id FROM workspaces WHERE id = ?", workspaceId);
        String snapshot = (String) workspace.get("active_snapshot_id");
        DesignService.Overlay overlay = design.overlay(workspaceId, null);
        DesignService.CodeIndex code = design.codeIndex(snapshot);
        Map<String, DesignService.ResourceView> designed = new HashMap<>();
        for (var r : overlay.resources()) designed.put(r.key(), r);
        Map<String, String> signatures = parsedSignatures(snapshot);

        StringBuilder md = new StringBuilder();
        md.append("# Implement the engineer's design: ").append(inline(String.valueOf(workspace.get("display_name")))).append("\n\n");
        md.append("""
            You are working in a Java codebase. The software engineer designed changes on a map of it in Code Atlas.
            This prompt lists **only what they designed**; read the source for everything else.

            - **Keys** are the static analyzer's qualified names: package `com.acme.billing`, type
              `com.acme.billing.InvoiceService`, method `com.acme.billing.InvoiceService.issue(OrderId,boolean)`
              (parameter types as written in source).
            - Each item's **intention** (the quoted text; its first paragraph is the intent) is a requirement to
              implement. An intention on code that already exists is a **requested behaviour change**.
            - The source code is the authority on what exists. Intentions are the engineer's requirements, not facts
              about the code; where they conflict with the code, change the code, and say so when you report back.

            """);

        var planned = overlay.resources().stream().filter(r -> "AUTHORED".equals(r.origin()) && "PLANNED".equals(r.status())).toList();
        var changes = overlay.resources().stream().filter(r -> "CODE".equals(r.origin()) && "PRESENT".equals(r.status()) && !blank(r.explanation())).toList();
        var relations = overlay.relations().stream().filter(r -> "PLANNED".equals(r.status())).toList();
        var implemented = overlay.resources().stream().filter(r -> "IMPLEMENTED".equals(r.status())).toList();
        var implementedRelations = overlay.relations().stream().filter(r -> "IMPLEMENTED".equals(r.status())).toList();
        var attention = overlay.resources().stream().filter(r -> "ORPHANED".equals(r.status()) || "MISSING".equals(r.status())).toList();
        var attentionRelations = overlay.relations().stream().filter(r -> "ORPHANED".equals(r.status())).toList();
        if (planned.isEmpty() && changes.isEmpty() && relations.isEmpty() && implemented.isEmpty() && implementedRelations.isEmpty()
            && attention.isEmpty() && attentionRelations.isEmpty()) {
            md.append("Nothing is designed in this workspace yet.\n");
            return md.toString();
        }

        int section = 0;
        if (!planned.isEmpty()) {
            md.append("## ").append(++section).append(". Build: designed, not in the code yet\n\n");
            md.append("Create each of these with exactly this key, inside its parent.\n\n");
            for (var r : planned) resource(md, r, designed, code, signatures);
        }
        if (!changes.isEmpty()) {
            md.append("## ").append(++section).append(". Change existing code\n\n");
            md.append("These already exist. Make their behaviour match the intention.\n\n");
            for (var r : changes) resource(md, r, designed, code, signatures);
        }
        if (!relations.isEmpty()) {
            md.append("## ").append(++section).append(". Relations to implement\n\n");
            md.append("A designed relation `A -KIND-> B` means: the engineer wants A, or code inside A, to do KIND to B or to a ")
              .append("resource inside B, for the reason given. Implement each relation in your change.\n\n");
            for (var r : relations) relation(md, r, designed, code);
        }
        if (!implemented.isEmpty() || !implementedRelations.isEmpty()) {
            md.append("## ").append(++section).append(". Already implemented: verify\n\n");
            md.append("The code already declares these. Check each still matches its intention, and change the code where it does not.\n\n");
            for (var r : implemented) resource(md, r, designed, code, signatures);
            for (var r : implementedRelations) relation(md, r, designed, code);
        }
        if (!attention.isEmpty() || !attentionRelations.isEmpty()) {
            md.append("## ").append(++section).append(". Needs attention\n\n");
            md.append("Not actionable as designed. Do not invent these; mention them when you report back.\n\n");
            for (var r : attention) md.append("- ").append(kindWord(r.kind())).append(" `").append(inline(r.key())).append("`: ")
                .append("ORPHANED".equals(r.status()) ? "its parent no longer exists" : "referenced, but not found in this code").append("\n");
            for (var r : attentionRelations) md.append("- relation `").append(inline(r.sourceKey())).append("` -").append(r.kind()).append("-> `")
                .append(inline(r.targetKey())).append("`: an endpoint no longer exists\n");
            md.append("\n");
        }
        md.append(AgentGuide.reportBack(workspaceId));
        return md.toString();
    }

    private void resource(StringBuilder md, DesignService.ResourceView r, Map<String, DesignService.ResourceView> designed,
                          DesignService.CodeIndex code, Map<String, String> signatures) {
        md.append("- ").append(kindWord(r.kind())).append(" `").append(inline(r.key())).append("`");
        String parents = chain(r.parentKey(), designed, code);
        if (!parents.isEmpty()) md.append(" in ").append(parents);
        String signature = r.signature() != null ? r.signature() : r.codeId() == null ? null : signatures.get(r.codeId());
        if (signature != null && !signature.isBlank()) md.append("\n  Signature: `").append(inline(signature)).append("`");
        md.append("\n");
        if (blank(r.explanation())) md.append("  (no intention written)\n");
        else quote(md, r.explanation());
    }

    private void relation(StringBuilder md, DesignService.RelationView r, Map<String, DesignService.ResourceView> designed, DesignService.CodeIndex code) {
        String source = r.sourceKey(), target = r.targetKey();
        md.append("- `").append(inline(source)).append("` -").append(r.kind()).append("-> `").append(inline(target)).append("`\n");
        md.append("  The engineer wants ").append(endpoint(source, designed, code)).append(" `").append(inline(source)).append("` (or code inside it) to ")
          .append(ask(r.kind())).append(" ").append(endpoint(target, designed, code)).append(" `").append(inline(target)).append("`");
        if (!isMember(kindOf(target, designed, code))) md.append(" or a resource inside it");
        md.append(blank(r.explanation()) ? ". No reason was written." : ", because:").append("\n");
        if (!blank(r.explanation())) quote(md, r.explanation());
    }

    /** "the existing class" / "the planned method": where an endpoint stands. */
    private static String endpoint(String key, Map<String, DesignService.ResourceView> designed, DesignService.CodeIndex code) {
        String kind = kindOf(key, designed, code);
        String word = kind == null ? "resource" : kindWord(kind);
        return (code.get(key) != null ? "the existing " : designed.containsKey(key) ? "the planned " : "the unknown ") + word;
    }

    private static String kindOf(String key, Map<String, DesignService.ResourceView> designed, DesignService.CodeIndex code) {
        var s = code.get(key);
        if (s != null) return s.kind();
        var r = designed.get(key);
        return r == null ? null : r.kind();
    }

    /** Parent chain from the outermost resource: "package `a.b` › class `a.b.C`". Each link says whether it exists yet. */
    private static String chain(String parentKey, Map<String, DesignService.ResourceView> designed, DesignService.CodeIndex code) {
        List<String> links = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String key = parentKey; key != null && seen.add(key); ) {
            var s = code.get(key);
            var r = designed.get(key);
            String kind = s != null ? s.kind() : r != null ? r.kind() : null;
            links.add((kind == null ? "" : kindWord(kind) + " ") + "`" + inline(key) + "`" + (s != null ? "" : r != null ? " (planned)" : " (unknown)"));
            key = s != null ? code.parentKey(s) : r != null ? r.parentKey() : null;
        }
        Collections.reverse(links);
        return String.join(" › ", links);
    }

    private Map<String, String> parsedSignatures(String snapshot) {
        Map<String, String> out = new HashMap<>();
        if (snapshot == null) return out;
        db.query("SELECT id, signature FROM symbol_versions WHERE snapshot_id = ? AND signature IS NOT NULL AND kind IN ('METHOD','CONSTRUCTOR')",
            rs -> { out.put(rs.getString("id"), rs.getString("signature")); }, snapshot);
        return out;
    }

    private static boolean isMember(String kind) { return "METHOD".equals(kind) || "CONSTRUCTOR".equals(kind); }
    private static String kindWord(String kind) { return kind.toLowerCase(Locale.ROOT); }
    private static boolean blank(String s) { return s == null || s.isBlank(); }
    private static String inline(String s) { return s == null ? "" : s.replace("`", "'").replace("\n", " "); }
    private static void quote(StringBuilder md, String text) {
        for (String line : text.strip().split("\\R", -1)) md.append("  > ").append(line).append("\n");
    }
}
