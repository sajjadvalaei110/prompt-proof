import { CardBounds, AdditionCard, Point, placeAdditions, ordinal } from './graphPlacement';

/**
 * Step 5 / Appendix B: the focused-arrangement algorithm, invoked only by the dedicated
 * ARRANGE_AROUND_RESOURCE command (canvas double-click, or the inspector's keyboard/touch-
 * accessible "Arrange around this resource" action) -- never by inspection or level navigation.
 * Pure -- no React/Cytoscape/DOM imports -- so it is independently testable
 * (scripts/test-focused-arrangement.mjs) the same way graphPlacement.ts is. This module is the
 * "graphLayout.ts" file earlier steps reserved for this reuse; it was renamed because it no longer
 * has an unfocused/whole-map branch -- that remains out of scope for this step (Steps 6-9).
 *
 * incoming = visible sources of edges whose target is focus
 * outgoing = visible targets of edges whose source is focus
 * left     = incoming minus focus              (a bidirectional neighbor lands here only)
 * right    = outgoing minus incoming minus focus
 * other    = all displayed nodes minus left minus right minus focus
 *
 * A self-loop (sourceId === targetId === focusId) contributes to neither incoming nor outgoing,
 * so it never creates a second copy of the focus card.
 */

export interface ArrangeCard { id: string; width: number; height: number; qualifiedName: string }
export interface ArrangeEdge { sourceId: string; targetId: string }

/** "Horizontal distances equal the relevant half-widths plus a 96-unit clear gap" (Appendix B). */
const COLUMN_GAP = 96;
/** "Center each left/right stack vertically around focus using individual card heights and
 * 48-unit gaps" (Appendix B). */
const STACK_GAP = 48;

/** Deterministic within-group order: qualified name, then ID as a stable tie-breaker. */
function sortCards(cards: ArrangeCard[]): ArrangeCard[] {
  return [...cards].sort((a, b) => ordinal(a.qualifiedName, b.qualifiedName) || ordinal(a.id, b.id));
}

function stackColumn(cards: ArrangeCard[], x: number, centerY: number): Record<string, Point> {
  if (!cards.length) return {};
  const totalHeight = cards.reduce((sum, c) => sum + c.height, 0) + (cards.length - 1) * STACK_GAP;
  let y = centerY - totalHeight / 2;
  const positions: Record<string, Point> = {};
  for (const c of cards) {
    positions[c.id] = { x, y: y + c.height / 2 };
    y += c.height + STACK_GAP;
  }
  return positions;
}

/**
 * Computes new positions for exactly `cards` (every currently displayed card, each exactly once --
 * "Empty groups consume no fake cards", Appendix B). `edges` must already be the displayed,
 * filtered set ("Route only displayed relationships"). Returns null when `focusId` is not among
 * `cards` -- the caller (inspector action / canvas gesture) uses that to stay disabled when the
 * subject is absent from the current displayed graph (H3).
 *
 * The whole result is translated so the focus lands exactly on `anchor` (its prior model
 * coordinate): with an unchanged camera its screen anchor stays fixed, and no automatic fit is
 * needed or performed.
 */
export function arrangeAroundResource(
  cards: ArrangeCard[],
  edges: ArrangeEdge[],
  focusId: string,
  anchor: Point,
): Record<string, Point> | null {
  const focus = cards.find(c => c.id === focusId);
  if (!focus) return null;

  const incomingIds = new Set<string>(), outgoingIds = new Set<string>();
  for (const e of edges) {
    if (e.targetId === focusId && e.sourceId !== focusId) incomingIds.add(e.sourceId);
    if (e.sourceId === focusId && e.targetId !== focusId) outgoingIds.add(e.targetId);
  }
  const left = sortCards(cards.filter(c => c.id !== focusId && incomingIds.has(c.id)));
  const leftSet = new Set(left.map(c => c.id));
  const right = sortCards(cards.filter(c => c.id !== focusId && !leftSet.has(c.id) && outgoingIds.has(c.id)));
  const rightSet = new Set(right.map(c => c.id));
  const other = sortCards(cards.filter(c => c.id !== focusId && !leftSet.has(c.id) && !rightSet.has(c.id)));

  const leftMaxWidth = left.length ? Math.max(...left.map(c => c.width)) : 0;
  const rightMaxWidth = right.length ? Math.max(...right.map(c => c.width)) : 0;
  const leftX = -(focus.width / 2 + COLUMN_GAP + leftMaxWidth / 2);
  const rightX = focus.width / 2 + COLUMN_GAP + rightMaxWidth / 2;

  const positions: Record<string, Point> = { [focusId]: { x: 0, y: 0 } };
  Object.assign(positions, stackColumn(left, leftX, 0));
  Object.assign(positions, stackColumn(right, rightX, 0));

  // Unrelated cards go in rows below the tallest bottom of the three columns plus 64 units --
  // reusing graphPlacement's existing append-below-bounds packing (Appendix A3) rather than a
  // second, subtly different row-packing implementation; its ROW_TOP_GAP is exactly the 64-unit
  // constant Appendix B specifies for this same purpose.
  if (other.length) {
    const columnBounds: CardBounds[] = [{ id: focusId, x: 0, y: 0, width: focus.width, height: focus.height }];
    for (const c of left) columnBounds.push({ id: c.id, x: positions[c.id].x, y: positions[c.id].y, width: c.width, height: c.height });
    for (const c of right) columnBounds.push({ id: c.id, x: positions[c.id].x, y: positions[c.id].y, width: c.width, height: c.height });
    const additions: AdditionCard[] = other.map(c => ({ id: c.id, width: c.width, height: c.height, name: c.qualifiedName }));
    const { positions: otherPositions } = placeAdditions(columnBounds, additions, null);
    Object.assign(positions, otherPositions);
  }

  const dx = anchor.x - positions[focusId].x, dy = anchor.y - positions[focusId].y;
  const translated: Record<string, Point> = {};
  for (const id of Object.keys(positions)) translated[id] = { x: positions[id].x + dx, y: positions[id].y + dy };
  return translated;
}

/** One drawn card for `arrangeDisplayed`: where it sits, its current box and stored center. */
export interface DisplayedCard {
  id: string;
  /** The expanded card it is drawn inside, or null on the map itself. */
  containerId: string | null;
  expanded?: boolean;
  /** An ungrouped box (ADR 0011): its children stand as free cards in its place. */
  hidden?: boolean;
  qualifiedName: string;
  box: { x1: number; y1: number; x2: number; y2: number };
  /** Stored center; a card without one (derived by the renderer) is not moved. */
  position?: Point;
}

/**
 * Arranges the whole displayed map around `focusId` (any drawn card) and returns the moves by owner,
 * ready for ARRANGE_AROUND_RESOURCE, or null when the focus is not drawn.
 *
 * The cards that take part are the map's own cards, with every ungrouped (hidden) box replaced by
 * its children, recursively: a freed card arranges on its own, wherever it was dragged. A visible
 * expanded box takes part as its whole box and carries everything inside it by the same offset; a
 * card inside one arranges the map around that box, and routes count between those units. A moved
 * card is stored where it lives: on the map, or under the hidden box it was freed from.
 */
export function arrangeDisplayed(
  cards: DisplayedCard[],
  edges: ArrangeEdge[],
  focusId: string,
): { positions: Record<string, Point>; childPositions: Record<string, Record<string, Point>> } | null {
  const byId = new Map(cards.map(c => [c.id, c]));
  const onMap = (c: DisplayedCard) => { for (let o = c.containerId; o !== null; o = byId.get(o)?.containerId ?? null) if (!byId.get(o)?.hidden) return false; return true; };
  const units = cards.filter(c => !c.hidden && onMap(c));
  const unitIds = new Set(units.map(c => c.id));
  const unitOf = (id: string): string | undefined => {
    for (let c = byId.get(id); c; c = c.containerId === null ? undefined : byId.get(c.containerId)) if (unitIds.has(c.id)) return c.id;
    return undefined;
  };
  const focus = unitOf(focusId);
  if (!focus) return null;
  const centerOf = (c: DisplayedCard) => ({ x: (c.box.x1 + c.box.x2) / 2, y: (c.box.y1 + c.box.y2) / 2 });
  const arrangeCards: ArrangeCard[] = units.map(c => ({ id: c.id, width: c.box.x2 - c.box.x1, height: c.box.y2 - c.box.y1, qualifiedName: c.qualifiedName }));
  const arrangeEdges: ArrangeEdge[] = [];
  for (const e of edges) { const a = unitOf(e.sourceId), b = unitOf(e.targetId); if (a && b && a !== b) arrangeEdges.push({ sourceId: a, targetId: b }); }
  const placed = arrangeAroundResource(arrangeCards, arrangeEdges, focus, centerOf(byId.get(focus)!));
  if (!placed) return null;
  const out = { positions: {} as Record<string, Point>, childPositions: {} as Record<string, Record<string, Point>> };
  const store = (c: DisplayedCard, p: Point) => { if (c.containerId === null) out.positions[c.id] = p; else (out.childPositions[c.containerId] ??= {})[c.id] = p; };
  const insideOf = (c: DisplayedCard, unit: string) => { for (let o = c.containerId; o !== null; o = byId.get(o)?.containerId ?? null) if (o === unit) return true; return false; };
  for (const unit of units) {
    const to = placed[unit.id];
    if (!to) continue;
    // An expanded box's stored position is not its box center, so it moves by its box's offset.
    const from = centerOf(unit), dx = to.x - from.x, dy = to.y - from.y;
    store(unit, unit.expanded ? (unit.position ? { x: unit.position.x + dx, y: unit.position.y + dy } : to) : to);
    if (!unit.expanded) continue;
    for (const inner of cards) if (inner.position && insideOf(inner, unit.id)) store(inner, { x: inner.position.x + dx, y: inner.position.y + dy });
  }
  return out;
}
