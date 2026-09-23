import { AtlasGraph, AtlasNode, AtlasEdge, projectDisplayed } from './graphModel';
import { ScopeSelection, isNodeInScope } from './scopeModel';
import { ExplorerViewState, PlacementDims } from './explorerViewState';
import { defaultCardSize } from './nodeCard';
import { Box, boxOfCard, containerBox, placeMissingChildren } from './expansionLayout';
import type { Point } from './graphPlacement';

export interface JourneyGeometry {
  positions: Record<string, Point>;
  boxes: Record<string, Box>;
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
): JourneyGeometry {
  const level = view.activeLevel, levelView = view.levelViews[level];
  const expansionInput = {
    expansions: Object.entries(levelView.expansions).map(([id, e]) => ({ id, ownerId: e.ownerId })),
    scope,
  };
  const displayed = projectedInput || projectDisplayed(graph, level, displayedIdsInput ?? levelView.displayedIds, kind, expansionInput);
  const positions: Record<string, Point> = { ...levelView.positions }, boxes: Record<string, Box> = {};
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
    const box = containerBox(childBoxes, levelView.expansions[n.id]?.minSize || null);
    if (box) boxes[n.id] = box;
  }
  return { positions, boxes, projected: displayed };
}

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
