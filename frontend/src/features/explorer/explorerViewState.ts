import { Level } from './graphModel';

/**
 * Owns inspection, active level, and per-level displayed-page membership as one small,
 * pure state machine (Appendix A / F of the stable-map plan). It does not know about
 * AtlasGraph, ScopeSelection, or Cytoscape: callers compute eligibility/ranking (see
 * graphModel.getEligibleIds / rankEligibleIds) and pass plain ID lists in. Positions,
 * camera, and edge routes are deliberately NOT tracked here yet — GraphCanvas still
 * recomputes layout and fit on every selection/topology change, so displayed IDs are
 * stable across inspection but card positions are not. That is Step 3's job.
 */

export type InspectedKind = 'NODE' | 'EDGE';

export interface LevelViewState {
  /** Stable membership for this level: survivors keep their order, appended batches land after them. */
  displayedIds: string[];
  /**
   * The eligible-ID boundary as of the last reconciliation for this level. Lets a genuinely new
   * scope admission (Appendix A2 "newlyEligible") be told apart from an ID that was already
   * eligible and simply still pending in the hidden queue (revealed only by Show more).
   */
  priorEligibleIds: string[];
  initialized: boolean;
}

export interface HistoryEntry {
  subjectId: string;
  kind: InspectedKind;
  level: Level;
}

export interface ExplorerViewState {
  activeLevel: Level;
  levelViews: Record<Level, LevelViewState>;
  inspectedSubjectId: string | null;
  inspectedKind: InspectedKind | null;
  /** Bumped on every membership-changing action; a cheap signal for effects that must not fire on inspection alone. */
  membershipRevision: number;
  /** IDs admitted by the most recent membership-changing action, for "N resources added below" feedback. */
  newlyAddedIds: string[];
  history: HistoryEntry[];
}

export type ExplorerAction =
  | { type: 'INSPECT_NODE'; id: string }
  | { type: 'INSPECT_EDGE'; id: string }
  | { type: 'CLEAR_INSPECTION' }
  /** Explicit level navigation (segmented control, View methods/classes, Explore). Admits a bounded batch of anything newly eligible since this level was last visited. */
  | { type: 'NAVIGATE_LEVEL'; level: Level; eligibleIds: string[]; batchSize: number }
  /** A scope edit (checkbox, reset, remove-from-scope) applied to the active level. `explicitClassAddId` marks a direct single-class checkbox add, which appends exactly that class rather than a ranked batch. */
  | { type: 'SCOPE_UPDATED'; eligibleIds: string[]; explicitClassAddId?: string; batchSize: number }
  /** Reveal the next batch from everything already eligible-but-undisplayed on the active level. */
  | { type: 'SHOW_MORE'; eligibleIds: string[]; batchSize: number }
  /** Pop the last inspection off history and restore it. Purely restorative: drops now-ineligible survivors but never auto-admits new eligibility (that is what NAVIGATE_LEVEL / Show more are for). */
  | { type: 'NAVIGATE_BACK'; eligibleIds: string[] }
  /** A new snapshot/workspace: reinitialize every level and populate only the given starting level. */
  | { type: 'RESET'; level: Level; eligibleIds: string[]; batchSize: number };

const HISTORY_LIMIT = 20;

function emptyLevelView(): LevelViewState {
  return { displayedIds: [], priorEligibleIds: [], initialized: false };
}

export function initExplorerViewState(level: Level = 'PACKAGE'): ExplorerViewState {
  return {
    activeLevel: level,
    levelViews: { PACKAGE: emptyLevelView(), CLASS: emptyLevelView(), METHOD: emptyLevelView() },
    inspectedSubjectId: null,
    inspectedKind: null,
    membershipRevision: 0,
    newlyAddedIds: [],
    history: [],
  };
}

/**
 * Appendix A2 membership reconciliation for one level.
 *   survivors = previous displayedIds filtered by new eligibility, keeping order
 *   newlyEligible = new eligible IDs minus the previous eligible boundary minus survivors
 *   additions = explicitAddId (if it is newly eligible), or the next `batchSize` of newlyEligible
 *   nextDisplayed = survivors followed by additions
 * `eligibleIdsRanked` must already be in initial-admission rank order; this function never
 * re-ranks or re-slices the survivors themselves, only the newly admitted slice.
 *
 * When `explicitAddId` is given, it is the caller's entire intent for this edit (a direct
 * single-class checkbox): the result is exactly that one class, or nothing if it turns out not to
 * be a valid admission here (already displayed, or not a candidate at this level at all — e.g. the
 * checkbox was toggled while a different level is active). It never silently falls back to a
 * ranked batch of unrelated classes just because the explicit target could not be honored.
 */
function reconcileLevelView(
  view: LevelViewState,
  eligibleIdsRanked: string[],
  explicitAddId: string | undefined,
  batchSize: number,
): { next: LevelViewState; added: string[]; changed: boolean } {
  const eligibleSet = new Set(eligibleIdsRanked);
  const priorEligibleSet = new Set(view.priorEligibleIds);
  const survivors = view.displayedIds.filter(id => eligibleSet.has(id));
  const survivorSet = new Set(survivors);
  const added = explicitAddId !== undefined
    ? (eligibleSet.has(explicitAddId) && !survivorSet.has(explicitAddId) ? [explicitAddId] : [])
    : eligibleIdsRanked.filter(id => !priorEligibleSet.has(id) && !survivorSet.has(id)).slice(0, Math.max(0, batchSize));
  return {
    next: { displayedIds: [...survivors, ...added], priorEligibleIds: eligibleIdsRanked, initialized: true },
    added,
    changed: added.length > 0 || survivors.length !== view.displayedIds.length,
  };
}

/**
 * Show more: reveal the next batch from everything currently eligible-but-undisplayed, regardless
 * of when it became eligible. Also drops any survivor that fell out of eligibility since the last
 * reconciliation, so this function never depends on every scope edit having already reconciled the
 * active level by the time it runs.
 */
function appendPendingBatch(view: LevelViewState, eligibleIdsRanked: string[], batchSize: number): { next: LevelViewState; added: string[]; changed: boolean } {
  const eligibleSet = new Set(eligibleIdsRanked);
  const survivors = view.displayedIds.filter(id => eligibleSet.has(id));
  const survivorSet = new Set(survivors);
  const pending = eligibleIdsRanked.filter(id => !survivorSet.has(id));
  const added = pending.slice(0, Math.max(0, batchSize));
  return {
    next: { displayedIds: [...survivors, ...added], priorEligibleIds: eligibleIdsRanked, initialized: true },
    added,
    changed: added.length > 0 || survivors.length !== view.displayedIds.length,
  };
}

function pushHistory(state: ExplorerViewState, entry: HistoryEntry | null): HistoryEntry[] {
  if (!entry) return state.history;
  const top = state.history[state.history.length - 1];
  if (top && top.subjectId === entry.subjectId && top.kind === entry.kind) return state.history;
  return [...state.history.slice(-(HISTORY_LIMIT - 1)), entry];
}

function inspect(state: ExplorerViewState, id: string, kind: InspectedKind): ExplorerViewState {
  if (state.inspectedSubjectId === id && state.inspectedKind === kind) return state;
  const previous: HistoryEntry | null = state.inspectedSubjectId
    ? { subjectId: state.inspectedSubjectId, kind: state.inspectedKind!, level: state.activeLevel }
    : null;
  return { ...state, inspectedSubjectId: id, inspectedKind: kind, history: pushHistory(state, previous) };
}

export function explorerViewReducer(state: ExplorerViewState, action: ExplorerAction): ExplorerViewState {
  switch (action.type) {
    case 'INSPECT_NODE':
      return inspect(state, action.id, 'NODE');
    case 'INSPECT_EDGE':
      return inspect(state, action.id, 'EDGE');
    case 'CLEAR_INSPECTION': {
      if (!state.inspectedSubjectId) return state;
      // Closing the inspector is a pane-visibility toggle, not a navigation: the closed subject
      // still belongs in the Back chain, so a later inspection of something else can still return
      // to it instead of skipping straight past it to whatever was inspected before that.
      const previous: HistoryEntry = { subjectId: state.inspectedSubjectId, kind: state.inspectedKind!, level: state.activeLevel };
      return { ...state, inspectedSubjectId: null, inspectedKind: null, history: pushHistory(state, previous) };
    }
    case 'NAVIGATE_LEVEL': {
      const { next, added, changed } = reconcileLevelView(state.levelViews[action.level], action.eligibleIds, undefined, action.batchSize);
      return {
        ...state,
        activeLevel: action.level,
        levelViews: { ...state.levelViews, [action.level]: next },
        newlyAddedIds: added,
        membershipRevision: changed ? state.membershipRevision + 1 : state.membershipRevision,
      };
    }
    case 'SCOPE_UPDATED': {
      const { next, added, changed } = reconcileLevelView(state.levelViews[state.activeLevel], action.eligibleIds, action.explicitClassAddId, action.batchSize);
      return {
        ...state,
        levelViews: { ...state.levelViews, [state.activeLevel]: next },
        newlyAddedIds: added,
        membershipRevision: changed ? state.membershipRevision + 1 : state.membershipRevision,
      };
    }
    case 'SHOW_MORE': {
      const { next, added, changed } = appendPendingBatch(state.levelViews[state.activeLevel], action.eligibleIds, action.batchSize);
      return {
        ...state,
        levelViews: { ...state.levelViews, [state.activeLevel]: next },
        newlyAddedIds: added,
        membershipRevision: changed ? state.membershipRevision + 1 : state.membershipRevision,
      };
    }
    case 'NAVIGATE_BACK': {
      if (!state.history.length) return state;
      const entry = state.history[state.history.length - 1];
      const { next, changed } = reconcileLevelView(state.levelViews[entry.level], action.eligibleIds, undefined, 0);
      return {
        ...state,
        activeLevel: entry.level,
        levelViews: { ...state.levelViews, [entry.level]: next },
        inspectedSubjectId: entry.subjectId,
        inspectedKind: entry.kind,
        history: state.history.slice(0, -1),
        newlyAddedIds: [],
        membershipRevision: changed ? state.membershipRevision + 1 : state.membershipRevision,
      };
    }
    case 'RESET': {
      const fresh = initExplorerViewState(action.level);
      const { next } = reconcileLevelView(fresh.levelViews[action.level], action.eligibleIds, undefined, action.batchSize);
      return { ...fresh, levelViews: { ...fresh.levelViews, [action.level]: next }, membershipRevision: 1, newlyAddedIds: next.displayedIds };
    }
    default:
      return state;
  }
}
