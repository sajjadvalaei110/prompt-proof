/**
 * Back/forward history of the source dialog's go to definition (ADR 0013). It is dialog-local: never part
 * of a tab's undo history (like selection, ADR 0009), discarded when the dialog closes or its subject
 * changes. Each entry remembers its scroll offset so Back restores exactly the earlier view.
 */

/** What the dialog shows: the subject's evidence (its opening view) or a whole file at a jump target. */
export type NavView =
  | { kind: 'evidence' }
  | { kind: 'file'; path: string; line: number; startColumn: number; endLine: number; endColumn: number };
export interface NavEntry { view: NavView; scrollTop: number }
export interface NavStack { entries: readonly NavEntry[]; index: number }

/** Oldest entries are dropped beyond this. */
export const MAX_NAV_ENTRIES = 100;

export const initialNavStack = (): NavStack => ({ entries: [{ view: { kind: 'evidence' }, scrollTop: 0 }], index: 0 });
export const currentView = (stack: NavStack): NavView => stack.entries[stack.index].view;
export const canGoBack = (stack: NavStack) => stack.index > 0;
export const canGoForward = (stack: NavStack) => stack.index < stack.entries.length - 1;

export function sameView(a: NavView, b: NavView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'evidence' || b.kind === 'evidence') return true;
  return a.path === b.path && a.line === b.line && a.startColumn === b.startColumn && a.endLine === b.endLine && a.endColumn === b.endColumn;
}

const withScroll = (stack: NavStack, scrollTop: number): NavEntry[] =>
  stack.entries.map((entry, i) => i === stack.index ? { ...entry, scrollTop } : entry);

/**
 * Opens `view`, remembering the current entry's scroll offset. Forward entries are discarded, as in a
 * browser. Jumping to the view already shown is a no-op (no duplicate entry).
 */
export function pushView(stack: NavStack, view: NavView, scrollTop: number): NavStack {
  if (sameView(currentView(stack), view)) return stack;
  const entries = [...withScroll(stack, scrollTop).slice(0, stack.index + 1), { view, scrollTop: 0 }];
  const dropped = Math.max(0, entries.length - MAX_NAV_ENTRIES);
  return { entries: entries.slice(dropped), index: entries.length - 1 - dropped };
}

/** Steps back (-1) or forward (1), remembering the current scroll offset; unchanged at either end. */
export function stepView(stack: NavStack, dir: -1 | 1, scrollTop: number): NavStack {
  const index = stack.index + dir;
  if (index < 0 || index >= stack.entries.length) return stack;
  return { entries: withScroll(stack, scrollTop), index };
}
