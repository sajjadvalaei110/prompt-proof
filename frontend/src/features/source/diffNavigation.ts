/**
 * Go to definition inside the Changes diff (ADR 0014), as pure data mapping. The diff's after-change (head)
 * snapshot is the one navigation is asked about: added and context rows navigate through their head line
 * number (`newNo`) whichever side the dialog is pinned to, and deleted lines (base only) are not navigable.
 * The server answers head requests from the workspace's current analysis where the file is unchanged since,
 * and says which snapshot answered. Nothing here knows a language or an engine.
 *
 * Type-only imports keep this module loadable on its own (scripts/test-diff-navigation.mjs).
 */
import type { DiffRow, SplitRow } from './fileDiff';

export const DELETED_LINES_MESSAGE = "Deleted lines aren't navigable; find in file still works here.";
export const DIFFERS_CHIP = 'Current analysis — differs from this change';

/** Where a click in a diff row navigates: a head line, a deleted line (blocked), or nothing (a blank cell). */
export type RowTarget = { line: number } | { blocked: 'deleted' } | null;

/** Unified layout: `ctx` and `add` rows navigate by their head line; `del` rows are base-only. */
export function unifiedRowTarget(row: DiffRow | undefined): RowTarget {
  if (!row) return null;
  if (row.type === 'del') return { blocked: 'deleted' };
  return row.newNo != null ? { line: row.newNo } : null;
}

/**
 * Split layout: the left column is the base side, the right the head side. A context row is the same line on
 * both sides, so its left cell navigates by the head line too; a left `del` cell is base-only; a padded (blank)
 * cell has no line at all.
 */
export function splitCellTarget(pair: SplitRow, side: 'l' | 'r'): RowTarget {
  const row = side === 'l' ? pair.left : pair.right;
  if (!row) return null;
  if (side === 'l' && row.type !== 'ctx') return { blocked: 'deleted' };
  return unifiedRowTarget(row);
}

/**
 * Lengths of the head file's lines (index = head line − 1), recovered from the diff rows, which hold every head
 * line once. Feeds `occurrencesByLine`, which clamps occurrence rows to the text actually shown.
 */
export function headLineLengths(rows: readonly DiffRow[]): number[] {
  const lengths: number[] = [];
  for (const row of rows) if (row.type !== 'del' && row.newNo != null) lengths[row.newNo - 1] = row.text.length;
  for (let i = 0; i < lengths.length; i++) if (lengths[i] == null) lengths[i] = 0;
  return lengths;
}

/** What the dialog knows about the comparison: the head snapshot and which paths changed with a usable diff. */
export interface ReviewJumpContext { headSnapshotId: string; filesByPath: Record<string, { lineCountsAvailable: boolean }> }
/** The parts of a definition location that decide where it opens. */
export interface JumpLocation { path: string; snapshotId?: string | null; differsFromChange?: boolean }
export interface JumpTarget { snapshot: string; mode: 'plain' | 'diff'; chip: boolean }

/**
 * Where a definition opens (ADR 0014, D3). The server names the snapshot: the head when its copy of the target
 * file is the text that answered (line numbers match), else the current analysis, flagged. A head file that
 * changed opens as its diff; any other opens as plain source. Without a snapshot from the server (an older
 * response), it opens where it was asked.
 */
export function jumpTarget(location: JumpLocation, requested: string, review?: ReviewJumpContext | null): JumpTarget {
  const snapshot = location.snapshotId || requested;
  const changed = !!review && snapshot === review.headSnapshotId && !!review.filesByPath[location.path]?.lineCountsAvailable;
  return { snapshot, mode: changed ? 'diff' : 'plain', chip: !!location.differsFromChange };
}

/** "via <label>" when an answer came from another snapshot than the one asked about, else null. */
export function servedFromNote(servedFrom: { snapshotId: string; label?: string | null } | null | undefined, requested: string): string | null {
  if (!servedFrom || servedFrom.snapshotId === requested) return null;
  return `Navigation from ${servedFrom.label || 'the current analysis'}`;
}
