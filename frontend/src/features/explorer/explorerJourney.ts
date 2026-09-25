import { explorerViewReducer, initExplorerViewState, sameDisplayedLevelView, ExplorerAction, ExplorerViewState } from './explorerViewState';
import type { AtlasGraph } from './graphModel';
import { ScopeSelection } from './scopeModel';
import { pruneRestoredSelection } from './revalidateJourney';
/** UI state only. Graph facts, generated results and server operations never enter history. */
export interface Journey {
  view: ExplorerViewState;
  scope: ScopeSelection;
  kind: string;
  tab: string;
  search: string;
  mobilePane: string;
  // `snapshotId`/`label` are set only when the source is pinned to a specific review-comparison side
  // rather than the workspace's ordinary active snapshot (see App.tsx's openSource).
  source: { node: { id: string; ids?: string[]; simpleName?: string }; type: string; snapshotId?: string; label?: string } | null;
  treeOpen: Record<string, boolean>;
  multiIds: string[];
  mapOpen: boolean;
  fullscreen: boolean;
  navWidth: number | null;
  /** Whether this tab currently shows the Git-review overlay instead of the ordinary code map. */
  review: boolean;
  /** The comparison the review-mode state belongs to, or null before any comparison has loaded. */
  reviewKey: string | null;
  /** Monotonic bookkeeping used to invalidate review history even after the tab returns to map mode. */
  reviewTouched: boolean;
}
export interface JourneyTab {
  id: number;
  title: string;
  present: Journey;
  past: Journey[];
  future: Journey[];
  group: number | null;
  restoreVersion: number;
}
export interface ExplorerJourneys {
  tabs: JourneyTab[];
  closed: JourneyTab[];
  activeId: number;
  nextId: number;
  initial: Journey;
}
export const HISTORY_LIMIT = 200;
export function newJourney(view = initExplorerViewState()): Journey {
  return { view, scope: { mode: 'ALL', selectedPackageIds: new Set(), selectedClassIds: new Set() }, kind: 'ALL', tab: 'map', search: '', mobilePane: 'map', source: null, treeOpen: {}, multiIds: [], mapOpen: true, fullscreen: false, navWidth: null, review: false, reviewKey: null, reviewTouched: false };
}
function newTab(id: number, present: Journey): JourneyTab {
  return { id, title: `Explore ${id}`, present, past: [], future: [], group: null, restoreVersion: 0 };
}
export function initJourneys(initial = newJourney()): ExplorerJourneys {
  return { tabs: [newTab(1, initial)], closed: [], activeId: 1, nextId: 2, initial };
}
/**
 * Switches only the presentation mode of a journey. The ordinary graph and the review overlay use
 * different retained source IDs, but reviewModel aligns unambiguous declarations to the ordinary
 * graph's display IDs before projection. Keeping one view/scope/selection here means a toggle can
 * recolor and change source-inspection behavior without parking and restoring a second map layout.
 */
export function toggleJourneyReview(j: Journey, on: boolean, reviewKey: string | null): Journey {
  const nextKey = on ? reviewKey : null;
  if (j.review === on && j.reviewKey === nextKey && (!on || j.reviewTouched)) return j;
  return { ...j, review: on, reviewKey: nextKey, reviewTouched: j.reviewTouched || on };
}
export type JourneyAction =
  | { type: 'RESET'; view: ExplorerViewState }
  // `present`: the journey a new tab starts from. Omitted, NEW falls back to the very first journey
  // (pre-review behavior); ExplorerApp passes one built in the active tab's current mode (map or
  // review) so "+ New tab" opens beside it in the same mode rather than always resetting to the map.
  | { type: 'NEW'; present?: Journey }
  | { type: 'CLONE' | 'REOPEN' }
  // Undo/redo walk exploration edits only; the current selection stays in place (ADR 0009).
  // `graphFor` returns the graph a journey renders (ordinary or Changes), so selection that the
  // restored map no longer displays can be pruned exactly, children of expanded cards included.
  // Without it, pruning falls back to the view's own record of displayed cards.
  | { type: 'UNDO' | 'REDO'; graphFor?: (j: Journey) => AtlasGraph | null | undefined }
  | { type: 'SWITCH' | 'CLOSE'; id: number }
  // Every open and closed tab that ever touched review state under the old comparison is reconciled
  // against the recaptured graph and loses its undo/redo history: display IDs are derived from
  // `comparisonKey`, which is meaningless once the working tree is recaptured, so an old step could
  // never be replayed onto the new graph.
  | { type: 'REVIEW_RECAPTURED'; reviewKey: string; reviewIds?: string[]; reconcile?: (j: Journey) => Journey }
  // View-only controls stay current across undo/redo instead of creating or occupying history
  // entries. Applying the same update to every branch prevents a later semantic undo from
  // incidentally restoring an older fullscreen, minimap or button-zoom value.
  | { type: 'TRANSIENT_UPDATE'; id: number; update: (j: Journey) => Journey }
  // An update that only moves the selection (see isSelectionOnly) replaces `present` without
  // creating, occupying or merging into an undo entry, and keeps the redo branch.
  | { type: 'UPDATE'; id: number; group: number; update: (j: Journey) => Journey }
  | { type: 'INITIAL_CAMERA'; id: number; action: Extract<ExplorerAction, { type: 'SET_CAMERA' }> };

/**
 * Selection is a pointer, not an exploration edit (ADR 0009): the inspected subject, the inspector's
 * Back trail that inspecting extends, and the multi-selection. Undo/redo carries these from the
 * current present into whatever entry it restores, so history entries' own copies are never read.
 */
const SELECTION_VIEW_KEYS = ['inspectedSubjectId', 'inspectedKind', 'inspectedOccurrenceId', 'inspectedLevel', 'history'] as const;
/** Presentation that a selection gesture updates alongside the selection itself (App's `select`
 * reveals the card in the tree, clears the search that found it and shows the details pane). On
 * their own these are still exploration edits; together with a selection change they are not. */
const SELECTION_COMPANION_KEYS: (keyof Journey)[] = ['treeOpen', 'search', 'mobilePane'];

function selectionChanged(a: Journey, b: Journey): boolean {
  return a.multiIds !== b.multiIds || SELECTION_VIEW_KEYS.some(key => a.view[key] !== b.view[key]);
}
/** True when `next` differs from `prev` in the selection (plus, optionally, its companions) only. */
function isSelectionOnly(prev: Journey, next: Journey): boolean {
  if (!selectionChanged(prev, next)) return false;
  for (const key of Object.keys(next) as (keyof Journey)[]) {
    if (key === 'view' || key === 'multiIds' || SELECTION_COMPANION_KEYS.includes(key)) continue;
    if (prev[key] !== next[key]) return false;
  }
  if (prev.view === next.view) return true;
  for (const key of Object.keys(next.view) as (keyof ExplorerViewState)[]) {
    if ((SELECTION_VIEW_KEYS as readonly string[]).includes(key)) continue;
    // The "N added below" hint follows membership, which `levelViews` already compares; Back resets it.
    if (key === 'newlyAddedIds') continue;
    if (key === 'levelViews' && sameDisplayedLevelViews(prev.view.levelViews, next.view.levelViews)) continue;
    if (prev.view[key] !== next.view[key]) return false;
  }
  return true;
}
/** A Back that only refreshes `priorEligibleIds` changes nothing a user could undo. */
function sameDisplayedLevelViews(a: ExplorerViewState['levelViews'], b: ExplorerViewState['levelViews']): boolean {
  if (a === b) return true;
  const levels = Object.keys(b) as (keyof typeof b)[];
  return levels.length === Object.keys(a).length && levels.every(level => a[level] && sameDisplayedLevelView(a[level], b[level]));
}
/** `target` with the selection of `from`; `target` itself when they already agree. */
function carrySelection(target: Journey, from: Journey): Journey {
  if (!selectionChanged(target, from)) return target;
  const view = { ...target.view };
  for (const key of SELECTION_VIEW_KEYS) (view as Record<string, unknown>)[key] = from.view[key];
  return { ...target, view, multiIds: from.multiIds };
}

function touchesReview(j: Journey): boolean { return j.reviewTouched; }
function hasReviewState(t: JourneyTab): boolean { return touchesReview(t.present) || t.past.some(touchesReview) || t.future.some(touchesReview); }
/** A tab untouched by review is returned unchanged. A tab that has entered review keeps its shared
 * map state, but loses undo/redo entries that refer to the superseded comparison key. */
function resetReviewTab(t: JourneyTab, reviewKey: string, reviewIds?: string[], reconcile?: (j: Journey) => Journey): JourneyTab {
  if (!hasReviewState(t)) return t;
  const prune=(j:Journey):Journey=>reviewIds?{...j,view:explorerViewReducer(j.view,{type:'PRUNE_REVIEW_IDS',ids:reviewIds})}:j;
  // Reconciliation belongs to this atomic reducer action so a capture cannot update a stale list of
  // open tabs while silently missing recently closed review tabs. The callback only transforms the
  // current presentation; old undo/redo branches are discarded below because their IDs belong to
  // the superseded comparison.
  const current=prune(reconcile ? reconcile(t.present) : t.present);
  const present: Journey = current.review
    ? { ...current, reviewKey, source: current.source?.snapshotId ? null : current.source }
    : { ...current, reviewKey: null, source: current.source?.snapshotId ? null : current.source };
  return { ...t, present, past: [], future: [], group: null };
}
export function journeysReducer(state: ExplorerJourneys, action: JourneyAction): ExplorerJourneys {
  if (action.type === 'RESET') {
    const initial = newJourney(action.view);
    // Never reuse IDs: callbacks from a destroyed snapshot cannot edit the replacement tab.
    return { tabs: [newTab(state.nextId, initial)], closed: [], activeId: state.nextId, nextId: state.nextId + 1, initial };
  }
  const active = state.tabs.find(t => t.id === state.activeId)!;
  if (action.type === 'NEW' || action.type === 'CLONE') {
    const tab = action.type === 'NEW' ? newTab(state.nextId, action.present ?? state.initial)
      : { ...active, id: state.nextId, title: `Explore ${state.nextId} (copy)`, group: null };
    // Reducers use immutable updates, including scope Sets. Sharing unchanged history is safe.
    return { ...state, tabs: [...state.tabs, tab], activeId: tab.id, nextId: state.nextId + 1 };
  }
  if (action.type === 'SWITCH') return state.tabs.some(t => t.id === action.id) ? { ...state, activeId: action.id } : state;
  if (action.type === 'CLOSE') {
    const index = state.tabs.findIndex(t => t.id === action.id);
    if (index < 0 || state.tabs.length === 1) return state;
    const tabs = state.tabs.filter(t => t.id !== action.id);
    return { ...state, tabs, closed: [...state.closed, state.tabs[index]].slice(-10), activeId: state.activeId === action.id ? tabs[Math.min(index, tabs.length - 1)].id : state.activeId };
  }
  if (action.type === 'REOPEN') {
    const tab = state.closed.at(-1);
    return tab ? { ...state, tabs: [...state.tabs, tab], closed: state.closed.slice(0, -1), activeId: tab.id } : state;
  }
  if (action.type === 'REVIEW_RECAPTURED') {
    const resetTab = (t: JourneyTab) => resetReviewTab(t, action.reviewKey, action.reviewIds, action.reconcile);
    return { ...state, tabs: state.tabs.map(resetTab), closed: state.closed.map(resetTab) };
  }
  const id = 'id' in action ? action.id : state.activeId;
  return { ...state, tabs: state.tabs.map(t => {
    if (t.id !== id) return t;
    if (action.type === 'INITIAL_CAMERA') {
      const level = action.action.level, before = t.present.view.levelViews[level];
      const capture = (j: Journey): Journey => j.view.levelViews[level] === before
        ? { ...j, view: explorerViewReducer(j.view, action.action) } : j;
      return { ...t, present: capture(t.present), past: t.past.map(capture), future: t.future.map(capture) };
    }
    if (action.type === 'TRANSIENT_UPDATE') {
      const apply = (j: Journey) => action.update(j);
      return { ...t, present: apply(t.present), past: t.past.map(apply), future: t.future.map(apply) };
    }
    if (action.type === 'UPDATE') {
      const present = action.update(t.present);
      if (present === t.present) return t;
      // `group` is left alone: a later real edit of the same UI action still merges with whatever
      // that action already recorded, and one of a new action still pushes (carrying this selection).
      if (isSelectionOnly(t.present, present)) return { ...t, present };
      const push = t.group !== action.group;
      return { ...t, present, past: push ? [...t.past, t.present].slice(-HISTORY_LIMIT) : t.past, future: [], group: action.group };
    }
    if (action.type === 'UNDO' || action.type === 'REDO') {
      const target = action.type === 'UNDO' ? t.past.at(-1) : t.future[0];
      if (!target) return t;
      const present = pruneRestoredSelection(carrySelection(target, t.present), t.present, action.graphFor);
      return action.type === 'UNDO'
        ? { ...t, present, past: t.past.slice(0, -1), future: [t.present, ...t.future], group: null, restoreVersion: t.restoreVersion + 1 }
        : { ...t, present, past: [...t.past, t.present], future: t.future.slice(1), group: null, restoreVersion: t.restoreVersion + 1 };
    }
    return t;
  }) };
}
