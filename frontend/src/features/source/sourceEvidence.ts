/** One highlighted line range inside a file, with the relationship kinds whose evidence covers it (when known). */
export interface EvidenceRange { startLine: number; endLine: number; kinds?: string[] }
/** A source file shown once, with every evidence range that matched it. */
export interface FileEvidence { path: string; content?: string | null; exact?: boolean; ranges: EvidenceRange[] }

/**
 * Normalizes source responses into one entry per file. Accepts both shapes the API returns: flat
 * per-evidence rows (`{path, startLine, endLine, content, exact}` -- symbol and single-occurrence
 * endpoints, where one DEPENDS_ON occurrence yields one row per call site in the same file) and
 * already-grouped files (`{path, ranges}` -- the batch endpoint). Files keep first-seen order; ranges
 * are de-duplicated (merging kinds) and sorted by line. A file is stale if any of its rows says so.
 */
export function groupSourceEvidence(rows: any[]): FileEvidence[] {
  const files = new Map<string, FileEvidence>();
  for (const row of rows || []) {
    if (!row || typeof row.path !== 'string') continue;
    const ranges: EvidenceRange[] = Array.isArray(row.ranges) ? row.ranges : [{ startLine: row.startLine, endLine: row.endLine }];
    let file = files.get(row.path);
    if (!file) { file = { path: row.path, content: row.content, exact: row.exact, ranges: [] }; files.set(row.path, file); }
    if (typeof file.content !== 'string' && typeof row.content === 'string') file.content = row.content;
    if (row.exact === false) file.exact = false;
    for (const range of ranges) {
      if (!Number.isFinite(range?.startLine) || !Number.isFinite(range?.endLine)) continue;
      const existing = file.ranges.find(r => r.startLine === range.startLine && r.endLine === range.endLine);
      if (!existing) file.ranges.push({ startLine: range.startLine, endLine: range.endLine, ...(range.kinds ? { kinds: [...range.kinds] } : {}) });
      else if (range.kinds) existing.kinds = [...new Set([...(existing.kinds || []), ...range.kinds])].sort();
    }
  }
  for (const file of files.values()) file.ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return [...files.values()];
}

/** Kinds covering a 1-based line, or null when the line is not highlighted. An empty array means highlighted with unknown kinds. */
export function kindsAtLine(file: FileEvidence, line: number): string[] | null {
  let hit = false; const kinds = new Set<string>();
  for (const r of file.ranges) if (line >= r.startLine && line <= r.endLine) { hit = true; r.kinds?.forEach(k => kinds.add(k)); }
  return hit ? [...kinds].sort() : null;
}

/**
 * Every highlighted line in a file, mapped 1-based line -> covering kinds (the same value
 * `kindsAtLine` returns for that line). Built once per file, in O(ranges + highlighted lines),
 * so rendering a large file is a map lookup per line instead of a scan of every range per line --
 * a 3,000-line file with 150 ranges costs 150 range walks here rather than 450,000 comparisons.
 *
 * `lineCount` bounds the walk to lines the file actually has. Ranges come from a stored index that
 * can be older than the content it is shown against (`exact === false` is exactly that case), and
 * only finite-ness is validated upstream, so an out-of-date `endLine` must not be able to turn a
 * render into a multi-million-entry map. Lines outside the file are dropped; they cannot be drawn.
 */
export function highlightedLines(file: FileEvidence, lineCount = Infinity): Map<number, string[]> {
  const byLine = new Map<number, Set<string>>();
  for (const r of file.ranges) {
    const last = Math.min(r.endLine, lineCount);
    for (let line = Math.max(1, r.startLine); line <= last; line++) {
      let kinds = byLine.get(line);
      if (!kinds) { kinds = new Set<string>(); byLine.set(line, kinds); }
      r.kinds?.forEach(k => kinds!.add(k));
    }
  }
  return new Map([...byLine].map(([line, kinds]) => [line, [...kinds].sort()]));
}

/** "12, 30–31, 44" -- compact highlighted-range summary for a file header. */
export const rangeSummary = (file: FileEvidence) => file.ranges.map(r => r.startLine === r.endLine ? `${r.startLine}` : `${r.startLine}–${r.endLine}`).join(', ');
