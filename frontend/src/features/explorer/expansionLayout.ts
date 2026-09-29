/**
 * Pure geometry for cards expanded in place (Cytoscape compound nodes). No React/Cytoscape/DOM or
 * graph-model imports: callers pass card sizes (nodeCard.ts owns them) and stored positions.
 *
 * An expanded card's box is never stored. Like Cytoscape, it is derived from its children's bounds
 * plus CONTAINER_PADDING on every side, widened to a user-resized minimum toward the right and
 * bottom (GraphCanvas sets the matching min-width/min-height biases).
 */
import type { Point } from './graphPlacement';

/** Space between a container's border and its children; also the header band for its label and collapse button. */
export const CONTAINER_PADDING = 44;
/** The collapse square inside an expanded card's top-right corner, in model pixels. */
export const CONTAINER_BUTTON = { inset: 6, size: 32 };
const GAP = 32;
const MAX_COLUMNS = 4;

export interface ChildCard { id: string; width: number; height: number }
export interface PlacedCard extends ChildCard { x: number; y: number }
export interface Box { x1: number; y1: number; x2: number; y2: number }
export interface Size { width: number; height: number }

export const boxOfCard = (c: PlacedCard): Box => ({ x1: c.x - c.width / 2, y1: c.y - c.height / 2, x2: c.x + c.width / 2, y2: c.y + c.height / 2 });

/**
 * Grid positions (card centers) for `cards` in their given order, for a container whose top-left
 * corner is `topLeft`: a near-square grid of at most four columns, each row as tall as its tallest card.
 */
export function layoutChildren(topLeft: Point, cards: ChildCard[]): Record<string, Point> {
  const positions: Record<string, Point> = {};
  if (!cards.length) return positions;
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(cards.length))));
  const cell = Math.max(...cards.map(c => c.width));
  let y = topLeft.y + CONTAINER_PADDING;
  for (let row = 0; row * columns < cards.length; row++) {
    const inRow = cards.slice(row * columns, (row + 1) * columns);
    inRow.forEach((c, i) => { positions[c.id] = { x: topLeft.x + CONTAINER_PADDING + i * (cell + GAP) + c.width / 2, y: y + c.height / 2 }; });
    y += Math.max(...inRow.map(c => c.height)) + GAP;
  }
  return positions;
}

/**
 * Positions for children that have none yet (e.g. a class added to scope while its package is
 * expanded): a grid below the children already placed, so none of them move. With nothing placed,
 * the grid starts at the container's `topLeft`.
 */
export function placeMissingChildren(topLeft: Point, placed: PlacedCard[], missing: ChildCard[]): Record<string, Point> {
  if (!placed.length) return layoutChildren(topLeft, missing);
  const left = Math.min(...placed.map(c => c.x - c.width / 2));
  const bottom = Math.max(...placed.map(c => c.y + c.height / 2));
  return layoutChildren({ x: left - CONTAINER_PADDING, y: bottom + GAP - CONTAINER_PADDING }, missing);
}

/**
 * An expanded card's box around its children's boxes; null when it has no children to wrap.
 * `minSize` is the inner (padding-free) minimum, as Cytoscape's min-width/min-height take it.
 * A `hidden` (ungrouped, ADR 0011) box draws nothing, so it is exactly its children's bounds.
 */
export function containerBox(children: Box[], minSize: Size | null, hidden = false): Box | null {
  if (!children.length) return null;
  if (hidden) return { x1: Math.min(...children.map(b => b.x1)), y1: Math.min(...children.map(b => b.y1)), x2: Math.max(...children.map(b => b.x2)), y2: Math.max(...children.map(b => b.y2)) };
  const x1 = Math.min(...children.map(b => b.x1)) - CONTAINER_PADDING, y1 = Math.min(...children.map(b => b.y1)) - CONTAINER_PADDING;
  const x2 = Math.max(...children.map(b => b.x2)) + CONTAINER_PADDING, y2 = Math.max(...children.map(b => b.y2)) + CONTAINER_PADDING;
  return { x1, y1, x2: Math.max(x2, x1 + (minSize?.width ?? 0) + 2 * CONTAINER_PADDING), y2: Math.max(y2, y1 + (minSize?.height ?? 0) + 2 * CONTAINER_PADDING) };
}

/**
 * How far each of a card's siblings moves when that card's box changes from `before` to `after` (an
 * expand or a collapse): everything whose left edge is at or past the old right edge shifts by the
 * width change, and everything whose top edge is at or past the old bottom edge shifts by the height
 * change. That per-sibling rule alone is not enough on its own: two siblings can independently
 * qualify for different amounts of shift on the same axis (one shifted, one not, or shifted by a
 * different axis) and, since only one of them moves, a large collapse can pull the moving one back
 * into the row-mate or column-mate that stayed still — see docs/evidence/card-expansion for the
 * concrete case. So each axis is clamped in a second pass: a sibling that is not shifted on an axis
 * (dx or dy staying 0) acts as a wall for any other sibling that overlaps it on the other axis after
 * its own shift on that axis is applied — a shifted sibling's leading edge cannot cross that wall's
 * trailing edge, and its trailing edge cannot cross the wall's leading edge. Two siblings that both
 * shift by the same amount on an axis keep their original separation on it, so they never need
 * clamping against each other. Returns one `Point | null` per input sibling, in order; null means
 * that sibling stays put.
 */
export function roomShifts(siblings: Box[], before: Box, after: Box): (Point | null)[] {
  const eps = 0.5;
  const n = siblings.length;
  const dx = siblings.map(b => (b.x1 >= before.x2 - eps ? after.x2 - before.x2 : 0));
  const dy = siblings.map(b => (b.y1 >= before.y2 - eps ? after.y2 - before.y2 : 0));
  const overlapsOn = (delta: number[], axis: 'x' | 'y') => (i: number, j: number) => {
    const lo = axis === 'x' ? 'x1' : 'y1', hi = axis === 'x' ? 'x2' : 'y2';
    const ai = siblings[i][lo] + delta[i], ah = siblings[i][hi] + delta[i];
    const bi = siblings[j][lo] + delta[j], bh = siblings[j][hi] + delta[j];
    return ai < bh && bi < ah;
  };
  const clampAxis = (moving: number[], fixed: number[], lo: 'x1' | 'y1', hi: 'x2' | 'y2', overlapsOtherAxis: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      if (moving[i] === 0) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || fixed[j] !== 0 || !overlapsOtherAxis(i, j)) continue;
        // A wall only constrains a sibling moving toward it: an unshifted card on the FAR side (the
        // one the moving card is heading away from) is not in its path and must not clamp it -- that
        // was the actual bug, not just "any unshifted overlapping card" (an unrelated stationary
        // sibling on the wrong side collapsed unrelated cards onto it during an ordinary expand).
        if (moving[i] < 0) { if (siblings[j][hi] > siblings[i][lo] + eps) continue; const floor = siblings[j][hi] - siblings[i][lo]; if (moving[i] < floor) moving[i] = floor; }
        else { if (siblings[j][lo] < siblings[i][hi] - eps) continue; const ceil = siblings[j][lo] - siblings[i][hi]; if (moving[i] > ceil) moving[i] = ceil; }
      }
    }
  };
  // dx is clamped against dx=0 siblings that overlap in y (after dy, which dx never affects).
  clampAxis(dx, dx, 'x1', 'x2', overlapsOn(dy, 'y'));
  // dy is clamped against dy=0 siblings that overlap in x, using dx already clamped above.
  clampAxis(dy, dy, 'y1', 'y2', overlapsOn(dx, 'x'));
  return siblings.map((_, i) => (dx[i] || dy[i] ? { x: dx[i], y: dy[i] } : null));
}

/** One drawn card for `roomMoves`: its current box and stored center, and where it sits. */
export interface RoomCard {
  id: string;
  /** The expanded card it is drawn inside, or null on the map itself. */
  containerId: string | null;
  expanded?: boolean;
  /** An ungrouped box (ADR 0011): its children stand as free cards in its place. */
  hidden?: boolean;
  box: Box;
  /** Stored center; a card without one (derived by the renderer) is not moved. */
  position?: Point;
  /** An expanded card's user-resized inner minimum. */
  minSize?: Size | null;
}

/**
 * The moves that make room when card `id`'s box changes from `before` to `after` (expand, collapse,
 * resize): its siblings shift by `roomShifts`, carrying whatever they contain, and when it sits in an
 * expanded box that box's resulting change makes room around it in turn, up to the map itself.
 *
 * An ungrouped (hidden) box is looked through, never used: its children count as siblings of the
 * cards around the box, and the cascade continues at the nearest visible container. Its own bounds
 * span wherever its children were dragged, so using them would shove cards that are nowhere near.
 * Moves are returned by owner: `positions` for cards on the map, `childPositions[container]` for
 * cards inside an expanded box (a freed child is stored under its hidden parent).
 */
export function roomMoves(cards: RoomCard[], id: string, before: Box, after: Box): { positions: Record<string, Point>; childPositions: Record<string, Record<string, Point>> } {
  const byId = new Map<string, RoomCard>(), byContainer = new Map<string | null, RoomCard[]>();
  for (const k of cards) {
    byId.set(k.id, k);
    const list = byContainer.get(k.containerId);
    if (list) list.push(k); else byContainer.set(k.containerId, [k]);
  }
  const kidsOf = (c: string | null) => byContainer.get(c) || [];
  // A container's cards with every hidden box replaced by its own cards, recursively.
  const layer = (c: string | null): RoomCard[] => kidsOf(c).flatMap(k => (k.hidden ? layer(k.id) : [k]));
  const visibleContainer = (c: string | null) => { while (c !== null && byId.get(c)?.hidden) c = byId.get(c)!.containerId; return c; };
  const moves = { positions: {} as Record<string, Point>, childPositions: {} as Record<string, Record<string, Point>> };
  const translate = (k: RoomCard, d: Point) => {
    if (k.position) {
      const q = { x: k.position.x + d.x, y: k.position.y + d.y };
      if (k.containerId !== null) (moves.childPositions[k.containerId] ??= {})[k.id] = q; else moves.positions[k.id] = q;
    }
    if (k.expanded) for (const inner of kidsOf(k.id)) translate(inner, d);
  };
  const start = byId.get(id);
  if (!start) return moves;
  for (let current = start.id, parent = visibleContainer(start.containerId); ;) {
    // Siblings shift together (roomShifts), not independently: a sibling that qualifies for a shift
    // is clamped against any row/column-mate that does not, so a large collapse can never pull it
    // back across one that stayed put (F-01).
    const siblings = layer(parent).filter(k => k.id !== current);
    const boxes = siblings.map(k => k.box);
    const shifts = roomShifts(boxes, before, after);
    const shifted = new Map<string, Box>();
    siblings.forEach((sibling, i) => {
      const d = shifts[i];
      if (d) { translate(sibling, d); const b = boxes[i]; shifted.set(sibling.id, { x1: b.x1 + d.x, y1: b.y1 + d.y, x2: b.x2 + d.x, y2: b.y2 + d.y }); }
    });
    const container = parent === null ? undefined : byId.get(parent);
    if (!container) return moves;
    const containerBefore = container.box;
    const nextAfter = containerBox(layer(container.id).map(k => (k.id === current ? after : shifted.get(k.id) || k.box)), container.minSize || null);
    if (!nextAfter) return moves;
    // The container's own box did not change, so nothing further up the hierarchy can have changed
    // either: stop the cascade here instead of walking every remaining ancestor (F-11).
    const unchanged = Math.abs(nextAfter.x1 - containerBefore.x1) < 0.5 && Math.abs(nextAfter.y1 - containerBefore.y1) < 0.5 && Math.abs(nextAfter.x2 - containerBefore.x2) < 0.5 && Math.abs(nextAfter.y2 - containerBefore.y2) < 0.5;
    if (unchanged) return moves;
    before = containerBefore; after = nextAfter; current = container.id; parent = visibleContainer(container.containerId);
  }
}
