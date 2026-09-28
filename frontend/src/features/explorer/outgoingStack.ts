import { AtlasGraph, AtlasNode, Level, isType, ownerAt } from './graphModel';

/** A drawn card: `containerId` is the expanded card it sits in (projectDisplayed's output). */
export interface StackCard { id: string; containerId?: string }
/** A drawn route: aggregated among the displayed cards; `occurrenceIds` are the raw edges it carries. */
export interface StackRoute { id: string; occurrenceIds?: string[] }
/** 'out' follows what the root sets in motion; 'in' walks every fact reversed (what leads to it). */
export type StackDirection = 'out' | 'in';
export interface OutgoingStackInput {
  /** The full graph the tab renders (ordinary or Changes): its raw edges are the facts walked. */
  graph: AtlasGraph;
  /** projectDisplayed's nodes and edges for the same graph. */
  cards: readonly StackCard[];
  routes: readonly StackRoute[];
  rootId: string;
  /** The relationship-kind filter: 'ALL' or one edge kind. */
  kind: string;
  /** 'out' (default) or 'in': the incoming stack, the exact mirror over reversed facts. */
  direction?: StackDirection;
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
  /** Distinct entities a chain entity leads to that have no drawn card (so the chain stops there). */
  beyond: number;
}

/** The line shown on the root's button tooltip and in its inspector:
 * "Outgoing stack: N layers · M resources" ("Incoming stack: ..." for 'in'), plus
 * " · K beyond the map" when K > 0. */
export function stackSummary(stack: Pick<OutgoingStack, 'depth' | 'count'> & { beyond?: number }, direction: StackDirection = 'out'): string {
  const beyond = stack.beyond ? ` · ${stack.beyond} beyond the map` : '';
  return `${direction === 'in' ? 'Incoming' : 'Outgoing'} stack: ${stack.depth} ${stack.depth === 1 ? 'layer' : 'layers'} · ${stack.count} ${stack.count === 1 ? 'resource' : 'resources'}${beyond}`;
}

/** The granularity a root walks at: its own kind (a field is never a card, so it has none). */
const granularityOf = (root: AtlasNode): Level | null =>
  root.kind === 'PACKAGE' ? 'PACKAGE' : root.kind === 'METHOD' || root.kind === 'CONSTRUCTOR' ? 'METHOD' : isType(root) ? 'CLASS' : null;

/** Facts from a method that reach a type itself (not one of its methods) at method granularity. */
const TYPE_TARGET_KINDS = new Set(['CONSTRUCTS', 'CALLS', 'USES_TYPE']);
/** The whole root set and the root's containers are one card for the walk's step cost. */
const ROOT_CARD = '\u0000root';

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
 *    class-level facts). An entity self-loop (u === v) is not walked.
 * 2. Method granularity only:
 *    - a CONSTRUCTS, CALLS or USES_TYPE fact whose target is a type itself reaches that type as a
 *      terminal entity: it is placed like any entity, but has no outgoing steps, since a type has
 *      no method-level facts;
 *    - an OVERRIDES fact (implementation -> overridden method) is walked reversed, from the
 *      overridden method to its implementation (dispatch).
 *    At class and package granularity OVERRIDES is an ordinary forward fact.
 * 3. An entity's representative card is its own card when drawn (even as an expanded box), else the
 *    nearest drawn ancestor on its parentId chain (the collapsed card that contains it). An entity
 *    with no drawn representative (out of scope, not on the page) is not walked through; each
 *    distinct such entity reached by a kept step from a chain entity counts in `beyond`.
 * 4. The root entity is the root card. The root set (layer 0) is the root card plus every drawn
 *    card inside it.
 * 5. Distances come from a 0-1 BFS from the root entity. A step costs 0 when both entities have the
 *    same representative card, counting the root set and the root's containers as one card, and 1
 *    otherwise: a card hop. A drawn card's raw layer is the minimum distance over the entities it
 *    represents. Cards in the root set and containers of the root never get a layer. The raw layers
 *    are then ranked densely (1, 2, 3, ...), so a badge number is never skipped even when a card
 *    is re-entered later by a longer path.
 * 6. Drawn cards inside a layered expanded box are covered (`coveredIds`).
 * 7. A drawn route is a chain route iff one of its `occurrenceIds` is a kept edge whose mapped
 *    source and target entities are both in the chain (the root entity or reached). A self-loop of
 *    a chain entity counts here, so routes inside an expanded root stay lit.
 * 8. `depth` is the maximum card layer and `count` the number of layered cards. Returns null when
 *    the root card is not drawn (or is not a package, type or method). `direction: 'in'` (the
 *    incoming stack) reverses every mapped step after rules 1-2: an exact mirror, so a type root
 *    reaches its implementors and subclasses, a method root's callers are reached through the
 *    overridden method (impl <- interface method <- its callers), and terminal types never appear.
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
  const cardKey = (entity: string) => { const c = repOf(entity); return c && (rootSet.has(c) || rootAncestors.has(c)) ? ROOT_CARD : c; };

  // Kept fact steps by raw edge id, oriented for the walk.
  const steps = new Map<string, [string, string]>();
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && kind !== e.kind) || e.reviewChange === 'REMOVED') continue;
    const s = ownerOf(e.sourceId);
    let t = ownerOf(e.targetId);
    if (!t && level === 'METHOD' && TYPE_TARGET_KINDS.has(e.kind)) { const target = all.get(e.targetId); if (target && isType(target)) t = target.id; }
    if (!s || !t) continue;
    const [from, to] = level === 'METHOD' && e.kind === 'OVERRIDES' ? [t, s] : [s, t];
    const [u, v] = direction === 'out' ? [from, to] : [to, from];
    steps.set(e.id, [u, v]);
    if (u === v) continue;
    const list = next.get(u); if (list) list.push(v); else next.set(u, [v]);
  }

  // 0-1 BFS: a deque as a front stack plus a back queue; stale entries are skipped on pop.
  const distance = new Map<string, number>([[rootId, 0]]);
  const beyond = new Set<string>();
  const front: [string, number][] = [], back: [string, number][] = [[rootId, 0]];
  let head = 0;
  while (front.length || head < back.length) {
    const [u, d] = front.length ? front.pop()! : back[head++];
    if (d > distance.get(u)!) continue;
    for (const v of next.get(u) || []) {
      if (!repOf(v)) { beyond.add(v); continue; }
      const dv = d + (cardKey(u) === cardKey(v) ? 0 : 1);
      const known = distance.get(v);
      if (known !== undefined && known <= dv) continue;
      distance.set(v, dv);
      (dv === d ? front : back).push([v, dv]);
    }
  }

  const raw = new Map<string, number>();
  for (const [entity, d] of distance) {
    const card = repOf(entity);
    if (!card || cardKey(entity) === ROOT_CARD) continue;
    if (!raw.has(card) || d < raw.get(card)!) raw.set(card, d);
  }
  const rank = new Map([...new Set(raw.values())].sort((a, b) => a - b).map((d, i) => [d, i + 1]));
  const layers = new Map([...raw].map(([card, d]) => [card, rank.get(d)!]));
  const coveredIds = new Set<string>();
  for (const id of displayed) {
    if (layers.has(id) || rootSet.has(id)) continue;
    for (let c = containerOf.get(id); c; c = containerOf.get(c)) if (layers.has(c)) { coveredIds.add(id); break; }
  }
  const chainStep = (edgeId: string) => { const step = steps.get(edgeId); return !!step && distance.has(step[0]) && distance.has(step[1]); };
  const chainEdgeIds = new Set(routes.filter(r => (r.occurrenceIds || []).some(chainStep)).map(r => r.id));
  return { layers, rootSet, coveredIds, chainEdgeIds, depth: rank.size, count: layers.size, beyond: beyond.size };
}
