/**
 * Turns a retained pair of file snapshots plus the review comparison's `git diff --unified=0` hunks
 * into rows a source viewer can render inline (SourceDialog owns presentation; this module is pure
 * line-number arithmetic so it can be unit tested without React or Cytoscape).
 *
 * A whole file is shown -- nothing is folded -- so hunk boundaries are not marked in the row stream;
 * they only matter here to place added/removed lines at the right point and to pair del/add blocks
 * for the split layout below.
 */
export interface ReviewHunk { oldStart: number; oldCount: number; newStart: number; newCount: number }
export type DiffRowType = 'ctx' | 'add' | 'del';
export interface DiffRow { type: DiffRowType; oldNo?: number; newNo?: number; text: string }

/**
 * Builds one row per line of the resulting (unified) view, walking the new file's line numbers.
 * `oldText`/`newText` are `null` for a side that does not exist (an added or deleted file), in which
 * case every line of the other side renders as a single add/del block and `hunks` is ignored -- a
 * whole added/removed file has no partial hunks to reconcile.
 *
 * Unified-diff hunk convention: when `oldCount` is 0 (pure insertion) `oldStart` names the old line
 * *before* which the insertion happens; when `newCount` is 0 (pure deletion) `newStart` names the new
 * line *after* which the deleted lines used to sit. Both are handled by computing each hunk's anchor
 * -- the new-file line number its change block sits in front of -- rather than assuming `newStart`
 * always points at content.
 */
/** A genuinely empty file ('' -- zero bytes) has zero lines, not the one blank line `''.split('\n')`
 * would suggest; that split-artifact convention is reserved for a *non-empty* file's real trailing
 * newline (kept below so 'a\n'.split('\n') still yields a final '' line, consistent with the plain
 * source view). Collapsing it here is what keeps an emptied or newly-populated file from gaining a
 * line that was never actually there. */
const linesOf = (text: string): string[] => (text === '' ? [] : text.split('\n'));

export function buildUnifiedRows(oldText: string | null, newText: string | null, hunks: ReviewHunk[]): DiffRow[] {
  if (newText == null) return linesOf(oldText ?? '').map((text, i): DiffRow => ({ type: 'del', oldNo: i + 1, text }));
  const newLines = linesOf(newText);
  if (oldText == null) return newLines.map((text, i): DiffRow => ({ type: 'add', newNo: i + 1, text }));
  const oldLines = linesOf(oldText);
  const sorted = [...hunks].sort((a, b) => a.newStart - b.newStart);
  const rows: DiffRow[] = [];
  let newLine = 1;
  // Cumulative (newLine - oldLine) for the unchanged region the walk is currently in; updated after
  // each hunk by how much it shifted the file (added lines minus removed lines).
  let offset = 0;
  // A would-be ctx row pairs `line` with old line `line - offset`. When that computed old line falls
  // outside the old file's actual line range (notably: an old side that is empty, so it has none),
  // there is nothing on the old side to pair with -- the line is new content, not carried-over
  // context, however the walk's arithmetic alone would place it.
  const pushCtxOrAdd = (line: number): void => {
    const oldNo = line - offset;
    if (oldNo < 1 || oldNo > oldLines.length) rows.push({ type: 'add', newNo: line, text: newLines[line - 1] });
    else rows.push({ type: 'ctx', oldNo, newNo: line, text: newLines[line - 1] });
  };
  for (const hunk of sorted) {
    // The new-file line number this hunk's block sits in front of. A pure deletion (newCount 0) has
    // no new lines of its own, so its block sits right after `newStart` instead of at it.
    const anchor = hunk.newCount > 0 ? hunk.newStart : hunk.newStart + 1;
    while (newLine < anchor) { pushCtxOrAdd(newLine); newLine++; }
    for (let i = 0; i < hunk.oldCount; i++) rows.push({ type: 'del', oldNo: hunk.oldStart + i, text: oldLines[hunk.oldStart + i - 1] });
    for (let i = 0; i < hunk.newCount; i++) rows.push({ type: 'add', newNo: hunk.newStart + i, text: newLines[hunk.newStart + i - 1] });
    offset += hunk.newCount - hunk.oldCount;
    if (hunk.newCount > 0) newLine = hunk.newStart + hunk.newCount; // else newLine already sits at anchor, past nothing
  }
  while (newLine <= newLines.length) { pushCtxOrAdd(newLine); newLine++; }
  return rows;
}

export interface SplitRow { left?: DiffRow; right?: DiffRow }
/**
 * Pairs each hunk's removed lines with its added lines side by side, one row per side present.
 * `buildUnifiedRows` always emits a hunk's del block immediately followed by its add block with no
 * context row between them, so a maximal run of non-`ctx` rows is exactly one hunk's changes; the
 * longer of its two blocks decides the row count, and the shorter side pads with `undefined`
 * (rendered as a blank gutter+line by the caller).
 */
export function toSplitRows(rows: DiffRow[]): SplitRow[] {
  const result: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === 'ctx') { result.push({ left: row, right: row }); i++; continue; }
    const dels: DiffRow[] = [], adds: DiffRow[] = [];
    while (i < rows.length && rows[i].type !== 'ctx') { (rows[i].type === 'del' ? dels : adds).push(rows[i]); i++; }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) result.push({ left: dels[k], right: adds[k] });
  }
  return result;
}
