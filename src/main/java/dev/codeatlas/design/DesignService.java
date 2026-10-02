package dev.codeatlas.design;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.*;

/**
 * The engineer-owned design layer (ADR 0014): resources and relations the engineer or an AI agent
 * working for them adds to the map, and explanations attached to parsed resources. It never writes
 * parser facts. Every write names its author; there is no review step, the engineer edits what an
 * agent built. Status is computed against a snapshot on read.
 */
@Service
public class DesignService {
    public static final String SCHEMA_VERSION = "1";
    static final int MAX_RESOURCES = 5_000, MAX_RELATIONS = 10_000, MAX_OPERATIONS = 1_000;

    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    private final ObjectMapper json = new ObjectMapper();

    public DesignService(JdbcTemplate db, PlatformTransactionManager transactionManager) {
        this.db = db;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    // ------------------------------------------------------------------ API shapes

    /** One change. `op` is putResource, updateResource, deleteResource, putRelation or deleteRelation. */
    public record Operation(String op, String key, String kind, String name, String parentKey, List<String> parameterTypes,
                            String signature, String explanation, String sourceKey, String targetKey) {}
    public record ChangeSet(String author, List<Operation> operations) {}
    public record OperationResult(int index, String op, String key, String outcome) {}
    public record ChangeResult(String schemaVersion, boolean dryRun, int applied, List<OperationResult> results) {}

    public record ResourceView(String id, String key, String kind, String name, String parentKey, List<String> parameterTypes,
                               String signature, String origin, String status, String explanation, String intent,
                               String createdBy, String updatedBy, String createdAt, String updatedAt, int revision,
                               String codeId, String parentCodeId, List<String> roles) {}
    /** {@code origin} AUTHORED: a relation drawn as design; CODE: a parsed dependency carried along (ADR 0016). */
    public record RelationView(String id, String sourceKey, String targetKey, String kind, String resolution, String status,
                               String explanation, String intent, String createdBy, String updatedBy, String createdAt,
                               String updatedAt, int revision, String sourceCodeId, String targetCodeId, String origin) {}
    public record Overlay(String schemaVersion, String workspaceId, String snapshotId, List<ResourceView> resources, List<RelationView> relations) {}

    /** A parsed declaration of one snapshot, addressed by its stable key. */
    record CodeSymbol(String id, String key, String kind, String simpleName, String parentId) {}
    /** The parsed declarations of one snapshot by key and by ID. Empty for a workspace without a snapshot. */
    record CodeIndex(String snapshotId, Map<String, CodeSymbol> byKey, Map<String, CodeSymbol> byId) {
        CodeSymbol get(String key) { return key == null ? null : byKey.get(key); }
        String parentKey(CodeSymbol s) { CodeSymbol p = s.parentId() == null ? null : byId.get(s.parentId()); return p == null ? null : p.key(); }
    }

    // ------------------------------------------------------------------ reads

    public Overlay overlay(String workspaceId, String snapshotId) {
        requireWorkspace(workspaceId);
        String snapshot = snapshotFor(workspaceId, snapshotId);
        CodeIndex code = codeIndex(snapshot);
        List<Map<String, Object>> rows = resourceRows(workspaceId);
        Set<String> designKeys = new HashSet<>();
        for (var r : rows) designKeys.add((String) r.get("resource_key"));
        List<ResourceView> resources = new ArrayList<>();
        for (var r : rows) resources.add(resourceView(r, code, designKeys));
        List<RelationView> relations = new ArrayList<>();
        var relationRows = relationRows(workspaceId);
        Set<String> evidenced = evidencedRelations(snapshot, code, relationRows);
        for (var r : relationRows) relations.add(relationView(r, code, designKeys, evidenced));
        return new Overlay(SCHEMA_VERSION, workspaceId, snapshot, resources, relations);
    }

    ResourceView resourceView(Map<String, Object> r, CodeIndex code, Set<String> designKeys) {
        String key = (String) r.get("resource_key"), parentKey = (String) r.get("parent_key"), origin = (String) r.get("origin");
        CodeSymbol own = code.get(key), parent = code.get(parentKey);
        boolean parentKnown = parentKey == null || parent != null || designKeys.contains(parentKey);
        String status = own != null ? ("AUTHORED".equals(origin) ? "IMPLEMENTED" : "PRESENT")
            : !parentKnown ? "ORPHANED" : "AUTHORED".equals(origin) ? "PLANNED" : "MISSING";
        String explanation = (String) r.get("explanation");
        return new ResourceView((String) r.get("id"), key, (String) r.get("kind"), (String) r.get("simple_name"), parentKey,
            params((String) r.get("parameter_types")), (String) r.get("signature"), origin, status, explanation,
            DesignKeys.intent(explanation), (String) r.get("created_by"), (String) r.get("updated_by"),
            (String) r.get("created_at"), (String) r.get("updated_at"), ((Number) r.get("revision")).intValue(),
            own == null ? null : own.id(), parent == null ? null : parent.id(), params((String) r.get("roles")));
    }

    RelationView relationView(Map<String, Object> r, CodeIndex code, Set<String> designKeys, Set<String> evidenced) {
        String source = (String) r.get("source_key"), target = (String) r.get("target_key"), kind = (String) r.get("kind");
        CodeSymbol s = code.get(source), t = code.get(target);
        boolean known = (s != null || designKeys.contains(source)) && (t != null || designKeys.contains(target));
        String origin = Objects.requireNonNullElse((String) r.get("origin"), "AUTHORED");
        boolean inCode = evidenced.contains(relationIdentity(source, target, kind));
        // A CODE relation is a parsed dependency carried along: present when the code has it, else missing.
        String status = !known ? "ORPHANED" : "CODE".equals(origin) ? (inCode ? "PRESENT" : "MISSING") : inCode ? "IMPLEMENTED" : "PLANNED";
        String explanation = (String) r.get("explanation");
        return new RelationView((String) r.get("id"), source, target, kind, "CODE".equals(origin) ? "CODE" : "DESIGNED", status, explanation, DesignKeys.intent(explanation),
            (String) r.get("created_by"), (String) r.get("updated_by"), (String) r.get("created_at"), (String) r.get("updated_at"),
            ((Number) r.get("revision")).intValue(), s == null ? null : s.id(), t == null ? null : t.id(), origin);
    }

    static String relationIdentity(String source, String target, String kind) { return source + "\u0000" + target + "\u0000" + kind; }

    /**
     * Design relations the analyzed code already carries: a parser relationship of the same kind
     * from the source resource (or anything inside it) to the target resource (or anything inside it).
     */
    Set<String> evidencedRelations(String snapshot, CodeIndex code, List<Map<String, Object>> relations) {
        Set<String> out = new HashSet<>();
        if (snapshot == null || relations.isEmpty()) return out;
        Map<String, List<Map<String, Object>>> bySource = new HashMap<>();
        Set<String> kinds = new HashSet<>();
        for (var r : relations) {
            if (code.get((String) r.get("source_key")) == null || code.get((String) r.get("target_key")) == null) continue;
            bySource.computeIfAbsent((String) r.get("source_key"), k -> new ArrayList<>()).add(r);
            kinds.add((String) r.get("kind"));
        }
        if (bySource.isEmpty()) return out;
        String placeholders = String.join(",", Collections.nCopies(kinds.size(), "?"));
        List<Object> args = new ArrayList<>(List.of(snapshot)); args.addAll(kinds);
        db.query("SELECT source_symbol_id, target_symbol_id, kind FROM relationship_occurrences WHERE snapshot_id = ? AND target_symbol_id IS NOT NULL AND kind IN (" + placeholders + ")", rs -> {
            String kind = rs.getString("kind");
            List<String> targetChain = chain(code, rs.getString("target_symbol_id"));
            for (String sourceKey : chain(code, rs.getString("source_symbol_id"))) {
                var candidates = bySource.get(sourceKey);
                if (candidates == null) continue;
                for (var c : candidates) if (kind.equals(c.get("kind")) && targetChain.contains((String) c.get("target_key")))
                    out.add(relationIdentity(sourceKey, (String) c.get("target_key"), kind));
            }
        }, args.toArray());
        return out;
    }

    private static List<String> chain(CodeIndex code, String id) {
        List<String> keys = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (CodeSymbol s = code.byId().get(id); s != null && seen.add(s.id()); s = s.parentId() == null ? null : code.byId().get(s.parentId())) keys.add(s.key());
        return keys;
    }

    // ------------------------------------------------------------------ writes

    public ChangeResult apply(String workspaceId, ChangeSet changes, boolean dryRun) {
        requireWorkspace(workspaceId);
        if (changes == null || changes.operations() == null || changes.operations().isEmpty()) throw new IllegalArgumentException("A change set needs at least one operation");
        if (changes.operations().size() > MAX_OPERATIONS) throw new IllegalArgumentException("A change set may hold at most " + MAX_OPERATIONS + " operations");
        String author = DesignKeys.author(changes.author());
        return transactions.execute(tx -> {
            CodeIndex code = codeIndex(snapshotFor(workspaceId, null));
            List<OperationResult> results = new ArrayList<>();
            int i = 0;
            for (Operation op : changes.operations()) {
                try {
                    results.add(applyOne(workspaceId, code, i, op, author));
                } catch (IllegalArgumentException | NoSuchElementException e) {
                    String label = op == null || op.op() == null ? "operation" : op.op();
                    throw new IllegalArgumentException("Operation " + i + " (" + label + "): " + e.getMessage(), e);
                }
                i++;
            }
            if (dryRun) tx.setRollbackOnly();
            return new ChangeResult(SCHEMA_VERSION, dryRun, results.size(), results);
        });
    }

    OperationResult applyOne(String ws, CodeIndex code, int index, Operation op, String author) {
        if (op == null || op.op() == null) throw new IllegalArgumentException("Missing \"op\"");
        return switch (op.op()) {
            case "putResource" -> putResource(ws, code, index, op, author);
            case "updateResource" -> updateResource(ws, code, index, op, author);
            case "deleteResource" -> deleteResource(ws, code, index, op);
            case "putRelation" -> putRelation(ws, code, index, op, author);
            case "deleteRelation" -> deleteRelation(ws, index, op);
            default -> throw new IllegalArgumentException("Unknown op \"" + op.op() + "\"; use putResource, updateResource, deleteResource, putRelation or deleteRelation");
        };
    }

    private OperationResult putResource(String ws, CodeIndex code, int index, Operation op, String author) {
        String explanation = DesignKeys.explanation(op.explanation());
        if (op.name() == null) {
            // Explain an existing resource addressed by key alone.
            if (op.key() == null) throw new IllegalArgumentException("putResource needs either key, or kind + name (+ parentKey)");
            return explainExisting(ws, code, index, op.key(), explanation, DesignKeys.signature(op.signature()), author);
        }
        String kind = upper(op.kind());
        if (kind == null) throw new IllegalArgumentException("putResource needs \"kind\"");
        String parentKey = blankToNull(op.parentKey());
        String key = DesignKeys.key(kind, parentKey, op.name(), op.parameterTypes());
        if (op.key() != null && !op.key().equals(key)) throw new IllegalArgumentException("key \"" + op.key() + "\" does not match the key built from kind/parentKey/name/parameterTypes: \"" + key + "\"");
        var row = designRow(ws, key);
        // Parsed code (annotated or not) only takes an explanation; its structure belongs to the parser.
        if (row == null && code.get(key) != null || row != null && !"AUTHORED".equals(row.get("origin")))
            return explainExisting(ws, code, index, key, explanation, null, author);
        if (row != null) {
            String rowKind = (String) row.get("kind"), signature = DesignKeys.signature(op.signature());
            if (category(rowKind) != category(kind)) throw new IllegalArgumentException("Cannot change " + key + " from " + rowKind + " to " + kind);
            boolean changed = !rowKind.equals(kind) || signature != null && !signature.equals(row.get("signature"))
                || explanation != null && !explanation.equals(row.get("explanation"));
            if (!changed) return new OperationResult(index, op.op(), key, "unchanged");
            db.update("UPDATE design_resources SET kind = ?, signature = COALESCE(?, signature), explanation = COALESCE(?, explanation), updated_by = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                kind, signature, explanation, author, row.get("id"));
            if (explanation != null) staleSymbolExplanations(ws, key);
            return new OperationResult(index, op.op(), key, "updated");
        }
        DesignKeys.requireParentKind(kind, parentKind(ws, code, parentKey));
        insertResource(ws, key, kind, op.name().trim(), parentKey, DesignKeys.MEMBER_KINDS.contains(kind) ? normalizedParams(op.parameterTypes()) : null,
            DesignKeys.signature(op.signature()), "AUTHORED", explanation == null ? "" : explanation, author, author);
        return new OperationResult(index, op.op(), key, "created");
    }

    private OperationResult explainExisting(String ws, CodeIndex code, int index, String key, String explanation, String signature, String author) {
        var row = designRow(ws, key);
        if (row != null) {
            boolean changed = explanation != null && !explanation.equals(row.get("explanation"))
                || signature != null && "AUTHORED".equals(row.get("origin")) && !signature.equals(row.get("signature"));
            if (!changed) return new OperationResult(index, "putResource", key, "unchanged");
            db.update("UPDATE design_resources SET explanation = COALESCE(?, explanation), signature = CASE WHEN origin = 'AUTHORED' THEN COALESCE(?, signature) ELSE signature END, updated_by = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                explanation, signature, author, row.get("id"));
            if (explanation != null) staleSymbolExplanations(ws, key);
            return new OperationResult(index, "putResource", key, "updated");
        }
        CodeSymbol s = code.get(key);
        if (s == null) throw new NoSuchElementException("No parsed or designed resource has key \"" + key + "\"; to create one supply kind, name and parentKey");
        if (!DesignKeys.isResourceKind(s.kind())) throw new IllegalArgumentException(s.kind() + " resources cannot carry a design explanation");
        insertResource(ws, key, s.kind(), s.simpleName(), code.parentKey(s), null, null, "CODE", explanation == null ? "" : explanation, author, author);
        if (explanation != null) staleSymbolExplanations(ws, key);
        return new OperationResult(index, "putResource", key, "created");
    }

    private OperationResult updateResource(String ws, CodeIndex code, int index, Operation op, String author) {
        String key = op.key();
        if (key == null) throw new IllegalArgumentException("updateResource needs \"key\"");
        var row = designRow(ws, key);
        String explanation = DesignKeys.explanation(op.explanation());
        boolean structural = op.name() != null || op.parentKey() != null || op.parameterTypes() != null || op.kind() != null;
        if (row == null || !"AUTHORED".equals(row.get("origin"))) {
            if (structural) throw new IllegalArgumentException("\"" + key + "\" is parsed code: it cannot be renamed, moved or re-kinded here. Describe the intended change in its explanation instead");
            return explainExisting(ws, code, index, key, explanation, null, author);
        }
        String kind = op.kind() == null ? (String) row.get("kind") : upper(op.kind());
        if (category(kind) != category((String) row.get("kind"))) throw new IllegalArgumentException("Cannot change " + key + " from " + row.get("kind") + " to " + kind);
        String name = op.name() == null ? (String) row.get("simple_name") : op.name().trim();
        String parentKey = op.parentKey() == null ? (String) row.get("parent_key") : blankToNull(op.parentKey());
        List<String> params = op.parameterTypes() == null ? params((String) row.get("parameter_types")) : normalizedParams(op.parameterTypes());
        String newKey = DesignKeys.key(kind, parentKey, name, params);
        DesignKeys.requireParentKind(kind, parentKind(ws, code, parentKey));
        if (!newKey.equals(key)) {
            if (designRow(ws, newKey) != null || code.get(newKey) != null) throw new IllegalArgumentException("\"" + newKey + "\" already exists");
            if (parentKey != null && (parentKey.equals(key) || parentKey.startsWith(key + "."))) throw new IllegalArgumentException("A resource cannot move inside itself");
        }
        db.update("UPDATE design_resources SET kind = ?, simple_name = ?, parent_key = ?, parameter_types = ?, signature = COALESCE(?, signature), explanation = COALESCE(?, explanation), updated_by = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            kind, name, parentKey, DesignKeys.MEMBER_KINDS.contains(kind) ? toJson(params) : null, DesignKeys.signature(op.signature()), explanation, author, row.get("id"));
        if (!newKey.equals(key)) rekey(ws, key, newKey);
        if (explanation != null) staleSymbolExplanations(ws, newKey);
        return new OperationResult(index, op.op(), newKey, newKey.equals(key) ? "updated" : "renamed from " + key);
    }

    /** Moves a resource to a new key; its design children follow, and relations keep their endpoints. */
    private void rekey(String ws, String oldKey, String newKey) {
        db.update("UPDATE design_resources SET resource_key = ? WHERE workspace_id = ? AND resource_key = ?", newKey, ws, oldKey);
        db.update("UPDATE design_relations SET source_key = ? WHERE workspace_id = ? AND source_key = ?", newKey, ws, oldKey);
        db.update("UPDATE design_relations SET target_key = ? WHERE workspace_id = ? AND target_key = ?", newKey, ws, oldKey);
        for (var child : db.queryForList("SELECT id, kind, simple_name, parameter_types FROM design_resources WHERE workspace_id = ? AND parent_key = ?", ws, oldKey)) {
            String childKind = (String) child.get("kind");
            String oldChild = db.queryForObject("SELECT resource_key FROM design_resources WHERE id = ?", String.class, child.get("id"));
            // A constructor is named after its type, so it is renamed with it.
            String childName = "CONSTRUCTOR".equals(childKind) ? DesignKeys.simpleName(newKey) : (String) child.get("simple_name");
            String newChild = DesignKeys.key(childKind, newKey, childName, params((String) child.get("parameter_types")));
            if (!newChild.equals(oldChild) && designRow(ws, newChild) != null) throw new IllegalArgumentException("Moving would collide with existing \"" + newChild + "\"");
            db.update("UPDATE design_resources SET parent_key = ?, simple_name = ? WHERE id = ?", newKey, childName, child.get("id"));
            if (!newChild.equals(oldChild)) rekey(ws, oldChild, newChild);
        }
    }

    private OperationResult deleteResource(String ws, CodeIndex code, int index, Operation op) {
        String key = op.key();
        if (key == null) throw new IllegalArgumentException("deleteResource needs \"key\"");
        var row = designRow(ws, key);
        if (row == null) throw new NoSuchElementException(code.get(key) != null
            ? "\"" + key + "\" is parsed code with no design explanation; there is nothing to delete"
            : "No designed resource has key \"" + key + "\"");
        if ("CODE".equals(row.get("origin")) && code.get(key) != null) {
            // Parsed code stays on the map; only the engineer's explanation of it goes.
            db.update("DELETE FROM design_resources WHERE id = ?", row.get("id"));
            staleSymbolExplanations(ws, key);
            return new OperationResult(index, op.op(), key, "explanation removed");
        }
        List<String> doomed = new ArrayList<>();
        Deque<String> pending = new ArrayDeque<>(List.of(key));
        while (!pending.isEmpty()) {
            String k = pending.pop();
            doomed.add(k);
            // An explanation on parsed code inside it survives: that code is still on the map.
            for (var child : db.queryForList("SELECT resource_key, origin FROM design_resources WHERE workspace_id = ? AND parent_key = ?", ws, k))
                if (!("CODE".equals(child.get("origin")) && code.get((String) child.get("resource_key")) != null)) pending.add((String) child.get("resource_key"));
        }
        int relations = 0;
        for (String k : doomed) {
            boolean annotatedCode = code.get(k) != null;
            db.update("DELETE FROM design_resources WHERE workspace_id = ? AND resource_key = ?", ws, k);
            relations += db.update("DELETE FROM design_relations WHERE workspace_id = ? AND (source_key = ? OR target_key = ?)", ws, k, k);
            if (annotatedCode) staleSymbolExplanations(ws, k);
        }
        return new OperationResult(index, op.op(), key, "deleted " + doomed.size() + " resource(s), " + relations + " relation(s)");
    }

    private OperationResult putRelation(String ws, CodeIndex code, int index, Operation op, String author) {
        String kind = upper(op.kind());
        if (kind == null || !DesignKeys.RELATION_KINDS.contains(kind)) throw new IllegalArgumentException("Relation kind must be one of " + new TreeSet<>(DesignKeys.RELATION_KINDS));
        String source = op.sourceKey(), target = op.targetKey();
        if (source == null || target == null) throw new IllegalArgumentException("putRelation needs sourceKey and targetKey");
        for (String k : List.of(source, target)) if (designRow(ws, k) == null && code.get(k) == null)
            throw new NoSuchElementException("No parsed or designed resource has key \"" + k + "\"");
        String explanation = DesignKeys.explanation(op.explanation());
        var rows = db.queryForList("SELECT id, explanation FROM design_relations WHERE workspace_id = ? AND source_key = ? AND target_key = ? AND kind = ?", ws, source, target, kind);
        String identity = source + " -" + kind + "-> " + target;
        if (!rows.isEmpty()) {
            if (explanation == null || explanation.equals(rows.get(0).get("explanation"))) return new OperationResult(index, op.op(), identity, "unchanged");
            db.update("UPDATE design_relations SET explanation = ?, updated_by = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", explanation, author, rows.get(0).get("id"));
            staleRelationExplanations(ws, source, target, kind);
            return new OperationResult(index, op.op(), identity, "updated");
        }
        if (db.queryForObject("SELECT COUNT(*) FROM design_relations WHERE workspace_id = ?", Integer.class, ws) >= MAX_RELATIONS)
            throw new IllegalArgumentException("A workspace design layer holds at most " + MAX_RELATIONS + " relations");
        // Explaining a relation the code already has carries a parsed dependency along (origin CODE), so it
        // is never mistaken for designed work; a relation the code lacks is design (ADR 0016).
        var probe = new HashMap<String, Object>(Map.of("source_key", source, "target_key", target, "kind", kind));
        String origin = evidencedRelations(code.snapshotId(), code, List.of(probe)).isEmpty() ? "AUTHORED" : "CODE";
        insertRelation(ws, source, target, kind, explanation == null ? "" : explanation, author, author, origin);
        if (explanation != null && !explanation.isEmpty()) staleRelationExplanations(ws, source, target, kind);
        return new OperationResult(index, op.op(), identity, "created");
    }

    private OperationResult deleteRelation(String ws, int index, Operation op) {
        String kind = upper(op.kind());
        if (op.sourceKey() == null || op.targetKey() == null || kind == null) throw new IllegalArgumentException("deleteRelation needs sourceKey, targetKey and kind");
        if (db.update("DELETE FROM design_relations WHERE workspace_id = ? AND source_key = ? AND target_key = ? AND kind = ?", ws, op.sourceKey(), op.targetKey(), kind) == 0)
            throw new NoSuchElementException("No designed relation " + op.sourceKey() + " -" + kind + "-> " + op.targetKey());
        staleRelationExplanations(ws, op.sourceKey(), op.targetKey(), kind);
        return new OperationResult(index, op.op(), op.sourceKey() + " -" + kind + "-> " + op.targetKey(), "deleted");
    }

    // ------------------------------------------------------------------ shared helpers (also used by import)

    void insertResource(String ws, String key, String kind, String name, String parentKey, List<String> params, String signature,
                        String origin, String explanation, String createdBy, String updatedBy) {
        if (db.queryForObject("SELECT COUNT(*) FROM design_resources WHERE workspace_id = ?", Integer.class, ws) >= MAX_RESOURCES)
            throw new IllegalArgumentException("A workspace design layer holds at most " + MAX_RESOURCES + " resources");
        db.update("INSERT INTO design_resources (id, workspace_id, resource_key, kind, simple_name, parent_key, parameter_types, signature, origin, explanation, created_by, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            UUID.randomUUID().toString(), ws, key, kind, name, parentKey, params == null ? null : toJson(params), signature, origin, explanation, createdBy, updatedBy);
    }

    void insertRelation(String ws, String source, String target, String kind, String explanation, String createdBy, String updatedBy, String origin) {
        db.update("INSERT INTO design_relations (id, workspace_id, source_key, target_key, kind, explanation, created_by, updated_by, origin) VALUES (?,?,?,?,?,?,?,?,?)",
            UUID.randomUUID().toString(), ws, source, target, kind, explanation, createdBy, updatedBy, origin);
    }

    Map<String, Object> designRow(String ws, String key) {
        var rows = db.queryForList("SELECT * FROM design_resources WHERE workspace_id = ? AND resource_key = ?", ws, key);
        return rows.isEmpty() ? null : rows.get(0);
    }

    String parentKind(String ws, CodeIndex code, String parentKey) {
        if (parentKey == null) return null;
        if (DesignKeys.DEFAULT_PACKAGE.equals(parentKey)) return "PACKAGE";
        var row = designRow(ws, parentKey);
        if (row != null) return (String) row.get("kind");
        CodeSymbol s = code.get(parentKey);
        if (s != null) return s.kind();
        throw new NoSuchElementException("Parent \"" + parentKey + "\" is neither parsed nor designed; create it first");
    }

    List<Map<String, Object>> resourceRows(String ws) {
        return db.queryForList("SELECT * FROM design_resources WHERE workspace_id = ? ORDER BY resource_key", ws);
    }

    List<Map<String, Object>> relationRows(String ws) {
        return db.queryForList("SELECT * FROM design_relations WHERE workspace_id = ? ORDER BY source_key, target_key, kind", ws);
    }

    CodeIndex codeIndex(String snapshot) {
        Map<String, CodeSymbol> byKey = new HashMap<>(), byId = new HashMap<>();
        if (snapshot != null) db.query("SELECT id, kind, qualified_name, simple_name, parent_symbol_id FROM symbol_versions WHERE snapshot_id = ? AND COALESCE(source_status, 'ACTIVE') != 'DELETED'", rs -> {
            var s = new CodeSymbol(rs.getString("id"), rs.getString("qualified_name"), rs.getString("kind"), rs.getString("simple_name"), rs.getString("parent_symbol_id"));
            byKey.putIfAbsent(s.key(), s);
            byId.put(s.id(), s);
        }, snapshot);
        return new CodeIndex(snapshot, byKey, byId);
    }

    String snapshotFor(String ws, String snapshotId) {
        if (snapshotId == null || snapshotId.isBlank()) return db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, ws);
        if (db.queryForObject("SELECT COUNT(*) FROM snapshots WHERE id = ? AND workspace_id = ?", Integer.class, snapshotId, ws) == 0)
            throw new NoSuchElementException("Snapshot not found in this workspace");
        return snapshotId;
    }

    void requireWorkspace(String id) {
        if (db.queryForObject("SELECT COUNT(*) FROM workspaces WHERE id = ?", Integer.class, id) == 0) throw new NoSuchElementException("Workspace not found");
    }

    /** A generated explanation consumed the engineer's explanation of its subject; a new one makes it stale. */
    void staleSymbolExplanations(String ws, String key) {
        db.update("UPDATE explanations SET status = 'STALE', updated_at = CURRENT_TIMESTAMP WHERE status = 'READY' AND subject_type = 'symbol' AND subject_version_id IN (SELECT id FROM symbol_versions WHERE workspace_id = ? AND qualified_name = ?)", ws, key);
    }

    void staleRelationExplanations(String ws, String source, String target, String kind) {
        db.update("""
            UPDATE explanations SET status = 'STALE', updated_at = CURRENT_TIMESTAMP
            WHERE status = 'READY' AND subject_type = 'relationship' AND subject_version_id IN (
              SELECT r.id FROM relationship_occurrences r
              JOIN symbol_versions s ON s.id = r.source_symbol_id JOIN symbol_versions t ON t.id = r.target_symbol_id
              WHERE s.workspace_id = ? AND s.qualified_name = ? AND t.qualified_name = ? AND r.kind = ?)
            """, ws, source, target, kind);
    }

    List<String> params(String jsonArray) {
        if (jsonArray == null || jsonArray.isBlank()) return null;
        try { return json.readValue(jsonArray, new TypeReference<List<String>>() {}); } catch (Exception e) { return null; }
    }

    String toJson(Object value) {
        try { return json.writeValueAsString(value); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static List<String> normalizedParams(List<String> params) {
        return params == null ? List.of() : params.stream().map(p -> p == null ? "" : p.trim()).toList();
    }

    static int category(String kind) {
        return "PACKAGE".equals(kind) ? 0 : DesignKeys.TYPE_KINDS.contains(kind) ? 1 : DesignKeys.MEMBER_KINDS.contains(kind) ? 2 : -1;
    }

    static String upper(String s) { return s == null || s.isBlank() ? null : s.trim().toUpperCase(Locale.ROOT); }
    static String blankToNull(String s) { return s == null || s.isBlank() ? null : s.trim(); }
}
