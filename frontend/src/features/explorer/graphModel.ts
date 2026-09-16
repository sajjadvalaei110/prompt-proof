import { ScopeSelection, isNodeInScope } from './scopeModel';
export interface AtlasNode { id: string; simpleName: string; qualifiedName?: string; kind: string; parentId?: string; roles?: string[]; responsibilitySummary?: string; explanationStatus?: string; memberNames?: string[]; memberCount?: number; packageName?: string;
  /** How many cards expanding this card would show before scope: a package's types, a type's methods and constructors. */
  detailCount?: number;
  /** Set on a projected card drawn inside an expanded card: the id of that container card. */
  containerId?: string;
  /** Set on a projected card that is currently expanded into a container of its children. */
  expanded?: boolean }
export interface AtlasEdge { id: string; sourceId: string; targetId: string | null; kind: string; resolution: string; descriptiveLabel?: string; occurrenceCount?: number; occurrenceIds?: string[]; hoverSummary?: string; explanationStatus?: string;
  /** Aggregate-only (see aggregateEdges): per-occurrence kinds aligned with occurrenceIds, per-kind counts, distinct resolutions present, and the computed line width. */
  occurrenceKinds?: string[]; kindCounts?: Record<string, number>; resolutions?: string[]; strengthWidth?: number }
export interface AtlasGraph { nodes: AtlasNode[]; edges: AtlasEdge[]; metadata?: Record<string, any> }
export type Level = 'PACKAGE' | 'CLASS' | 'METHOD';
export const isType = (n: AtlasNode) => !['PACKAGE', 'METHOD', 'FIELD', 'CONSTRUCTOR'].includes(n.kind);
export function ownerAt(node: AtlasNode, level: Level, all: Map<string, AtlasNode>): AtlasNode | undefined {
  let current: AtlasNode | undefined = node;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (level === 'PACKAGE' ? current.kind === 'PACKAGE' : level === 'CLASS' ? isType(current) : current.kind === 'METHOD' || current.kind === 'CONSTRUCTOR') return current;
    current = current.parentId ? all.get(current.parentId) : undefined;
  }
}
const candidatesAt = (graph: AtlasGraph, level: Level) =>
  graph.nodes.filter(n => level === 'PACKAGE' ? n.kind === 'PACKAGE' : level === 'CLASS' ? isType(n) : ['METHOD', 'CONSTRUCTOR'].includes(n.kind));

/**
 * Every candidate at this level currently within scope — no ranking, no limit. This is the
 * eligibility boundary: a separate concept from which of those IDs are actually on the displayed
 * page (see explorerViewState.ts). Scope alone decides eligibility; a focused/selected node never
 * pulls in out-of-scope neighbors here.
 */
export function getEligibleIds(graph: AtlasGraph, level: Level, scope: ScopeSelection): string[] {
  return candidatesAt(graph, level).filter(n => isNodeInScope(n, scope, graph)).map(n => n.id);
}

/**
 * Deterministic initial-admission order for a set of eligible IDs: total degree at this level
 * (desc), then simpleName, then ID. This ranking exists only to choose which eligible IDs enter a
 * fresh batch (initial page, Show more, a scope addition) — it must never be used to reselect or
 * reorder an already-displayed page, which is why callers keep survivors in their existing order
 * and only rank the newly admitted slice.
 *
 * Degree counts only the relationships this level actually draws. An edge whose two endpoints
 * resolve to the same owner is internal to that owner and is discarded by aggregateEdges (except at
 * METHOD level, where a self-call is a real drawn route), so counting it here would rank a class
 * full of private calls above a genuinely connected one and admit it as an isolated card with no
 * lines. The condition below mirrors aggregateEdges' own skip for the un-expanded projection that
 * ranking always sees: `ownerAt` at METHOD level only ever returns a METHOD or CONSTRUCTOR, so
 * `level !== 'METHOD'` here and aggregateEdges' kind test there accept and reject the same edges.
 * In-place expansion resolves endpoints further down, but it never changes which IDs are eligible,
 * so it has no bearing on this ordering.
 */
export function rankEligibleIds(graph: AtlasGraph, level: Level, ids: string[]): string[] {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const degree = new Map<string, number>();
  graph.edges.forEach(e => {
    const from = e.sourceId ? all.get(e.sourceId) : undefined, to = e.targetId ? all.get(e.targetId) : undefined;
    const source = from && ownerAt(from, level, all), target = to && ownerAt(to, level, all);
    if (source && target && source.id === target.id && level !== 'METHOD') return;
    for (const owner of [source, target]) if (owner) degree.set(owner.id, (degree.get(owner.id) || 0) + 1);
  });
  return ids.slice().sort((a, b) => {
    const na = all.get(a), nb = all.get(b);
    return (degree.get(b) || 0) - (degree.get(a) || 0) || (na && nb ? na.simpleName.localeCompare(nb.simpleName) : 0) || a.localeCompare(b);
  });
}

/** Direct children by parent id, built once per projection rather than scanning every node per card. */
function childrenByParent(graph: AtlasGraph) {
  const out = new Map<string, AtlasNode[]>();
  for (const n of graph.nodes) if (n.parentId) { const list = out.get(n.parentId); if (list) list.push(n); else out.set(n.parentId, [n]); }
  return out;
}

/** Every type owned by each package (nested types included), indexed once per projection so a
 * package's detail count does not re-scan every node for every package card (F-08/F-09). Matches
 * childrenOf's own package rule exactly: a type belongs to the package `ownerAt` resolves to, not
 * just to a package that is its direct `parentId`. */
function typesByOwnerPackage(graph: AtlasGraph, all: Map<string, AtlasNode>): Map<string, AtlasNode[]> {
  const out = new Map<string, AtlasNode[]>();
  for (const n of graph.nodes) {
    if (!isType(n)) continue;
    const pkg = ownerAt(n, 'PACKAGE', all);
    if (!pkg) continue;
    const list = out.get(pkg.id);
    if (list) list.push(n); else out.set(pkg.id, [n]);
  }
  return out;
}

/**
 * `scope`, when given, bounds a package's `detailCount` to its in-scope types (F-09): otherwise a
 * package whose members are all filtered out of scope still shows an active details button that
 * expands into an empty box. Callers with no scope to give (e.g. `projectDisplayed` invoked without
 * an `expansion`) get the unscoped count, matching this function's behavior before scope existed.
 */
function decorate(byParent: Map<string, AtlasNode[]>, all: Map<string, AtlasNode>, packageTypes: Map<string, AtlasNode[]>, graph: AtlasGraph, n: AtlasNode, scope?: ScopeSelection) {
  const members = byParent.get(n.id) || [];
  const pkg = ownerAt(n, 'PACKAGE', all);
  // A resized card shows as many member rows as fit, so carry a few more names than the default size draws.
  // A package's detail count matches childrenOf exactly: every in-scope type it owns, nested types
  // included (not just direct children), so the count and what expanding actually shows never diverge.
  const detailCount = n.kind === 'PACKAGE'
    ? (packageTypes.get(n.id) || []).filter(m => !scope || isNodeInScope(m, scope, graph)).length
    : isType(n) ? members.filter(m => m.kind === 'METHOD' || m.kind === 'CONSTRUCTOR').length : 0;
  return { ...n, memberNames: members.slice(0, 12).map(m => m.simpleName), memberCount: members.length, detailCount, packageName: pkg?.qualifiedName };
}

/** One expanded card: `ownerId` is the container it is drawn inside, or null for a top-level card. */
export interface ExpansionSpec { id: string; ownerId: string | null }

/** Only packages and types expand: a package into its types, a type into its methods and constructors. */
export const isExpandable = (n: AtlasNode) => n.kind === 'PACKAGE' || isType(n);

const byName = (a: AtlasNode, b: AtlasNode) => a.simpleName < b.simpleName ? -1 : a.simpleName > b.simpleName ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The cards an expanded container shows, in a deterministic name order. A package holds every
 * in-scope type it owns (nested types included, side by side with their outer type, matching the
 * scope tree); a type holds its own methods and constructors.
 */
export function childrenOf(graph: AtlasGraph, container: AtlasNode, scope: ScopeSelection, all: Map<string, AtlasNode> = new Map(graph.nodes.map(n => [n.id, n]))): AtlasNode[] {
  if (container.kind === 'PACKAGE') return graph.nodes.filter(n => isType(n) && ownerAt(n, 'PACKAGE', all)?.id === container.id && isNodeInScope(n, scope, graph)).sort(byName);
  if (isType(container)) return graph.nodes.filter(n => n.parentId === container.id && (n.kind === 'METHOD' || n.kind === 'CONSTRUCTOR')).sort(byName);
  return [];
}

/** Uncertainty rank: the aggregate's representative resolution is the least certain one present, so a single candidate/unresolved occurrence keeps the whole line visibly uncertain. */
const RESOLUTION_RANK: Record<string, number> = { RESOLVED: 0, CANDIDATE: 1, UNRESOLVED: 2 };
const worseResolution = (a: string, b: string) => ((RESOLUTION_RANK[b] ?? 2) > (RESOLUTION_RANK[a] ?? 2) ? b : a);

/**
 * Aggregate explanation rank for a merged line: the highest-ranked status among its occurrences
 * wins. READY outranks everything (see aggregateEdges). Below it the *least settled* status wins,
 * so a FAILED or STALE occurrence stays visible on the line instead of being masked by an
 * unrequested sibling -- per AGENTS.md, failed and partial analysis must stay visible.
 */
const EXPLANATION_RANK: Record<string, number> = { READY: 4, FAILED: 3, STALE: 2, QUEUED: 1, NOT_REQUESTED: 0 };
const dominantExplanationStatus = (a?: string, b?: string) =>
  (EXPLANATION_RANK[b ?? ''] ?? 0) > (EXPLANATION_RANK[a ?? ''] ?? 0) ? b : a;

/** Line width for an aggregate carrying `count` occurrences: log-scaled so one call site stays readable and hundreds stay bounded. */
export const strengthWidth = (count: number) => Math.min(10, 1.2 + 1.5 * Math.log2(Math.max(1, count)));

/** Kinds in descending occurrence count (ties by name), for labels and the inspector breakdown. */
export const sortedKindCounts = (edge: AtlasEdge): [string, number][] =>
  Object.entries(edge.kindCounts || { [edge.kind]: edge.occurrenceCount || 1 }).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** "calls ×3 · injects" -- kinds by descending count, capped to `limit` kinds with a "+n" tail. */
export function kindSummary(edge: AtlasEdge, limit = Infinity) {
  const kinds = sortedKindCounts(edge);
  const shown = kinds.slice(0, limit).map(([kind, count]) => kind.toLowerCase().replaceAll('_', ' ') + (count > 1 ? ` ×${count}` : ''));
  return shown.join(' · ') + (kinds.length > limit ? ` · +${kinds.length - limit}` : '');
}

/**
 * The single occurrence-aggregation implementation: every relationship between the same ordered
 * (source, target) pair among the visible cards becomes one directed route, whatever its kind or
 * resolution, respecting the relationship filter. A→B and B→A stay two routes. The drawing is
 * merged, the data is not: `occurrenceIds`/`occurrenceKinds` keep every underlying record,
 * `kindCounts`/`resolutions` keep the breakdown, `kind` is the dominant kind and `resolution` the
 * least certain one present, and `explanationStatus` is READY when any occurrence has a ready
 * explanation (explanations are requested per occurrence, and a CALLS line almost always also carries
 * the derived DEPENDS_ON, so "every occurrence READY" would make the badge unreachable); when no
 * occurrence is READY the least settled status present wins (FAILED > STALE > QUEUED >
 * NOT_REQUESTED, see dominantExplanationStatus) so a failure is never masked by an unrequested
 * sibling. The ID keys on endpoints only, so a filter change that removes some kinds keeps the same
 * ID (thinner line) and one that removes all kinds removes the route.
 *
 * An endpoint first resolves to its owner at the page's level, which must be displayed. When that
 * owner is expanded, it resolves further down to the deepest visible card on the endpoint's own
 * ancestor chain inside it (repeating through nested expansions), so a method call inside an
 * expanded class starts at that method's card while an unexpanded class still collects it. With no
 * expansions this is exactly the plain per-level aggregation, including its edge IDs.
 */
function aggregateEdges(graph: AtlasGraph, level: Level, all: Map<string, AtlasNode>, displayed: Set<string>, kind: string, containerOf: Map<string, string>, expanded: Set<string>): AtlasEdge[] {
  const resolve = (n: AtlasNode): string | undefined => {
    const owner = ownerAt(n, level, all);
    if (!owner || !displayed.has(owner.id)) return undefined;
    let result = owner.id;
    if (!expanded.has(result)) return result;
    const chain: AtlasNode[] = [];
    for (let c: AtlasNode | undefined = n, seen = new Set<string>(); c && !seen.has(c.id); c = c.parentId ? all.get(c.parentId) : undefined) { seen.add(c.id); chain.push(c); }
    while (expanded.has(result)) {
      // The chain runs deepest-first, so the first match is the most specific visible card.
      const deeper = chain.find(c => containerOf.get(c.id) === result);
      if (!deeper) break;
      result = deeper.id;
    }
    return result;
  };
  const inside = (id: string, container: string) => { for (let c = containerOf.get(id); c; c = containerOf.get(c)) if (c === container) return true; return false; };
  const grouped = new Map<string, AtlasEdge>();
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && kind !== e.kind)) continue;
    const from = all.get(e.sourceId), to = all.get(e.targetId);
    if (!from || !to) continue;
    const source = resolve(from), target = resolve(to);
    if (!source || !target) continue;
    // Self routes only mean something between methods (recursion); a class using itself is noise.
    if (source === target && !['METHOD', 'CONSTRUCTOR'].includes(all.get(source)!.kind)) continue;
    // A card and the container it sits in are drawn nested, so a route between them has nowhere to go.
    if (source !== target && (inside(source, target) || inside(target, source))) continue;
    const key = JSON.stringify([source, target]);
    const group = grouped.get(key);
    if (group) {
      group.occurrenceIds!.push(e.id); group.occurrenceKinds!.push(e.kind); group.occurrenceCount!++;
      group.kindCounts![e.kind] = (group.kindCounts![e.kind] || 0) + 1;
      if (!group.resolutions!.includes(e.resolution)) group.resolutions!.push(e.resolution);
      group.resolution = worseResolution(group.resolution, e.resolution);
      group.explanationStatus = dominantExplanationStatus(group.explanationStatus, e.explanationStatus);
    }
    else grouped.set(key, { ...e, id: `aggregate:${key}`, sourceId: source, targetId: target, occurrenceIds: [e.id], occurrenceKinds: [e.kind], occurrenceCount: 1, kindCounts: { [e.kind]: 1 }, resolutions: [e.resolution] });
  }
  const edges = [...grouped.values()];
  for (const edge of edges) { edge.kind = sortedKindCounts(edge)[0][0]; edge.strengthWidth = strengthWidth(edge.occurrenceCount || 1); }
  return edges;
}

/**
 * Renders exactly the given displayed IDs — no ranking, no slicing. Displayed membership is owned
 * by the caller (explorerViewState.ts); this only decorates nodes and aggregates edges among the
 * given set, respecting the relationship filter. Order of `nodes` follows `displayedIds`, so
 * survivors keep their existing position and appended batches land after them.
 *
 * `expansion` adds, right after each expanded card, the children it contains (see childrenOf),
 * recursively through nested expansions. An expansion is honored only where it really sits: a
 * top-level one on a displayed card, a nested one on a card its owner actually shows.
 */
export function projectDisplayed(graph: AtlasGraph, level: Level, displayedIds: string[], kind: string, expansion?: { expansions: ExpansionSpec[]; scope: ScopeSelection }) {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const byParent = childrenByParent(graph);
  const packageTypes = typesByOwnerPackage(graph, all);
  const owners = new Map<string, string | null>((expansion?.expansions || []).map(e => [e.id, e.ownerId]));
  const containerOf = new Map<string, string>(), expanded = new Set<string>();
  const nodes: AtlasNode[] = [];
  const visit = (n: AtlasNode, containerId: string | null) => {
    const isExpanded = level !== 'METHOD' && owners.has(n.id) && owners.get(n.id) === containerId && isExpandable(n);
    nodes.push({ ...decorate(byParent, all, packageTypes, graph, n, expansion?.scope), ...(containerId ? { containerId } : {}), ...(isExpanded ? { expanded: true } : {}) });
    if (containerId) containerOf.set(n.id, containerId);
    if (!isExpanded) return;
    expanded.add(n.id);
    for (const child of childrenOf(graph, n, expansion!.scope, all)) visit(child, n.id);
  };
  for (const id of displayedIds) { const n = all.get(id); if (n) visit(n, null); }
  const edges = aggregateEdges(graph, level, all, new Set(displayedIds), kind, containerOf, expanded);
  return { nodes, edges };
}

/**
 * Projects the full graph onto one level, restricted to the given scope, ranked and sliced to
 * `limit`. Kept for callers that want a single ranked/bounded view without owning membership
 * themselves (e.g. the graph-model test suite); the active application instead owns an explicit
 * displayed-ID page (see explorerViewState.ts + projectDisplayed) so that inspecting a resource or
 * growing scope never re-ranks or re-slices an already-displayed page out from under the user.
 */
export function projectGraph(graph: AtlasGraph, level: Level, scope: ScopeSelection, kind: string, limit = Infinity) {
  const eligible = getEligibleIds(graph, level, scope);
  const scopedCount = eligible.length;
  const displayedIds = rankEligibleIds(graph, level, eligible).slice(0, limit);
  const { nodes, edges } = projectDisplayed(graph, level, displayedIds, kind, { expansions: [], scope });
  return { nodes, edges, scopedCount, visibleCount: nodes.length, omittedCount: scopedCount - nodes.length };
}
