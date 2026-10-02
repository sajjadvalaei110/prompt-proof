import { AtlasGraph, AtlasNode, AtlasEdge, projectDisplayed } from './graphModel';
import { ScopeSelection, isNodeInScope } from './scopeModel';
import { ExplorerViewState, PlacementDims } from './explorerViewState';
import { MIN_CARD_SIZE, defaultCardSize } from './nodeCard';
import { AddArea, BlockSizes, Box, Size, boxOfCard, containerBox, designBlocks, minSizeWithSlot, placeMissingChildren } from './expansionLayout';
import type { Point } from './graphPlacement';

export interface JourneyGeometry {
  positions: Record<string, Point>;
  boxes: Record<string, Box>;
  /** Design mode only (ADR 0015, 0017): each visible expanded package/type's add blocks (its gaps, or
   * else the one reserve block), and the inner minimum that makes its drawn box hold the reserve. */
  slots: Record<string, Box[]>;
  /** Design mode only: each visible expanded package/type's empty space, for a block anywhere in it (ADR 0017). */
  areas: Record<string, AddArea>;
  slotMinSizes: Record<string, Size>;
  projected: { nodes: AtlasNode[]; edges: AtlasEdge[] };
}

/**
 * Derive the current level's card positions and compound boxes from a journey. The optional
 * projection/display list lets placement use the same geometry rules for a graph that is not the
 * active canvas graph (the parked review overlay) while still applying the target scope.
 */
export function geometryForJourney(
  graph: AtlasGraph,
  view: ExplorerViewState,
  scope: ScopeSelection,
  kind: string,
  projectedInput?: { nodes: AtlasNode[]; edges: AtlasEdge[] },
  displayedIdsInput?: string[],
  options: { designSlots?: boolean } = {},
): JourneyGeometry {
  const level = view.activeLevel, levelView = view.levelViews[level];
  const expansionInput = {
    expansions: Object.entries(levelView.expansions).map(([id, e]) => ({ id, ownerId: e.ownerId, hidden: e.hidden })),
    scope,
  };
  const displayed = projectedInput || projectDisplayed(graph, level, displayedIdsInput ?? levelView.displayedIds, kind, expansionInput);
  const positions: Record<string, Point> = { ...levelView.positions }, boxes: Record<string, Box> = {};
  const slots: Record<string, Box[]> = {}, areas: Record<string, AddArea> = {}, slotMinSizes: Record<string, Size> = {};
  const kids = new Map<string, AtlasNode[]>();
  for (const n of displayed.nodes) if (n.containerId) {
    const list = kids.get(n.containerId);
    if (list) list.push(n); else kids.set(n.containerId, [n]);
  }
  const cardSize = (n: AtlasNode) => levelView.sizes[n.id] || defaultCardSize(n);
  for (const n of displayed.nodes) {
    if (!n.expanded) continue;
    const stored = levelView.expansions[n.id]?.childPositions || {}, children = kids.get(n.id) || [];
    const size = cardSize(n), center = positions[n.id] || { x: 0, y: 0 };
    const placed = children.filter(c => stored[c.id]).map(c => ({ id: c.id, ...cardSize(c), ...stored[c.id] }));
    Object.assign(positions, stored, placeMissingChildren(
      { x: center.x - size.width / 2, y: center.y - size.height / 2 },
      placed,
      children.filter(c => !stored[c.id]).map(c => ({ id: c.id, ...cardSize(c) })),
    ));
  }
  for (const n of [...displayed.nodes].reverse()) {
    if (!n.expanded) continue;
    const childBoxes = (kids.get(n.id) || []).map(c => boxes[c.id] || boxOfCard({
      id: c.id,
      ...cardSize(c),
      ...(positions[c.id] || { x: 0, y: 0 }),
    }));
    const expansion = levelView.expansions[n.id];
    let minSize = expansion?.minSize || null;
    const slotSizes = options.designSlots && !expansion?.hidden ? addSlotSizes(n.kind) : null;
    if (slotSizes) {
      const size = cardSize(n), center = positions[n.id] || { x: 0, y: 0 };
      const { gaps, reserve, area } = designBlocks({ x: center.x - size.width / 2, y: center.y - size.height / 2 }, childBoxes, minSize, slotSizes.card, slotSizes.least);
      slots[n.id] = reserve ? [reserve] : gaps;
      if (area) areas[n.id] = area;
      // Only a reserve grows the box. An empty box is its card-sized block, or the larger size the user gave it.
      if (reserve) minSize = slotMinSizes[n.id] = childBoxes.length ? minSizeWithSlot(childBoxes, minSize, reserve) : { width: Math.max(reserve.x2 - reserve.x1, minSize?.width ?? 0), height: Math.max(reserve.y2 - reserve.y1, minSize?.height ?? 0) };
      if (!childBoxes.length && reserve) { boxes[n.id] = containerBox([reserve], minSize)!; continue; }
    }
    const box = containerBox(childBoxes, minSize, !!expansion?.hidden);
    if (box) boxes[n.id] = box;
  }
  return { positions, boxes, slots, areas, slotMinSizes, projected: displayed };
}

/**
 * What an add block holds (ADR 0015, 0017): a type in a package, a method in a type; null for anything
 * else. `card` is the card a block is created as; `least` the smallest gap that still counts as a
 * block, and the size of the reserve that grows a box with no gap left.
 */
const ADD_TYPE_KINDS = ['CLASS', 'INTERFACE', 'ENUM', 'RECORD', 'ANNOTATION'];
/** The smallest add block: the card made in it takes its shape, so it keeps room for a two-line name. */
export const DESIGN_LEAST_BLOCK: Size = { width: Math.max(MIN_CARD_SIZE.width, 220), height: Math.max(MIN_CARD_SIZE.height, 150) };
export function addSlotSizes(containerKind: string): BlockSizes | null {
  const kind = containerKind === 'PACKAGE' ? 'CLASS' : ADD_TYPE_KINDS.includes(containerKind) ? 'METHOD' : null;
  return kind ? { card: defaultCardSize({ kind } as AtlasNode), least: DESIGN_LEAST_BLOCK } : null;
}
/** Packages and types: the cards that expand in design mode even with nothing inside (ADR 0017). */
export const expandsWhenEmpty = (kind: string) => kind === 'PACKAGE' || ADD_TYPE_KINDS.includes(kind);

const unionBox = (a?: Box, b?: Box): Box | undefined => {
  if (!a) return b;
  if (!b) return a;
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
};

const displayedIdsInScope = (graph: AtlasGraph, view: ExplorerViewState, scope: ScopeSelection): string[] => {
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  return view.levelViews[view.activeLevel].displayedIds.filter(id => {
    const node = all.get(id);
    return !!node && isNodeInScope(node, scope, graph);
  });
};

/**
 * Build placement records for a membership reconciliation. `parkedGraph` is whichever graph the
 * current presentation hides: the comparison overlay in ordinary mode, or the ordinary snapshot
 * while Changes is active. Parked cards remain in the journey state even though the active
 * projection does not draw them. Their geometry therefore contributes survivor bounds, and their
 * children can enlarge a shared expanded container. Both projections are restricted to the target
 * scope before their boxes are unioned, so a scope removal cannot leave an invisible card dictating
 * where the next addition lands.
 */
export function placementForGraphs(
  graph: AtlasGraph,
  view: ExplorerViewState,
  scope: ScopeSelection,
  kind: string,
  ids: string[],
  parkedGraph?: AtlasGraph,
): Record<string, PlacementDims> {
  const primaryDisplayed = displayedIdsInScope(graph, view, scope);
  const primary = geometryForJourney(graph, view, scope, kind, undefined, primaryDisplayed);
  const parked = parkedGraph
    ? geometryForJourney(parkedGraph, view, scope, kind, undefined, displayedIdsInScope(parkedGraph, view, scope))
    : undefined;
  const primaryNodes = new Map(graph.nodes.map(n => [n.id, n]));
  const parkedNodes = parkedGraph && new Map(parkedGraph.nodes.map(n => [n.id, n]));
  const levelView = view.levelViews[view.activeLevel];
  const out: Record<string, PlacementDims> = {};
  // Include the currently displayed survivor IDs as well as the newly eligible IDs. The former can
  // include cards from the hidden graph (synthetic review-only cards in ordinary mode, or ordinary
  // unmatched cards in Changes mode); omitting them would make the reducer's survivor-bound
  // calculation blind to their parked boxes.
  const recordIds = [...new Set([...ids, ...primaryDisplayed, ...(parked ? displayedIdsInScope(parkedGraph!, view, scope) : [])])];
  for (const id of recordIds) {
    const node = primaryNodes.get(id) || parkedNodes?.get(id);
    if (!node) continue;
    const renderedBox = (source: AtlasNode | undefined, geometry: JourneyGeometry | undefined): Box | undefined => {
      if (!source || !geometry) return undefined;
      const compound = geometry.boxes[id];
      if (compound) return compound;
      const position = geometry.positions[id];
      if (!position) return undefined;
      const size = levelView.sizes[id] || defaultCardSize(source);
      return boxOfCard({ id, ...size, ...position });
    };
    // A projection may have no compound box when all of a container's children are absent on that
    // side. Fall back to the card's own rendered bounds before unioning, so the shared placement
    // path accounts for the complete occupied area from either projection.
    const box = unionBox(renderedBox(primaryNodes.get(id), primary), renderedBox(parkedNodes?.get(id), parked));
    const size = box
      ? { width: box.x2 - box.x1, height: box.y2 - box.y1 }
      : levelView.sizes[id] || defaultCardSize(node);
    const center = box
      ? { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 }
      : primary.positions[id] || parked?.positions[id];
    out[id] = { ...size, name: node.qualifiedName || node.simpleName, ...(center ? { center } : {}) };
  }
  return out;
}
