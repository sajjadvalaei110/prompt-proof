import { AtlasGraph, AtlasNode, Level, isType, ownerAt } from './graphModel';

/** A drawn card: `containerId` is the expanded card it sits in (projectDisplayed's output). */
export interface StackCard { id: string; containerId?: string }
/** A drawn route: aggregated among the displayed cards; `occurrenceIds` are the raw edges it carries. */
export interface StackRoute { id: string; occurrenceIds?: string[] }
export interface OutgoingStackInput {
  /** The full graph the tab renders (ordinary or Changes): its raw edges are the facts walked. */
  graph: AtlasGraph;
  /** projectDisplayed's nodes and edges for the same graph. */
  cards: readonly StackCard[];
  routes: readonly StackRoute[];
  rootId: string;
  /** The relationship-kind filter: 'ALL' or one edge kind. */
  kind: string;
  /** Only 'out' is wired to the UI; 'in' walks every fact reversed. */
  direction?: 'out' | 'in';
}
export interface OutgoingStack {
  /** Every drawn card that represents a reached entity, with its layer (1-based; see outgoingStack). */
  layers: Map<string, number>;
  /** Layer 0: the root card and every drawn card inside it. These get no badge. */
  rootSet: Set<string>;
  /** Drawn cards inside a layered expanded box (and not layered or in the root set themselves):
   * part of the chain, so not muted, but without a badge. */
  coveredIds: Set<string>;
  /** Drawn routes carrying at least one fact step between two chain entities. */
  chainEdgeIds: Set<string>;
  /** Deepest card layer, 0 for an empty stack. */
  depth: number;
  /** Number of layered cards; the root set is not counted. */
  count: number;
}

/** The line shown on the root's button tooltip and in its inspector: "Outgoing stack: N layers · M resources". */
export function stackSummary(stack: Pick<OutgoingStack, 'depth' | 'count'>): string {
  return `Outgoing stack: ${stack.depth} ${stack.depth === 1 ? 'layer' : 'layers'} · ${stack.count} ${stack.count === 1 ? 'resource' : 'resources'}`;
}

/** The granularity a root walks at: its own kind (a field is never a card, so it has none). */
const granularityOf = (root: AtlasNode): Level | null =>
  root.kind === 'PACKAGE' ? 'PACKAGE' : root.kind === 'METHOD' || root.kind === 'CONSTRUCTOR' ? 'METHOD' : isType(root) ? 'CLASS' : null;

/**
 * The outgoing relation stack (docs/OUTGOING_STACK.md §Traversal). The walk runs over parser
 * relationship FACTS (the graph's raw edges), at the granularity of the root's kind, and is then
 * mapped onto the drawn cards. A collapsed card is therefore never a hub that joins unrelated
 * relations of different members.
 *
 * 1. Entities are nodes at the root's granularity: packages for a package root, types for a type
 *    root, methods/constructors for a method or constructor root. Each raw edge is kept unless its
 *    target is null, the kind filter excludes it (`kind !== 'ALL' && kind !== edge.kind`), or it is
 *    `reviewChange === 'REMOVED'`. Both endpoints map to their owner at the granularity
 *    (`ownerAt`); an edge with an endpoint that has no owner is dropped (so a method root ignores
 *    class-level facts and facts that target a class). An entity self-loop (u === v) is not walked.
 * 2. An entity's representative card is its own card when drawn (even as an expanded box), else the
 *    nearest drawn ancestor on its parentId chain (the collapsed card that contains it). An entity
 *    with no drawn representative (out of scope, not on the page) is not walked through.
 * 3. The root entity is the root card. The root set (layer 0) is the root card plus every drawn
 *    card inside it.
 * 4. Breadth-first from the root entity; an entity's distance is the first one it is reached at.
 *    A drawn card's layer is the minimum distance over the entities it represents. Cards in the
 *    root set and ancestors of the root card never get a layer, though the walk continues through
 *    the entities they represent (so layers can skip a number in that rare case).
 * 5. Drawn cards inside a layered expanded box are covered (`coveredIds`).
 * 6. A drawn route is a chain route iff one of its `occurrenceIds` is a kept edge whose mapped
 *    source and target entities are both in the chain (the root entity or reached). A self-loop of
 *    a chain entity counts here, so routes inside an expanded root stay lit.
 * 7. `depth` is the maximum card layer and `count` the number of layered cards. Returns null when
 *    the root card is not drawn (or is not a package, type or method). `direction: 'in'` reverses
 *    every mapped edge.
 *
 * Pure; O(nodes + edges) with memoized owner and representative lookups.
 */
export function outgoingStack({ graph, cards, routes, rootId, kind, direction = 'out' }: OutgoingStackInput): OutgoingStack | null {
  const displayed = new Set(cards.map(c => c.id));
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const root = all.get(rootId);
  const level = root && granularityOf(root);
  if (!level || !displayed.has(rootId)) return null;

  const containerOf = new Map(cards.filter(c => c.containerId).map(c => [c.id, c.containerId!]));
  const inside = (id: string, container: string) => { for (let c: string | undefined = id; c; c = containerOf.get(c)) if (c === container) return true; return false; };
  const rootSet = new Set([...displayed].filter(id => inside(id, rootId)));
  const rootAncestors = new Set<string>();
  for (let c = containerOf.get(rootId); c; c = containerOf.get(c)) rootAncestors.add(c);

  const owners = new Map<string, string | null>();
  const ownerOf = (id: string) => {
    if (!owners.has(id)) { const n = all.get(id); owners.set(id, (n && ownerAt(n, level, all)?.id) ?? null); }
    return owners.get(id)!;
  };
  const reps = new Map<string, string | null>();
  const repOf = (id: string): string | null => {
    const cached = reps.get(id);
    if (cached !== undefined) return cached;
    const path: string[] = [];
    let found: string | null = null;
    for (let c: AtlasNode | undefined = all.get(id), seen = new Set<string>(); c && !seen.has(c.id); c = c.parentId ? all.get(c.parentId) : undefined) {
      seen.add(c.id);
      const known = reps.get(c.id);
      if (known !== undefined) { found = known; break; }
      path.push(c.id);
      if (displayed.has(c.id)) { found = c.id; break; }
    }
    for (const p of path) reps.set(p, found);
    return found;
  };

  // Kept fact steps by raw edge id, oriented for the walk.
  const steps = new Map<string, [string, string]>();
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && kind !== e.kind) || e.reviewChange === 'REMOVED') continue;
    const s = ownerOf(e.sourceId), t = ownerOf(e.targetId);
    if (!s || !t) continue;
    const [u, v] = direction === 'out' ? [s, t] : [t, s];
    steps.set(e.id, [u, v]);
    if (u === v) continue;
    const list = next.get(u); if (list) list.push(v); else next.set(u, [v]);
  }

  const distance = new Map<string, number>([[rootId, 0]]);
  for (let frontier = [rootId], d = 1; frontier.length; d++) {
    const reached: string[] = [];
    for (const u of frontier) for (const v of next.get(u) || []) {
      if (distance.has(v) || !repOf(v)) continue;
      distance.set(v, d); reached.push(v);
    }
    frontier = reached;
  }

  const layers = new Map<string, number>();
  for (const [entity, d] of distance) {
    const card = repOf(entity);
    if (!card || d === 0 || rootSet.has(card) || rootAncestors.has(card)) continue;
    if (!layers.has(card) || d < layers.get(card)!) layers.set(card, d);
  }
  const coveredIds = new Set<string>();
  for (const id of displayed) {
    if (layers.has(id) || rootSet.has(id)) continue;
    for (let c = containerOf.get(id); c; c = containerOf.get(c)) if (layers.has(c)) { coveredIds.add(id); break; }
  }
  const chainStep = (edgeId: string) => { const step = steps.get(edgeId); return !!step && distance.has(step[0]) && distance.has(step[1]); };
  const chainEdgeIds = new Set(routes.filter(r => (r.occurrenceIds || []).some(chainStep)).map(r => r.id));
  let depth = 0;
  for (const d of layers.values()) depth = Math.max(depth, d);
  return { layers, rootSet, coveredIds, chainEdgeIds, depth, count: layers.size };
}
