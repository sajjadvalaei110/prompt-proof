import { ScopeSelection, isNodeInScope } from './scopeModel';
export interface AtlasNode { id: string; simpleName: string; qualifiedName?: string; kind: string; parentId?: string; roles?: string[]; responsibilitySummary?: string; explanationStatus?: string; memberNames?: string[]; memberCount?: number; packageName?: string }
export interface AtlasEdge { id: string; sourceId: string; targetId: string | null; kind: string; resolution: string; descriptiveLabel?: string; occurrenceCount?: number; occurrenceIds?: string[]; hoverSummary?: string; explanationStatus?: string }
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
 */
export function rankEligibleIds(graph: AtlasGraph, level: Level, ids: string[]): string[] {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const degree = new Map<string, number>();
  graph.edges.forEach(e => { for (const id of [e.sourceId, e.targetId]) { const n = id && all.get(id); const owner = n && ownerAt(n, level, all); if (owner) degree.set(owner.id, (degree.get(owner.id) || 0) + 1); } });
  return ids.slice().sort((a, b) => {
    const na = all.get(a), nb = all.get(b);
    return (degree.get(b) || 0) - (degree.get(a) || 0) || (na && nb ? na.simpleName.localeCompare(nb.simpleName) : 0) || a.localeCompare(b);
  });
}

function decorate(graph: AtlasGraph, all: Map<string, AtlasNode>, n: AtlasNode) {
  const members = graph.nodes.filter(m => m.parentId === n.id);
  const pkg = ownerAt(n, 'PACKAGE', all);
  return { ...n, memberNames: members.slice(0, 3).map(m => m.simpleName), memberCount: members.length, packageName: pkg?.qualifiedName };
}

/** The single occurrence-aggregation implementation: groups same (source, target, kind, resolution) edges among a displayed set into one route, respecting the relationship filter. */
function aggregateEdges(graph: AtlasGraph, level: Level, all: Map<string, AtlasNode>, displayed: Set<string>, kind: string): AtlasEdge[] {
  const grouped = new Map<string, AtlasEdge>();
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && kind !== e.kind)) continue;
    const from = all.get(e.sourceId), to = all.get(e.targetId);
    if (!from || !to) continue;
    const source = ownerAt(from, level, all), target = ownerAt(to, level, all);
    if (!source || !target || !displayed.has(source.id) || !displayed.has(target.id)) continue;
    if (source.id === target.id && level !== 'METHOD') continue;
    const key = JSON.stringify([source.id, target.id, e.kind, e.resolution]);
    const group = grouped.get(key);
    if (group) { group.occurrenceIds!.push(e.id); group.occurrenceCount!++; if (e.explanationStatus !== 'READY') group.explanationStatus = 'NOT_REQUESTED'; }
    else grouped.set(key, { ...e, id: `aggregate:${key}`, sourceId: source.id, targetId: target.id, occurrenceIds: [e.id], occurrenceCount: 1 });
  }
  return [...grouped.values()];
}

/**
 * Renders exactly the given displayed IDs — no ranking, no slicing. Displayed membership is owned
 * by the caller (explorerViewState.ts); this only decorates nodes and aggregates edges among the
 * given set, respecting the relationship filter. Order of `nodes` follows `displayedIds`, so
 * survivors keep their existing position and appended batches land after them.
 */
export function projectDisplayed(graph: AtlasGraph, level: Level, displayedIds: string[], kind: string) {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const nodes = displayedIds.map(id => all.get(id)).filter((n): n is AtlasNode => Boolean(n)).map(n => decorate(graph, all, n));
  const edges = aggregateEdges(graph, level, all, new Set(displayedIds), kind);
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
  const { nodes, edges } = projectDisplayed(graph, level, displayedIds, kind);
  return { nodes, edges, scopedCount, visibleCount: nodes.length, omittedCount: scopedCount - nodes.length };
}
