package dev.codeatlas.review;

import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.analysis.AnalysisService;
import dev.codeatlas.api.dto.*;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.graph.GraphQueryService;
import dev.codeatlas.storage.WorkspaceRepository;
import dev.codeatlas.api.dto.WorkspaceResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Coordinates immutable Git captures, parser snapshots, and deterministic comparison facts. */
@Service
public class ReviewService {
    private final JdbcTemplate db;
    private final AnalysisService analysis;
    private final GraphQueryService graphs;
    private final GitReviewSourceAdapter git;
    private final CodeAtlasProperties properties;
    private final AnalysisPortRegistry portRegistry;
    private final WorkspaceRepository workspaceRepository;

    public ReviewService(JdbcTemplate db, AnalysisService analysis, GraphQueryService graphs,
                         GitReviewSourceAdapter git, CodeAtlasProperties properties,
                         AnalysisPortRegistry portRegistry, WorkspaceRepository workspaceRepository) {
        this.db = db; this.analysis = analysis; this.graphs = graphs; this.git = git;
        this.properties = properties; this.portRegistry = portRegistry; this.workspaceRepository = workspaceRepository;
    }

    public ReviewResponse capture(String workspaceId, ReviewRequest request) {
        WorkspaceResponse workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new IllegalArgumentException("Workspace not found."));
        String root = workspace.path();
        if (root == null) throw new IllegalArgumentException("Workspace not found.");
        // Reject an unshipped language before any Git capture, temporary source copy, or review
        // snapshot is created. AnalysisService validates again from each retained snapshot.
        String language = portRegistry.require(workspace.language()).language();
        Path repo = Path.of(root).toAbsolutePath().normalize();
        if (!Files.isDirectory(repo.resolve(".git")) && !Files.isRegularFile(repo.resolve(".git"))) {
            throw new IllegalArgumentException("Workspace is not a local Git repository.");
        }
        if (!git.topLevel(repo).equals(repo)) throw new IllegalArgumentException("Review requires the workspace to be the Git worktree root.");
        GitReviewSourceAdapter.Base base;
        try { base = git.resolveBase(repo, request.baseRef()); }
        catch (RuntimeException e) { throw new IllegalArgumentException("Could not resolve the requested local Git base revision."); }
        String frozenInput = git.comparisonFingerprint(repo, base.oid());
        List<ReviewResponse.ReviewDiagnostic> diagnostics = new ArrayList<>();
        if (base.warning() != null) diagnostics.add(new ReviewResponse.ReviewDiagnostic("WARNING", "BASE_UPSTREAM_UNAVAILABLE", base.warning()));
        GitReviewSourceAdapter.Diff rawDiff = git.diff(repo, base.oid());
        List<GitReviewSourceAdapter.FileDelta> files = rawDiff.files();
        Map<String, List<GitReviewSourceAdapter.Hunk>> hunks = rawDiff.hunks();
        List<ReviewResponse.ReviewFile> responseFiles = files.stream().map(f -> new ReviewResponse.ReviewFile(f.path(), f.status(), f.added(), f.removed(), f.javaFile(), f.lineCountsAvailable())).toList();
        files.stream().filter(f -> !f.lineCountsAvailable()).forEach(f -> diagnostics.add(new ReviewResponse.ReviewDiagnostic(
                "WARNING", "LINE_COUNTS_UNAVAILABLE", "Physical line counts are unavailable for binary file " + f.path() + ".")));
        int additions = files.stream().mapToInt(GitReviewSourceAdapter.FileDelta::added).sum();
        int removals = files.stream().mapToInt(GitReviewSourceAdapter.FileDelta::removed).sum();

        Path dataRoot;
        try { dataRoot = Path.of(properties.getDataDir()).toRealPath(); }
        catch (IOException e) { throw new IllegalArgumentException("Application review storage is unavailable."); }
        if (dataRoot.startsWith(repo)) throw new IllegalArgumentException("Application review storage must be outside the analyzed workspace.");
        Path capture = null;
        String baseSnapshot = null, headSnapshot = null;
        try {
            Path captureParent = dataRoot.resolve("review-captures");
            Files.createDirectories(captureParent);
            if (Files.isSymbolicLink(captureParent) || !captureParent.toRealPath().startsWith(dataRoot)) {
                throw new IllegalArgumentException("Application review capture storage must not be a symbolic link.");
            }
            capture = Files.createTempDirectory(captureParent, "capture-");
            git.materializeBase(repo, base.oid(), capture.resolve("base"));
            GitReviewSourceAdapter.Capture headCapture = git.materializeWorkingTree(repo, capture.resolve("head"));
            if (!frozenInput.equals(git.comparisonFingerprint(repo, base.oid()))) {
                throw new IllegalArgumentException("Working-tree changes occurred while the review was captured; retry the review.");
            }
            String capturedAt = Instant.now().toString();
            baseSnapshot = createSnapshot(workspaceId, "REVIEW_BASE", "base=" + base.oid(), language);
            analysis.runReviewAnalysis(workspaceId, baseSnapshot, capture.resolve("base"));
            headSnapshot = createSnapshot(workspaceId, "REVIEW_HEAD", "head=" + headCapture.headOid() + ";fingerprint=" + frozenInput, language);
            analysis.runReviewAnalysis(workspaceId, headSnapshot, capture.resolve("head"));
            diagnostics.addAll(snapshotDiagnostics(baseSnapshot, "BASE"));
            diagnostics.addAll(snapshotDiagnostics(headSnapshot, "HEAD"));
            Comparison comparison = compare(baseSnapshot, headSnapshot, hunks, diagnostics);
            return new ReviewResponse("1", workspaceId,
                    new ReviewResponse.ReviewSide(baseSnapshot, base.requestedRef(), base.oid(), base.warning()),
                    new ReviewResponse.ReviewHead(headSnapshot, "WORKING_TREE", headCapture.headOid(), frozenInput, capturedAt),
                    new ReviewResponse.ReviewSummary(additions, removals, files.size()), responseFiles,
                    comparison.nodes(), comparison.relationships(), List.copyOf(diagnostics));
        } catch (IOException e) {
            fail(baseSnapshot); fail(headSnapshot);
            throw new IllegalArgumentException("Could not prepare a private review capture.");
        } catch (RuntimeException e) {
            fail(baseSnapshot); fail(headSnapshot);
            throw e;
        } finally {
            deleteCapture(capture);
        }
    }

    private String createSnapshot(String workspaceId, String purpose, String identity, String language) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO snapshots(id,workspace_id,status,purpose,review_identity,language,created_at) VALUES(?,?, 'staging',?,?,?,datetime('now'))", id, workspaceId, purpose, identity, language);
        return id;
    }
    private void fail(String snapshot) {
        if (snapshot == null) return;
        // A failed review is not a retained review session.  Delete all dependent rows via the existing snapshot
        // cleanup trigger so a failed second side cannot leave a half-review visible later.
        db.update("DELETE FROM snapshots WHERE id=? AND purpose IN ('REVIEW_BASE','REVIEW_HEAD')", snapshot);
    }
    private void deleteCapture(Path capture) {
        if (capture == null) return;
        try (var paths = Files.walk(capture)) { paths.sorted(Comparator.reverseOrder()).forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) {} }); }
        catch (IOException ignored) {}
    }

    private record NodeFact(GraphNode graph, String identity, String path, String snippet, int start, int end) {}
    private record EdgeFact(GraphEdge graph, String identity, boolean changedSite, String location) {}
    private record Comparison(List<ReviewResponse.ReviewNode> nodes, List<ReviewResponse.ReviewRelationship> relationships) {}

    private Comparison compare(String base, String head, Map<String, List<GitReviewSourceAdapter.Hunk>> hunks,
                               List<ReviewResponse.ReviewDiagnostic> diagnostics) {
        Map<String, NodeFact> before = nodes(base, diagnostics, "BASE");
        Map<String, NodeFact> after = nodes(head, diagnostics, "HEAD");
        Map<String, LineCounts> baseCounts = counts(base, before.values(), hunks, true);
        Map<String, LineCounts> headCounts = counts(head, after.values(), hunks, false);
        Set<String> keys = new TreeSet<>(); keys.addAll(before.keySet()); keys.addAll(after.keySet());
        List<ReviewResponse.ReviewNode> nodes = new ArrayList<>();
        for (String key : keys) {
            NodeFact a = before.get(key), b = after.get(key);
            LineCounts old = baseCounts.getOrDefault(key, LineCounts.ZERO), newer = headCounts.getOrDefault(key, LineCounts.ZERO);
            String status = a == null ? "ADDED" : b == null ? "REMOVED" :
                    (!Objects.equals(a.snippet(), b.snippet()) || (a.graph().kind().name().equals("PACKAGE") && (old.removed > 0 || newer.added > 0))) ? "MODIFIED" : "UNCHANGED";
            nodes.add(new ReviewResponse.ReviewNode(opaque("node", key), status,
                    "UNCHANGED".equals(status) ? 0 : newer.added, "UNCHANGED".equals(status) ? 0 : old.removed,
                    a == null ? null : a.graph(), b == null ? null : b.graph()));
        }
        Map<String, List<EdgeFact>> baseEdges = edges(base, before, diagnostics, "BASE", hunks);
        Map<String, List<EdgeFact>> headEdges = edges(head, after, diagnostics, "HEAD", hunks);
        Set<String> edgeKeys = new TreeSet<>(); edgeKeys.addAll(baseEdges.keySet()); edgeKeys.addAll(headEdges.keySet());
        List<ReviewResponse.ReviewRelationship> relationships = new ArrayList<>();
        for (String key : edgeKeys) {
            List<EdgeFact> left = new ArrayList<>(baseEdges.getOrDefault(key, List.of()));
            List<EdgeFact> right = new ArrayList<>(headEdges.getOrDefault(key, List.of()));
            int pair = Math.min(left.size(), right.size());
            for (int i = 0; i < pair; i++) relationships.add(new ReviewResponse.ReviewRelationship(opaque("relationship", key + "#" + i), "UNCHANGED", left.get(i).graph(), right.get(i).graph()));
            for (int i = pair; i < left.size(); i++) relationships.add(new ReviewResponse.ReviewRelationship(opaque("relationship", key + "#old" + i), "REMOVED", left.get(i).graph(), null));
            for (int i = pair; i < right.size(); i++) relationships.add(new ReviewResponse.ReviewRelationship(opaque("relationship", key + "#new" + i), "ADDED", null, right.get(i).graph()));
        }
        return new Comparison(List.copyOf(nodes), List.copyOf(relationships));
    }

    private Map<String, NodeFact> nodes(String snapshot, List<ReviewResponse.ReviewDiagnostic> diagnostics, String side) {
        Map<String, GraphNode> graph = new HashMap<>(); for (GraphNode n : graphs.getGraph(snapshot).nodes()) graph.put(n.id(), n);
        List<NodeFact> facts = db.query("SELECT sv.id,sv.kind,sv.qualified_name,COALESCE(sv.signature,''),f.relative_path,e.snippet,e.start_line,e.end_line " +
                        "FROM symbol_versions sv LEFT JOIN symbol_evidence se ON se.symbol_version_id=sv.id LEFT JOIN evidence e ON e.id=se.evidence_id LEFT JOIN source_file_versions f ON f.id=e.source_file_version_id WHERE sv.snapshot_id=? ORDER BY sv.id,e.id",
                // qualified_name already contains callable parameter types; excluding modifiers/return type keeps a declaration match honest across signature edits.
                (rs,n) -> new NodeFact(graph.get(rs.getString(1)), rs.getString(2)+"|"+rs.getString(3)+"|"+Objects.toString(rs.getString(5), ""), rs.getString(5), rs.getString(6), rs.getInt(7), rs.getInt(8)), snapshot);
        Map<String, List<NodeFact>> grouped = new HashMap<>();
        for (NodeFact fact : facts) if (fact.graph() != null) grouped.computeIfAbsent(fact.identity(), k -> new ArrayList<>()).add(fact);
        Map<String, NodeFact> result = new HashMap<>();
        for (var entry : grouped.entrySet()) {
            if (entry.getValue().size() != 1) diagnostics.add(new ReviewResponse.ReviewDiagnostic("WARNING", "AMBIGUOUS_DECLARATION_" + side, "A declaration identity is ambiguous and is shown as separate review resources."));
            for (int i = 0; i < entry.getValue().size(); i++) {
                // Ambiguous declarations are deliberately never paired across captures by an arbitrary row index.
                result.put(entry.getKey() + (entry.getValue().size() == 1 ? "" : "#" + side.toLowerCase(Locale.ROOT) + "-" + i), entry.getValue().get(i));
            }
        }
        return result;
    }

    private Map<String, LineCounts> counts(String snapshot, Collection<NodeFact> facts, Map<String, List<GitReviewSourceAdapter.Hunk>> hunks, boolean old) {
        Map<String, LineCounts> result = new HashMap<>();
        Map<String, Set<String>> packageFiles = packageFiles(snapshot);
        for (NodeFact fact : facts) {
            if (fact.graph().kind().name().equals("PACKAGE")) {
                int add = 0, remove = 0;
                for (String path : packageFiles.getOrDefault(fact.graph().qualifiedName(), Set.of())) for (GitReviewSourceAdapter.Hunk h : hunks.getOrDefault(path, List.of())) {
                    add += h.newCount(); remove += h.oldCount();
                }
                result.put(fact.identity(), old ? new LineCounts(0, remove) : new LineCounts(add, 0));
                continue;
            }
            if (fact.path() == null || fact.start() == 0) continue;
            int add = 0, remove = 0;
            for (GitReviewSourceAdapter.Hunk h : hunks.getOrDefault(fact.path(), List.of())) {
                add += overlap(fact.start(), fact.end(), h.newStart(), h.newCount());
                remove += overlap(fact.start(), fact.end(), h.oldStart(), h.oldCount());
            }
            result.put(fact.identity(), old ? new LineCounts(0, remove) : new LineCounts(add, 0));
        }
        return result;
    }
    /** Package membership comes from parser symbols and evidence, including default packages and comments/annotations. */
    private Map<String, Set<String>> packageFiles(String snapshot) {
        Map<String, Set<String>> result = new HashMap<>();
        db.query("WITH RECURSIVE ancestry(subject_id,id,parent_symbol_id,kind,qualified_name) AS (" +
                        " SELECT id,id,parent_symbol_id,kind,qualified_name FROM symbol_versions WHERE snapshot_id=?" +
                        " UNION ALL SELECT child.subject_id,parent.id,parent.parent_symbol_id,parent.kind,parent.qualified_name" +
                        " FROM symbol_versions parent JOIN ancestry child ON child.parent_symbol_id=parent.id" +
                        " WHERE parent.snapshot_id=?" +
                        ") SELECT DISTINCT f.relative_path, ancestry.qualified_name" +
                        " FROM ancestry JOIN symbol_evidence se ON se.symbol_version_id=ancestry.subject_id" +
                        " JOIN evidence e ON e.id=se.evidence_id JOIN source_file_versions f ON f.id=e.source_file_version_id" +
                        " WHERE ancestry.kind='PACKAGE' AND f.snapshot_id=?",
                (RowCallbackHandler) rs -> result.computeIfAbsent(rs.getString(2), ignored -> new TreeSet<>()).add(rs.getString(1)), snapshot, snapshot, snapshot);
        return result;
    }
    private static int overlap(int start, int end, int otherStart, int count) { if (count == 0) return 0; return Math.max(0, Math.min(end, otherStart + count - 1) - Math.max(start, otherStart) + 1); }
    private record LineCounts(int added, int removed) { static final LineCounts ZERO = new LineCounts(0, 0); }

    private Map<String, List<EdgeFact>> edges(String snapshot, Map<String, NodeFact> nodes, List<ReviewResponse.ReviewDiagnostic> diagnostics, String side, Map<String, List<GitReviewSourceAdapter.Hunk>> hunks) {
        Map<String, String> idToIdentity = new HashMap<>(); nodes.forEach((key, value) -> idToIdentity.put(value.graph().id(), key));
        Map<String, GraphEdge> graph = new HashMap<>(); for (GraphEdge e : graphs.getGraph(snapshot).edges()) graph.put(e.id(), e);
        Map<String, List<String>> snippets = new HashMap<>();
        Set<String> changedSites = new HashSet<>();
        Map<String, String> locations = new HashMap<>();
        db.query("SELECT re.relationship_id,e.snippet,f.relative_path,e.start_line,e.end_line,e.start_column FROM relationship_evidence re " +
                "JOIN evidence e ON e.id=re.evidence_id JOIN source_file_versions f ON f.id=e.source_file_version_id " +
                "JOIN relationship_occurrences r ON r.id=re.relationship_id WHERE r.snapshot_id=? ORDER BY f.relative_path,e.start_line,e.start_column",
                (RowCallbackHandler) rs -> {
                    String id = rs.getString(1), path = rs.getString(3);
                    int start = rs.getInt(4), end = rs.getInt(5);
                    snippets.computeIfAbsent(id, k -> new ArrayList<>()).add(Objects.toString(rs.getString(2), ""));
                    locations.putIfAbsent(id, path + "\u0000" + String.format(Locale.ROOT, "%010d:%010d", start, rs.getInt(6)));
                    for (var h : hunks.getOrDefault(path, List.of())) {
                        if (overlap(start, end, side.equals("BASE") ? h.oldStart() : h.newStart(),
                                side.equals("BASE") ? h.oldCount() : h.newCount()) > 0) changedSites.add(id);
                    }
                }, snapshot);
        Map<String, List<EdgeFact>> result = new HashMap<>();
        for (GraphEdge edge : graph.values()) {
            String source = idToIdentity.get(edge.sourceId()), target = idToIdentity.get(edge.targetId());
            if (source == null || target == null) { diagnostics.add(new ReviewResponse.ReviewDiagnostic("WARNING", "PARTIAL_RELATIONSHIP_" + side, "A relationship has an unavailable declaration identity.")); continue; }
            List<String> evidence = new ArrayList<>(snippets.getOrDefault(edge.id(), List.of())); Collections.sort(evidence);
            String identity = source + "->" + target + "|" + edge.kind() + "|" + edge.resolution() + "|" + evidence.stream().map(text -> text.length() + ":" + text).collect(java.util.stream.Collectors.joining());
            result.computeIfAbsent(identity, k -> new ArrayList<>()).add(new EdgeFact(edge, identity, changedSites.contains(edge.id()), locations.getOrDefault(edge.id(), "")));
        }
        result.values().forEach(list -> list.sort(Comparator.comparing(EdgeFact::changedSite).thenComparing(EdgeFact::location).thenComparing(e -> e.graph().id())));
        return result;
    }
    private List<ReviewResponse.ReviewDiagnostic> snapshotDiagnostics(String snapshot, String side) {
        String json = db.queryForObject("SELECT diagnostics FROM snapshots WHERE id=?", String.class, snapshot);
        List<ReviewResponse.ReviewDiagnostic> result = new ArrayList<>();
        try {
            if (json != null) {
                var warnings = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json).path("warnings");
                if (warnings.isArray()) for (var warning : warnings) if (warning.isTextual() && !warning.asText().isBlank()) {
                    result.add(new ReviewResponse.ReviewDiagnostic("WARNING", "ANALYSIS_WARNING_" + side, warning.asText()));
                }
            }
        } catch (Exception e) {
            result.add(new ReviewResponse.ReviewDiagnostic("WARNING", "ANALYSIS_DIAGNOSTICS_UNAVAILABLE_" + side,
                    "Captured analysis diagnostics could not be decoded."));
        }
        Integer unresolved = db.queryForObject("SELECT COUNT(*) FROM relationship_occurrences WHERE snapshot_id=? AND (target_symbol_id IS NULL OR resolution != 'RESOLVED')", Integer.class, snapshot);
        if (unresolved != null && unresolved > 0) result.add(new ReviewResponse.ReviewDiagnostic("WARNING", "UNRESOLVED_RELATIONSHIPS_" + side,
                unresolved + " relationship occurrence" + (unresolved == 1 ? " is" : "s are") + " unresolved or provisional."));
        return List.copyOf(result);
    }
    private static String opaque(String type, String value) {
        try { return type + ":" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))).substring(0, 24); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
