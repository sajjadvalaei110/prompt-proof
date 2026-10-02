package dev.codeatlas.design;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * The design "prompt" (ADR 0015, rewritten by ADR 0016): a plain request an engineer hands to an AI coding
 * agent. It reads like a person asking for changes ("Add class X in package Y. Purpose: ...", "X should call
 * Z. Reason: ...") and says nothing about this tool, its keys, statuses or API. It lists only work still to
 * do: planned resources, designed relations the code does not have yet, and intentions written on existing
 * code (resources or relations), which are requested behaviour changes. What the code already implements,
 * imported code without an intention, and orphaned items are left out.
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

    /** What a relation of each kind asks the source to do, as a phrase before the target's name. */
    static String ask(String kind) {
        return switch (kind) {
            case "CALLS" -> "call";
            case "DEPENDS_ON" -> "depend on";
            case "USES_TYPE" -> "use";
            case "INJECTS" -> "get injected with";
            case "CONSTRUCTS" -> "create instances of";
            case "EXTENDS" -> "extend";
            case "IMPLEMENTS" -> "implement";
            case "OVERRIDES" -> "override";
            case "READS_FIELD" -> "read a field of";
            case "WRITES_FIELD" -> "write a field of";
            case "DECLARES_BEAN" -> "declare a bean of";
            case "HANDLES_ROUTE" -> "handle the route of";
            default -> kind.toLowerCase(Locale.ROOT).replace('_', ' ');
        };
    }

    public String render(String workspaceId) {
        design.requireWorkspace(workspaceId);
        String snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        DesignService.Overlay overlay = design.overlay(workspaceId, null);
        Names names = new Names(design.codeIndex(snapshot), overlay);
        Map<String, String> signatures = parsedSignatures(snapshot);

        var add = overlay.resources().stream().filter(r -> "AUTHORED".equals(r.origin()) && "PLANNED".equals(r.status()))
            .sorted(Comparator.comparingInt((DesignService.ResourceView r) -> DesignService.category(r.kind())).thenComparing(DesignService.ResourceView::key)).toList();
        var changeResources = overlay.resources().stream().filter(r -> "CODE".equals(r.origin()) && !"ORPHANED".equals(r.status()) && !blank(r.explanation())).toList();
        var changeRelations = overlay.relations().stream().filter(r -> "CODE".equals(r.origin()) && !"ORPHANED".equals(r.status()) && !blank(r.explanation())).toList();
        var connect = overlay.relations().stream().filter(r -> "AUTHORED".equals(r.origin()) && "PLANNED".equals(r.status())).toList();

        StringBuilder md = new StringBuilder("# Changes to make\n\n");
        if (add.isEmpty() && changeResources.isEmpty() && changeRelations.isEmpty() && connect.isEmpty()) {
            md.append("Nothing to change: no planned additions, connections or intentions.\n");
            return md.toString();
        }
        md.append("Please make these changes to this Java codebase. Each item says what to add or change and why; ")
          .append("the purpose or reason is a requirement. Read the existing code for everything else.\n");
        int[] n = {0};
        if (!add.isEmpty()) {
            md.append("\n## Add\n\n");
            for (var r : add) {
                md.append(++n[0]).append(". Add ").append(article(r.kind())).append(' ').append(kindWord(r.kind())).append(" `").append(inline(declared(r, names))).append('`');
                String where = names.where(r.parentKey(), r.kind());
                if (!where.isEmpty()) md.append(' ').append(where);
                md.append('.');
                purpose(md, "Purpose", r.explanation());
            }
        }
        if (!changeResources.isEmpty() || !changeRelations.isEmpty()) {
            md.append("\n## Change\n\n");
            for (var r : changeResources) {
                md.append(++n[0]).append(". Change ").append(kindWord(r.kind())).append(" `").append(inline(names.label(r.key()))).append('`');
                String sig = r.codeId() == null ? null : signatures.get(r.codeId());
                if (sig != null && !sig.isBlank() && DesignKeys.MEMBER_KINDS.contains(r.kind())) md.append(" (`").append(inline(sig)).append("`)");
                String where = names.container(r.key());
                if (!where.isEmpty()) md.append(", ").append(where);
                md.append('.');
                purpose(md, "What should change", r.explanation());
            }
            for (var r : changeRelations) {
                md.append(++n[0]).append(". Change how ").append(names.mention(r.sourceKey())).append(' ').append(present(r.kind())).append(' ')
                  .append(names.mention(r.targetKey())).append('.');
                purpose(md, "What should change", r.explanation());
            }
        }
        if (!connect.isEmpty()) {
            md.append("\n## Connect\n\n");
            for (var r : connect) {
                md.append(++n[0]).append(". ").append(capitalize(names.mention(r.sourceKey()))).append(" should ").append(ask(r.kind())).append(' ')
                  .append(names.mention(r.targetKey())).append('.');
                purpose(md, "Reason", r.explanation());
            }
        }
        return md.toString();
    }

    /** How a resource is declared: a method by its signature when one was written, else `name(Types)`. */
    private static String declared(DesignService.ResourceView r, Names names) {
        if (DesignKeys.MEMBER_KINDS.contains(r.kind())) {
            if (r.signature() != null && !r.signature().isBlank()) return r.signature().strip();
            return r.name() + "(" + String.join(", ", Optional.ofNullable(r.parameterTypes()).orElse(List.of())) + ")";
        }
        return "PACKAGE".equals(r.kind()) ? r.key() : r.name();
    }

    /** The intent paragraph after a label, then any further paragraphs indented under the item. */
    private static void purpose(StringBuilder md, String label, String explanation) {
        if (blank(explanation)) { md.append('\n'); return; }
        String text = explanation.strip();
        int gap = text.split("\\R\\s*\\R", 2)[0].length();
        String intent = text.substring(0, gap).replaceAll("\\s+", " ").strip(), rest = text.substring(gap).strip();
        md.append(' ').append(label).append(": ").append(intent).append('\n');
        if (!rest.isEmpty()) for (String line : rest.split("\\R", -1)) md.append(line.isBlank() ? "" : "   " + line).append('\n');
    }

    private static String present(String kind) {
        String verb = ask(kind);
        int space = verb.indexOf(' ');
        String head = space < 0 ? verb : verb.substring(0, space), tail = space < 0 ? "" : verb.substring(space);
        String third = head.endsWith("y") ? head.substring(0, head.length() - 1) + "ies" : head.endsWith("s") || head.endsWith("h") ? head + "es" : head + "s";
        return (head.equals("get") ? "gets" : third) + tail;
    }

    /**
     * Human names for keys: a type by its simple name, a member as `Type.name(Types)`, a package by its full name;
     * a simple name shared by two types anywhere in the code or design falls back to the qualified one.
     */
    private static final class Names {
        final Map<String, String> kinds = new HashMap<>(), parents = new HashMap<>(), simple = new HashMap<>();
        final Set<String> designed = new HashSet<>(), inCode = new HashSet<>();
        final Map<String, Integer> typeNameCount = new HashMap<>();

        Names(DesignService.CodeIndex code, DesignService.Overlay overlay) {
            for (var s : code.byId().values()) {
                if (!DesignKeys.isResourceKind(s.kind())) continue;
                kinds.putIfAbsent(s.key(), s.kind()); simple.putIfAbsent(s.key(), s.simpleName()); inCode.add(s.key());
                String parent = code.parentKey(s);
                if (parent != null) parents.putIfAbsent(s.key(), parent);
            }
            for (var r : overlay.resources()) {
                kinds.putIfAbsent(r.key(), r.kind()); simple.putIfAbsent(r.key(), r.name());
                if (r.parentKey() != null) parents.putIfAbsent(r.key(), r.parentKey());
                if ("AUTHORED".equals(r.origin()) && !"IMPLEMENTED".equals(r.status())) designed.add(r.key());
            }
            for (var e : kinds.entrySet()) if (DesignKeys.TYPE_KINDS.contains(e.getValue())) typeNameCount.merge(simpleOf(e.getKey()), 1, Integer::sum);
        }

        String kind(String key) { return kinds.get(key); }
        String simpleOf(String key) { String s = simple.get(key); return s != null ? s : DesignKeys.simpleName(key); }

        String label(String key) {
            String kind = kind(key);
            if (kind == null || "PACKAGE".equals(kind)) return key;
            if (DesignKeys.MEMBER_KINDS.contains(kind)) {
                String owner = parents.get(key);
                String tail = key.startsWith(owner == null ? "\u0000" : owner + ".") ? key.substring(owner.length() + 1) : key;
                return (owner == null ? "" : label(owner) + ".") + tail.replace(",", ", ");
            }
            return typeNameCount.getOrDefault(simpleOf(key), 0) > 1 ? key : simpleOf(key);
        }

        /** "class `AuditLog` (new)", "package `com.acme`", "method `OrderService.complete(Long)`". */
        String mention(String key) {
            String kind = kind(key);
            return (kind == null ? "" : kindWord(kind) + " ") + "`" + inline(label(key)) + "`" + (designed.contains(key) ? " (new)" : "");
        }

        /** "in package `a.b`" / "to class `C` (package `a.b`)" for a resource being added under `parentKey`. */
        String where(String parentKey, String kind) {
            if (parentKey == null || DesignKeys.DEFAULT_PACKAGE.equals(parentKey)) return "";
            String parentKind = kind(parentKey);
            if ("PACKAGE".equals(parentKind) || parentKind == null && !DesignKeys.MEMBER_KINDS.contains(kind)) return "in package `" + inline(parentKey) + "`";
            String where = (DesignKeys.MEMBER_KINDS.contains(kind) ? "to " : "inside ") + kindWord(parentKind) + " `" + inline(label(parentKey)) + "`";
            String pkg = packageOf(parentKey);
            return pkg == null ? where : where + " (package `" + inline(pkg) + "`)";
        }

        /** "in package `a.b`" for an existing type, "in class `C` (package `a.b`)" for a member. */
        String container(String key) {
            String parent = parents.get(key);
            if (parent == null) return "";
            String pkg = packageOf(key);
            if ("PACKAGE".equals(kind(parent))) return "in package `" + inline(parent) + "`";
            return "in " + kindWord(Objects.requireNonNullElse(kind(parent), "CLASS")) + " `" + inline(label(parent)) + "`" + (pkg == null ? "" : " (package `" + inline(pkg) + "`)");
        }

        String packageOf(String key) {
            Set<String> seen = new HashSet<>();
            for (String k = key; k != null && seen.add(k); k = parents.get(k)) if ("PACKAGE".equals(kind(k))) return k;
            return null;
        }
    }

    private Map<String, String> parsedSignatures(String snapshot) {
        Map<String, String> out = new HashMap<>();
        if (snapshot == null) return out;
        db.query("SELECT id, signature FROM symbol_versions WHERE snapshot_id = ? AND signature IS NOT NULL AND kind IN ('METHOD','CONSTRUCTOR')",
            rs -> { out.put(rs.getString("id"), rs.getString("signature")); }, snapshot);
        return out;
    }

    private static String kindWord(String kind) { return "ANNOTATION".equals(kind) ? "annotation type" : kind.toLowerCase(Locale.ROOT); }
    private static String article(String kind) { return "INTERFACE".equals(kind) || "ENUM".equals(kind) || "ANNOTATION".equals(kind) ? "an" : "a"; }
    private static String capitalize(String s) { return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1); }
    private static boolean blank(String s) { return s == null || s.isBlank(); }
    private static String inline(String s) { return s == null ? "" : s.replace("`", "'").replace("\n", " "); }
}
