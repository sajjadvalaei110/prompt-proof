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
export function projectGraph(graph: AtlasGraph, level: Level, scope: string | null, kind: string, limit = Infinity) {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  let nodes = graph.nodes.filter(n => level === 'PACKAGE' ? n.kind === 'PACKAGE' : level === 'CLASS' ? isType(n) : ['METHOD', 'CONSTRUCTOR'].includes(n.kind));
  if (scope) {
    const seeds = new Set<string>();
    nodes.forEach(n => {
      let current: AtlasNode | undefined = n;
      while (current) { if (current.id === scope) { seeds.add(n.id); break; } current = current.parentId ? all.get(current.parentId) : undefined; }
    });
    const neighborhood = new Set(seeds);
    for (const e of graph.edges) {
      const from = all.get(e.sourceId), to = e.targetId ? all.get(e.targetId) : undefined;
      const a = from && ownerAt(from, level, all), b = to && ownerAt(to, level, all);
      if (a && b && (seeds.has(a.id) || seeds.has(b.id))) { neighborhood.add(a.id); neighborhood.add(b.id); }
    }
    nodes = nodes.filter(n => neighborhood.has(n.id)).sort((a,b) => Number(seeds.has(b.id))-Number(seeds.has(a.id)) || a.simpleName.localeCompare(b.simpleName));
  } else {
    const degree = new Map<string,number>();
    graph.edges.forEach(e => { for(const id of [e.sourceId,e.targetId]) { const n=id && all.get(id); const owner=n && ownerAt(n,level,all);if(owner)degree.set(owner.id,(degree.get(owner.id)||0)+1); } });
    nodes.sort((a,b)=>(degree.get(b.id)||0)-(degree.get(a.id)||0)||a.simpleName.localeCompare(b.simpleName));
  }
  const total = nodes.length;
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
  return { nodes, edges: [...grouped.values()], omitted: total-nodes.length };
}
