/**
 * Splits viewer lines into spans from data, not syntax (ADR 0013). A token is clickable only because
 * an occurrence row from the snapshot's indexing engine covers it; find matches and the jump target
 * are further ranges over the same text. Nothing here knows a language: no identifier rules,
 * comments, string literals or file extensions.
 *
 * Coordinates: occurrence rows use the evidence convention (1-based line and start column, inclusive
 * end column) in UTF-16 code units; spans use 0-based, end-exclusive offsets into the line string.
 */

/** One entry of the occurrences payload's per-file symbol table (`definitions` 0 = resolved outside the workspace). Engine symbol keys never leave the server. */
export interface OccurrenceSymbol { definitions: number; displayName?: string | null }
/** One resolved name in the file (1-based, inclusive end column). `symbol` indexes the symbol table. */
export interface Occurrence { line: number; startColumn: number; endLine: number; endColumn: number; symbol: number; definition: boolean }
export interface FileOccurrences {
  status: 'indexed' | 'not_indexed' | 'no_file';
  indexer?: string | null;
  indexerLabel?: string | null;
  navigationIndexers?: string[];
  symbols: OccurrenceSymbol[];
  occurrences: Occurrence[];
  truncated: boolean;
  total: number;
}
/** An occurrence clipped to one line: 0-based, end-exclusive. */
export interface LineOccurrence { start: number; end: number; occurrence: Occurrence }
/** A highlighted range on one line (find match, the current match, or the jump target). */
export interface LineMark { start: number; end: number; kind: 'match' | 'active' | 'target' }
export interface Segment { text: string; start: number; occurrence?: Occurrence; match?: boolean; active?: boolean; target?: boolean }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Normalizes the `GET /files/occurrences` payload. Rows arrive as compact arrays
 * `[line, startColumn, endLine, endColumn, symbolIndex, isDefinition]`; malformed rows and rows naming
 * a missing symbol are dropped rather than trusted.
 */
export function decodeOccurrences(payload: any): FileOccurrences {
  const status = payload?.status === 'indexed' || payload?.status === 'no_file' ? payload.status : 'not_indexed';
  const symbols: OccurrenceSymbol[] = Array.isArray(payload?.symbols) ? payload.symbols.map((s: any) => ({
    definitions: finite(s?.definitions) ? s.definitions : 0,
    displayName: typeof s?.displayName === 'string' ? s.displayName : null })) : [];
  const occurrences: Occurrence[] = [];
  for (const row of Array.isArray(payload?.occurrences) ? payload.occurrences : []) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [line, startColumn, endLine, endColumn, symbol, definition] = row;
    if (![line, startColumn, endLine, endColumn, symbol].every(finite)) continue;
    if (line < 1 || startColumn < 1 || endLine < line || (endLine === line && endColumn < startColumn)) continue;
    if (symbol < 0 || symbol >= symbols.length) continue;
    occurrences.push({ line, startColumn, endLine, endColumn, symbol, definition: !!definition });
  }
  return {
    status, symbols, occurrences,
    indexer: typeof payload?.indexer === 'string' ? payload.indexer : null,
    indexerLabel: typeof payload?.indexerLabel === 'string' ? payload.indexerLabel : null,
    navigationIndexers: Array.isArray(payload?.navigationIndexers) ? payload.navigationIndexers.filter((x: unknown) => typeof x === 'string') : [],
    truncated: !!payload?.truncated,
    total: finite(payload?.total) ? payload.total : occurrences.length,
  };
}

/**
 * Occurrences per 1-based line, clipped to each line they cross. `lineLengths` bounds the result to
 * lines the shown text actually has, so a stale index (older than the text) cannot add lines or
 * ranges past a line's end.
 */
export function occurrencesByLine(occurrences: readonly Occurrence[], lineLengths: readonly number[]): Map<number, LineOccurrence[]> {
  const byLine = new Map<number, LineOccurrence[]>();
  for (const occurrence of occurrences) {
    const last = Math.min(occurrence.endLine, lineLengths.length);
    for (let line = occurrence.line; line <= last; line++) {
      const length = lineLengths[line - 1];
      const start = line === occurrence.line ? occurrence.startColumn - 1 : 0;
      const end = line === occurrence.endLine ? occurrence.endColumn : length;
      const clippedStart = Math.min(Math.max(0, start), length), clippedEnd = Math.min(Math.max(0, end), length);
      if (clippedEnd <= clippedStart) continue;
      let list = byLine.get(line);
      if (!list) { list = []; byLine.set(line, list); }
      list.push({ start: clippedStart, end: clippedEnd, occurrence });
    }
  }
  return byLine;
}

/** Moves an offset that would split a surrogate pair to the pair's end. */
function safeCut(text: string, offset: number): number {
  if (offset <= 0 || offset >= text.length) return Math.min(Math.max(offset, 0), text.length);
  const before = text.charCodeAt(offset - 1), at = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff ? offset + 1 : offset;
}

/**
 * Splits one line into spans at every occurrence and mark boundary. Each span carries the innermost
 * (shortest) occurrence covering it -- the same rule the definition endpoint uses -- and the marks
 * covering it. Adjacent spans with the same attributes are merged; a line with no ranges is one span.
 */
export function lineSegments(text: string, occurrences: readonly LineOccurrence[] = [], marks: readonly LineMark[] = []): Segment[] {
  if (!occurrences.length && !marks.length) return [{ text, start: 0 }];
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...occurrences, ...marks]) { cuts.add(safeCut(text, r.start)); cuts.add(safeCut(text, r.end)); }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (b <= a) continue;
    let inner: LineOccurrence | undefined;
    for (const r of occurrences) if (r.start <= a && r.end >= b && (!inner || r.end - r.start < inner.end - inner.start)) inner = r;
    const segment: Segment = { text: text.slice(a, b), start: a };
    if (inner) segment.occurrence = inner.occurrence;
    for (const m of marks) {
      if (m.start > a || m.end < b) continue;
      if (m.kind === 'match') segment.match = true;
      else if (m.kind === 'active') { segment.match = true; segment.active = true; }
      else segment.target = true;
    }
    const prev = segments[segments.length - 1];
    if (prev && prev.occurrence === segment.occurrence && !!prev.match === !!segment.match && !!prev.active === !!segment.active && !!prev.target === !!segment.target) prev.text += segment.text;
    else segments.push(segment);
  }
  return segments.length ? segments : [{ text, start: 0 }];
}

/** The occurrence a click at a 0-based offset on a 1-based line lands on (innermost wins), or null. */
export function occurrenceAt(byLine: Map<number, LineOccurrence[]>, line: number, offset: number): Occurrence | null {
  let inner: LineOccurrence | null = null;
  for (const r of byLine.get(line) || []) if (r.start <= offset && offset < r.end && (!inner || r.end - r.start < inner.end - inner.start)) inner = r;
  return inner?.occurrence ?? null;
}

/**
 * The hint shown when a snapshot's engine provides no navigation. It names the engine and the
 * engines that do, from the server's data -- never from a language or engine name known here.
 */
export function navigationHint(data: Pick<FileOccurrences, 'indexer' | 'indexerLabel' | 'navigationIndexers'>): string {
  const label = data.indexerLabel || data.indexer || 'unknown';
  const others = data.navigationIndexers || [];
  return `This snapshot's indexer (${label}) doesn't provide go to definition; `
    + (others.length ? `engines that do: ${others.join(', ')}.` : 'no engine for this language does yet.');
}
