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
/**
 * Projects the full graph onto one level, restricted to the given scope. Membership is decided
 * purely by scope (see scopeModel.ts): a focused/selected node never pulls in out-of-scope
 * neighbors here. `limit` only bounds how many in-scope nodes render; it never changes membership,
 * so callers can distinguish scopedCount (in scope), visibleCount (rendered) and omittedCount.
 */
export function projectGraph(graph: AtlasGraph, level: Level, scope: ScopeSelection, kind: string, limit = Infinity) {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const candidates = graph.nodes.filter(n => level === 'PACKAGE' ? n.kind === 'PACKAGE' : level === 'CLASS' ? isType(n) : ['METHOD', 'CONSTRUCTOR'].includes(n.kind));
  let nodes = candidates.filter(n => isNodeInScope(n, scope, graph));
  const degree = new Map<string,number>();
  graph.edges.forEach(e => { for(const id of [e.sourceId,e.targetId]) { const n=id && all.get(id); const owner=n && ownerAt(n,level,all);if(owner)degree.set(owner.id,(degree.get(owner.id)||0)+1); } });
  nodes.sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0)||a.simpleName.localeCompare(b.simpleName));
  const scopedCount = nodes.length;
  nodes = nodes.slice(0,limit).map(n => {
    const members = graph.nodes.filter(m=>m.parentId===n.id);
    const pkg = ownerAt(n,'PACKAGE',all);
    return {...n, memberNames:members.slice(0,3).map(m=>m.simpleName), memberCount:members.length, packageName:pkg?.qualifiedName};
  });
  const visible = new Set(nodes.map(n => n.id));
  const grouped = new Map<string, AtlasEdge>();
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && kind !== e.kind)) continue;
    const from = all.get(e.sourceId), to = all.get(e.targetId);
    if (!from || !to) continue;
    const source = ownerAt(from, level, all), target = ownerAt(to, level, all);
    if (!source || !target || !visible.has(source.id) || !visible.has(target.id)) continue;
    if (source.id === target.id && level !== 'METHOD') continue;
    const key = JSON.stringify([source.id, target.id, e.kind, e.resolution]);
    const group = grouped.get(key);
    if (group) { group.occurrenceIds!.push(e.id); group.occurrenceCount!++; if(e.explanationStatus!=='READY') group.explanationStatus='NOT_REQUESTED'; }
    else grouped.set(key, { ...e, id: `aggregate:${key}`, sourceId: source.id, targetId: target.id, occurrenceIds: [e.id], occurrenceCount: 1 });
  }
  return { nodes, edges: [...grouped.values()], scopedCount, visibleCount: nodes.length, omittedCount: scopedCount-nodes.length };
}
