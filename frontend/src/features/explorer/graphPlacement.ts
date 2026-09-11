/**
 * Pure Appendix A3 placement: where a newly admitted batch of cards lands, given the current
 * survivors' exact bounds. No React/Cytoscape/DOM/graph-model imports — card dimensions are
 * supplied by the caller (nodeCard.ts owns them; this module never duplicates them).
 */

export interface Point { x: number; y: number }

/** A currently placed survivor card: its stored center position plus its actual dimensions. */
export interface CardBounds { id: string; x: number; y: number; width: number; height: number }

/** A card awaiting placement in the new batch. */
export interface AdditionCard { id: string; width: number; height: number; name: string }

const H_GAP = 48;
const V_GAP = 48;
const ROW_TOP_GAP = 64;
/**
 * Room for six typical cards per row before wrapping. This is a proposed default (Appendix A3:
 * "these gaps are proposed defaults... changing defaults is allowed with measured overlap and
 * readability evidence"), deliberately wider than a naive 3-card strip so a 36-class page does not
 * grow implausibly tall. It is computed once per level from the first-ever batch and then reused
 * forever for that level -- never recomputed from total node count or on resize.
 */
const STRIP_CARDS = 6;

/** Explicit ordinal comparator -- not locale-dependent, unlike `localeCompare` (Appendix C2:
 * "Use an explicit string comparator, not locale-dependent ordering, for algorithm determinism").
 * Exported so focusedArrangement.ts (which already imports from this module) can reuse it rather
 * than defining a second copy -- the pure test harnesses concatenate both modules' compiled output
 * into one script, where two same-named top-level consts would collide. */
export const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Places `additions` in spaced rows below `survivorBounds`' bounding box. Survivors are never
 * touched; the caller is responsible for keeping their exact stored positions. Returns positions
 * for exactly the given additions plus the `appendWidth` to persist and pass back on the next call
 * (so the strip width for a level is decided once and never rederived from node count).
 */
export function placeAdditions(
  survivorBounds: CardBounds[],
  additions: AdditionCard[],
  storedAppendWidth: number | null,
): { positions: Record<string, Point>; appendWidth: number } {
  const sorted = [...additions].sort((a, b) => ordinal(a.name, b.name) || ordinal(a.id, b.id));
  const hasSurvivors = survivorBounds.length > 0;
  const bottom = hasSurvivors ? Math.max(...survivorBounds.map(c => c.y + c.height / 2)) : 0;
  const left = hasSurvivors ? Math.min(...survivorBounds.map(c => c.x - c.width / 2)) : 0;
  const typicalWidth = sorted.length ? sorted[0].width : 250;
  const appendWidth = storedAppendWidth ?? (STRIP_CARDS * typicalWidth + (STRIP_CARDS - 1) * H_GAP);

  const positions: Record<string, Point> = {};
  let rowTop = hasSurvivors ? bottom + ROW_TOP_GAP : 0;
  let cursorX = left;
  let rowHeight = 0;
  let usedInRow = 0;
  for (const card of sorted) {
    if (usedInRow > 0 && cursorX + card.width > left + appendWidth) {
      rowTop += rowHeight + V_GAP;
      cursorX = left;
      rowHeight = 0;
      usedInRow = 0;
    }
    positions[card.id] = { x: cursorX + card.width / 2, y: rowTop + card.height / 2 };
    cursorX += card.width + H_GAP;
    rowHeight = Math.max(rowHeight, card.height);
    usedInRow++;
  }
  return { positions, appendWidth };
}
