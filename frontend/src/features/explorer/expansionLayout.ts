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
 * The design layer's add slot (ADR 0015): the box the next child added to an expanded card will
 * occupy. It is exactly where placeMissingChildren puts one more child, so a card created there
 * lands on the slot it was typed into. `placed` are the children as drawn now.
 */
export function designSlot(topLeft: Point, placed: PlacedCard[], slot: Size): Box {
  const id = '\u0000slot';
  const p = placeMissingChildren(topLeft, placed, [{ id, ...slot }])[id];
  return boxOfCard({ id, ...slot, ...p });
}

/**
 * Where design mode may place a new card inside an expanded box: its inner area and its children's boxes.
 * `only`: an empty box's one block (ADR 0017 round 3). A hover anywhere in it offers that block, at the
 * box's corner, whatever the pointer's place: Cytoscape derives a box from its children (min-size grows it
 * right and down only), so a first card anywhere else would move the box's corner and grow it.
 */
export interface AddArea { inner: Box; children: Box[]; only?: Box }

/**
 * The model-pixel grid a hovered add block's corner snaps to (ADR 0017, round 3): the block, its key and
 * the drawn "+" change only every few pixels of pointer travel, not on every mousemove. A block clamped
 * against a child or the box edge sits exactly on that edge instead.
 */
export const ADD_BLOCK_SNAP = 8;
const EPS = 1e-6;
const inflate = (b: Box, d: number): Box => ({ x1: b.x1 - d, y1: b.y1 - d, x2: b.x2 + d, y2: b.y2 + d });
const meets = (a: Box, b: Box) => a.x1 < b.x2 - 0.5 && b.x1 < a.x2 - 0.5 && a.y1 < b.y2 - 0.5 && b.y1 < a.y2 - 0.5;
const within = (b: Box, outer: Box) => b.x1 >= outer.x1 - 0.5 && b.y1 >= outer.y1 - 0.5 && b.x2 <= outer.x2 + 0.5 && b.y2 <= outer.y2 + 0.5;
const sameBox = (a: Box, b: Box) => Math.abs(a.x1 - b.x1) < 0.5 && Math.abs(a.y1 - b.y1) < 0.5 && Math.abs(a.x2 - b.x2) < 0.5 && Math.abs(a.y2 - b.y2) < 0.5;
/** `inner` cut down to `reach` around `p` on every side: only children near the point can matter. */
const windowAround = (inner: Box, p: Point, reach: Size): Box => ({ x1: Math.max(inner.x1, p.x - reach.width), y1: Math.max(inner.y1, p.y - reach.height), x2: Math.min(inner.x2, p.x + reach.width), y2: Math.min(inner.y2, p.y + reach.height) });

/**
 * The best empty rectangle around `p` inside `inner` that keeps GAP from every child (ADR 0017, round 3).
 * Exact, not greedy: it looks at every maximal empty rectangle that contains `p`. Each one's left edge is
 * the inner edge or a child's right edge (plus GAP), and its right edge the inner edge or a child's left
 * edge; for each such pair the children in that column bound it above and below. The best one is chosen
 * in this order:
 * 1. one where a `fit.least` block fits (both sides at least that long);
 * 2. the largest area capped at `fit.card` (the block a card is made in is never larger than a card);
 * 3. the largest raw area;
 * 4. the first found, nearest edges first, so the result never flips between equal choices.
 * Without `fit` it is the largest empty rectangle around `p`. Null when `p` is outside `inner`, on a
 * child or within GAP of one. O(n²) in the children that meet `inner`.
 */
export function freeRect(inner: Box, children: Box[], p: Point, fit?: BlockSizes): Box | null {
  if (p.x < inner.x1 || p.x > inner.x2 || p.y < inner.y1 || p.y > inner.y2) return null;
  const obstacles = children.map(c => inflate(c, GAP)).filter(g => meets(g, inner));
  if (obstacles.some(g => p.x > g.x1 && p.x < g.x2 && p.y > g.y1 && p.y < g.y2)) return null;
  const distinct = (xs: number[]) => xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > EPS);
  const lefts = distinct([inner.x1, ...obstacles.map(g => g.x2).filter(x => x > inner.x1 && x <= p.x)].sort((a, b) => b - a));
  const rights = distinct([...obstacles.map(g => g.x1).filter(x => x >= p.x && x < inner.x2), inner.x2].sort((a, b) => a - b));
  const byLeft = [...obstacles].sort((a, b) => a.x1 - b.x1);
  const score = (b: Box) => {
    const w = b.x2 - b.x1, h = b.y2 - b.y1;
    if (!fit) return [1, w * h, w * h];
    return [w >= fit.least.width - EPS && h >= fit.least.height - EPS ? 1 : 0, Math.min(w, fit.card.width) * Math.min(h, fit.card.height), w * h];
  };
  const better = (a: number[], b: number[]) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] + EPS : a[2] > b[2] + EPS;
  let best: Box | null = null, bestScore: number[] = [];
  for (const left of lefts) {
    // The children that reach right of this left edge, in the order the right edge sweeps over them.
    const live = byLeft.filter(g => g.x2 > left + 0.5);
    let top = inner.y1, bottom = inner.y2, i = 0, blocked = false;
    for (const right of rights) {
      for (; i < live.length && live[i].x1 < right - 0.5; i++) {
        const g = live[i];
        if (g.y2 <= p.y) top = Math.max(top, g.y2);
        else if (g.y1 >= p.y) bottom = Math.min(bottom, g.y1);
        else { blocked = true; break; }
      }
      // A child level with the pointer is in this column: every wider column holds it too.
      if (blocked) break;
      const b = { x1: left, y1: top, x2: right, y2: bottom }, s = score(b);
      if (!best || better(s, bestScore)) { best = b; bestScore = s; }
    }
  }
  return best;
}

/**
 * The add block under the pointer (ADR 0017): a card-sized block around `p`, shifted and shrunk to stay
 * inside the empty space around it, never smaller than `least`. Null where no such block fits. The block
 * is the exact shape the new card takes, so creating it never grows the box. Its corner snaps to `snap`
 * model pixels; where it is clamped to the free space it sits exactly on its edge, never past it (no
 * rounding after the clamp). Only the children near `p` are looked at.
 */
export function addBlockAt(a: AddArea, p: Point, card: Size, least: Size, snap = 0): Box | null {
  if (p.x < a.inner.x1 || p.x > a.inner.x2 || p.y < a.inner.y1 || p.y > a.inner.y2) return null;
  if (a.only) return { ...a.only };
  const reach = { width: Math.max(card.width, least.width), height: Math.max(card.height, least.height) };
  const win = windowAround(a.inner, p, reach);
  const free = freeRect(win, a.children.filter(c => meets(inflate(c, GAP), win)), p, { card, least });
  if (!free) return null;
  const width = Math.min(card.width, free.x2 - free.x1), height = Math.min(card.height, free.y2 - free.y1);
  if (width < least.width - EPS || height < least.height - EPS) return null;
  const place = (centre: number, size: number, lo: number, hi: number) => {
    const at = snap ? Math.round((centre - size / 2) / snap) * snap : centre - size / 2;
    return Math.min(Math.max(at, lo), hi - size);
  };
  const x1 = place(p.x, width, free.x1, free.x2), y1 = place(p.y, height, free.y1, free.y2);
  return { x1, y1, x2: Math.min(x1 + width, free.x2), y2: Math.min(y1 + height, free.y2) };
}

/**
 * Whether a hovered add block is still offered (ADR 0017): it lies inside its box's current inner area and
 * no card covers it, or it is still one of the box's fixed blocks (its reserve, or an empty box's block).
 * A block that a new card now covers, or that a moved or shrunk box left behind, is not.
 */
export function blockStillOpen(area: AddArea | undefined, slots: Box[] | undefined, b: Box): boolean {
  if (area && within(b, area.inner) && !area.children.some(c => meets(c, b))) return true;
  return (slots || []).some(s => sameBox(s, b)) && !(area?.children || []).some(c => meets(c, b));
}

/**
 * The design layer's add blocks for one expanded card (ADR 0017). `area` is where a hover may place a
 * new card anywhere empty (addBlockAt). `gaps` are top-left anchored blocks at the natural spots (the
 * inner corner, beside, below and above each child), each as large as the free space allows up to `card`
 * and at least `least`: they say there is room, and the first is where a card menu "Add …" puts its
 * card. Only when there is no gap is there a `reserve`: a `least`-sized block where the next child
 * would be placed (designSlot), which the box grows to hold. A box with no children reserves one
 * card-sized block at its top-left corner, offered wherever its inner area (larger when the user resized
 * it) is hovered. Gaps are searched on the box without the reserve, so the reserve's own row never counts
 * as a gap. Every block lies inside the box's inner area, and the new card takes the block's exact
 * shape, so a card made in a block never grows the box itself. When that card fills the last free
 * space, the box has no gap left and keeps a reserve, which does grow it (requirement 4).
 */
export function designBlocks(topLeft: Point, children: Box[], minSize: Size | null, card: Size, least: Size): { gaps: Box[]; reserve: Box | null; area: AddArea | null } {
  if (!children.length) {
    const x1 = topLeft.x + CONTAINER_PADDING, y1 = topLeft.y + CONTAINER_PADDING;
    // A full card's room: the first card fills it exactly, and the header keeps space for its label.
    // A box the user resized larger keeps that card-sized block at its corner, and a hover anywhere in it
    // offers it there (AddArea.only): the first card must keep the box's corner, or the box would move.
    const inner = { x1, y1, x2: x1 + Math.max(card.width, minSize?.width ?? 0), y2: y1 + Math.max(card.height, minSize?.height ?? 0) };
    const reserve = { x1, y1, x2: x1 + card.width, y2: y1 + card.height };
    return { gaps: [], reserve, area: { inner, children: [], only: reserve } };
  }
  const outer = containerBox(children, minSize)!;
  const inner = { x1: outer.x1 + CONTAINER_PADDING, y1: outer.y1 + CONTAINER_PADDING, x2: outer.x2 - CONTAINER_PADDING, y2: outer.y2 - CONTAINER_PADDING };
  const seen = new Set<string>(), candidates: Point[] = [];
  const add = (x: number, y: number) => { const k = `${Math.round(x)},${Math.round(y)}`; if (!seen.has(k)) { seen.add(k); candidates.push({ x, y }); } };
  add(inner.x1, inner.y1);
  for (const c of children) { add(c.x2 + GAP, c.y1); add(c.x1, c.y2 + GAP); add(inner.x1, c.y2 + GAP); add(c.x2 + GAP, inner.y1); add(c.x1, inner.y1); }
  candidates.sort((a, b) => a.y - b.y || a.x - b.x);
  const gaps: Box[] = [], fit = { card, least };
  const reach = { width: 2 * Math.max(card.width, least.width), height: 2 * Math.max(card.height, least.height) };
  for (const { x, y } of candidates) {
    if (x >= inner.x2 || y >= inner.y2) continue;
    const probe = { x: x + least.width / 2, y: y + least.height / 2 };
    const win = windowAround(inner, probe, reach);
    const near = [...children, ...gaps].filter(c => meets(inflate(c, GAP), win));
    const free = freeRect(win, near, probe, fit);
    if (!free) continue;
    // The natural spot may sit just inside a child's GAP or above the free space: the gap starts where the space does.
    const gx = Math.max(x, free.x1), gy = Math.max(y, free.y1);
    const width = Math.min(card.width, free.x2 - gx), height = Math.min(card.height, free.y2 - gy);
    if (width < least.width - EPS || height < least.height - EPS) continue;
    gaps.push({ x1: gx, y1: gy, x2: gx + width, y2: gy + height });
  }
  const area: AddArea = { inner, children };
  return gaps.length ? { gaps, reserve: null, area } : { gaps, reserve: designSlot(topLeft, children.map((b, i) => ({ id: String(i), width: b.x2 - b.x1, height: b.y2 - b.y1, x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 })), least), area };
}

/**
 * Where an expanded box with no children (design mode, ADR 0017) is drawn. Cytoscape has no compound for
 * it, so it is a plain node whose centre keeps the card's own top-left corner: `anchor` is the card's
 * stored centre, `card` its card size and `min` the box's inner size. emptyBoxAnchor is the exact inverse,
 * so a drag reads back the anchor it was drawn from and never creeps by the border.
 */
export const emptyBoxCenter = (anchor: Point, card: Size, min: Size): Point => ({ x: anchor.x - card.width / 2 + CONTAINER_PADDING + min.width / 2, y: anchor.y - card.height / 2 + CONTAINER_PADDING + min.height / 2 });
export const emptyBoxAnchor = (center: Point, card: Size, min: Size): Point => ({ x: center.x - min.width / 2 - CONTAINER_PADDING + card.width / 2, y: center.y - min.height / 2 - CONTAINER_PADDING + card.height / 2 });

/** What an expanded card's add blocks hold in design mode (ADR 0017): the card one becomes, and the smallest block. */
export interface BlockSizes { card: Size; least: Size }

/**
 * An expanded card's drawn box with design mode's reserve block (ADR 0017) when it has no gap left;
 * without `blocks` it is exactly containerBox. `topLeft` is the card's own top-left corner.
 */
export function boxWithBlocks(topLeft: Point, children: Box[], minSize: Size | null, blocks?: BlockSizes | null): Box | null {
  const reserve = blocks ? designBlocks(topLeft, children, minSize, blocks.card, blocks.least).reserve : null;
  return containerBox(reserve ? [...children, reserve] : children, minSize);
}

/**
 * The inner (padding-free) minimum that makes an expanded card's box also hold `slot`, never
 * smaller than the user's own `minSize`. Fed to the same min-width/min-height biases (right and
 * bottom) as a resize, so the box only grows right and down and no other card moves.
 */
export function minSizeWithSlot(children: Box[], minSize: Size | null, slot: Box): Size {
  const all = [...children, slot];
  const x1 = Math.min(...all.map(b => b.x1)), y1 = Math.min(...all.map(b => b.y1));
  const x2 = Math.max(...all.map(b => b.x2)), y2 = Math.max(...all.map(b => b.y2));
  return { width: Math.max(minSize?.width ?? 0, x2 - x1), height: Math.max(minSize?.height ?? 0, y2 - y1) };
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
  /** Design mode (ADR 0017): its add blocks, so a box that keeps a reserve still holds it as it grows. */
  blocks?: BlockSizes | null;
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
    const nextAfter = boxWithBlocks({ x: containerBefore.x1, y: containerBefore.y1 }, layer(container.id).map(k => (k.id === current ? after : shifted.get(k.id) || k.box)), container.minSize || null, container.blocks);
    if (!nextAfter) return moves;
    // The container's own box did not change, so nothing further up the hierarchy can have changed
    // either: stop the cascade here instead of walking every remaining ancestor (F-11).
    const unchanged = Math.abs(nextAfter.x1 - containerBefore.x1) < 0.5 && Math.abs(nextAfter.y1 - containerBefore.y1) < 0.5 && Math.abs(nextAfter.x2 - containerBefore.x2) < 0.5 && Math.abs(nextAfter.y2 - containerBefore.y2) < 0.5;
    if (unchanged) return moves;
    before = containerBefore; after = nextAfter; current = container.id; parent = visibleContainer(container.containerId);
  }
}
