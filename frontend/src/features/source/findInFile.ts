/**
 * Find in file for the read-only source viewer. Pure text matching: no language knowledge, no regex
 * input from the user (the query is always a literal), and columns in UTF-16 code units -- the same
 * units the viewer slices lines with and the occurrence index stores (ADR 0013).
 */

export interface FindOptions { matchCase: boolean; wholeWord: boolean }
/** One match: `line` is an index into the searched texts; `start`/`end` are 0-based, end-exclusive. */
export interface FindMatch { line: number; start: number; end: number }
export interface FindResult { matches: FindMatch[]; capped: boolean }

/** Matches beyond this are not collected; the viewer reports "10,000+". */
export const MAX_FIND_MATCHES = 10000;

/** A word character for "whole word": any letter, mark, number or connector punctuation in any script. */
const WORD = '[\\p{L}\\p{M}\\p{N}\\p{Pc}]';

/** Escapes the regex syntax characters (the only identity escapes valid under the `u` flag). */
const escapeLiteral = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/** The literal-query pattern, or null for an empty query. Exposed for tests. */
export function findPattern(query: string, options: FindOptions): RegExp | null {
  if (!query) return null;
  const literal = escapeLiteral(query);
  const body = options.wholeWord ? `(?<!${WORD})${literal}(?!${WORD})` : literal;
  return new RegExp(body, options.matchCase ? 'gu' : 'giu');
}

/**
 * Every non-overlapping match of `query` in `texts`, in reading order, up to `cap`. Matching is per
 * text (a query never spans lines). Case-insensitive matching uses the regex engine's Unicode simple
 * case folding, and columns come from the match itself, so they never drift from the text.
 */
export function findMatches(texts: readonly string[], query: string, options: FindOptions, cap = MAX_FIND_MATCHES): FindResult {
  const pattern = findPattern(query, options);
  const matches: FindMatch[] = [];
  if (!pattern) return { matches, capped: false };
  for (let line = 0; line < texts.length; line++) {
    const text = texts[line];
    if (!text) continue;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (matches.length >= cap) return { matches, capped: true };
      matches.push({ line, start: m.index, end: m.index + m[0].length });
    }
  }
  return { matches, capped: false };
}

/** Next (dir 1) or previous (dir -1) match index, wrapping around; -1 when there are none. */
export function stepMatch(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return dir === 1 ? 0 : count - 1;
  return (index + dir + count) % count;
}

/** "3 of 12", "No results", "1 of 10,000+". */
export function findCounter(index: number, result: FindResult, query: string): string {
  if (!query) return '';
  const total = result.matches.length;
  if (!total) return 'No results';
  const shown = `${total.toLocaleString('en-US')}${result.capped ? '+' : ''}`;
  return `${index >= 0 && index < total ? index + 1 : 0} of ${shown}`;
}
