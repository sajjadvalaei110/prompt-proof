import { Level } from './graphModel';
import { placeAdditions, CardBounds, AdditionCard, Point } from './graphPlacement';

/**
 * Owns inspection, active level, per-level displayed-page membership, and (Step 3) per-level
 * geometry as one small, pure state machine (Appendix A / F of the stable-map plan). It does not
 * know about AtlasGraph, ScopeSelection, or Cytoscape: callers compute eligibility/ranking (see
 * graphModel.getEligibleIds / rankEligibleIds) and pass plain ID lists in; callers also compute
 * actual card dimensions (nodeCard.ts owns them) and pass a small per-ID `placement` record so
 * this module can place newly admitted cards without importing React/Cytoscape/DOM or duplicating
 * dimension logic. Positions/camera are committed in the SAME dispatch that admits membership --
 * there is no separate render -> effect -> reducer -> layout round trip (Appendix F2).
 */

export type InspectedKind = 'NODE' | 'EDGE';

export type { Point };
export interface Camera { zoom: number; pan: Point }
/** Actual card dimensions for one eligible ID, supplied by the caller (nodeCard.ts). Discarded
 * after use -- never stored in state, per Appendix F2 ("nodeCard.ts owns dimensions"). `center`
 * is given for an expanded card, whose drawn box is its children's bounds rather than the card at
 * its stored position, so an addition is placed below what is really on screen. */
export interface PlacementDims { width: number; height: number; name: string; center?: Point }
export interface Size { width: number; height: number }
/**
 * One card expanded in place into a container of its children. The container's own box is derived
 * from its children (Cytoscape compound node), so it stores no position of its own while expanded.
 */
export interface ExpansionState {
  /** The expanded card this one is drawn inside, or null for a card on the displayed page itself. */
  ownerId: string | null;
  /** Card-center model coordinates of the children, written on expand and by drags/arrangement. */
  childPositions: Record<string, Point>;
  /** A user-resized container's minimum box; null keeps it tight around its children. */
  minSize: Size | null;
}

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
  /** Card-center model coordinates for exactly this level's current `displayedIds`. Survivors keep
   * their exact stored value across every reconciliation; entries for removed IDs are dropped. */
  positions: Record<string, Point>;
  /** Saved camera for this level, or null before its first valid capture (Appendix A1). */
  camera: Camera | null;
  /** Bumped whenever this level's `positions` actually change (new placement or a manual drag). */
  geometryRevision: number;
  /** Bumped whenever this level's `camera` actually changes. */
  cameraRevision: number;
  /** Distinct from `initialized` (membership): true once this level has ever had card positions
   * computed. Lets the canvas tell "never visited, needs an initial one-time fit" apart from
   * "visited before, restore its saved camera" (Appendix F2). Monotonic: an empty-scope transition
   * must not reset cached geometry, so this never reverts to false except on RESET. */
  geometryInitialized: boolean;
  /** The stored row width (Appendix A3) for this level's append algorithm, decided once from the
   * first-ever batch and reused for every later batch -- never recomputed from node count. */
  appendWidth: number | null;
  /** Expanded cards on this level by card ID. An explicit user choice, like a drag, so it is kept
   * across inspection and level switches and dropped only with the card it belongs to. */
  expansions: Record<string, ExpansionState>;
  /** User-resized card sizes by card ID (top-level or inside a container). A default-sized card
   * has no entry: nodeCard.ts still owns default dimensions. */
  sizes: Record<string, Size>;
}

/** New positions for displayed cards (`positions`) and for cards inside expanded cards, by container
 * (`childPositions`), applied together in one dispatch. An ID that is not there is skipped. */
export interface CardMoves { positions: Record<string, Point>; childPositions: Record<string, Record<string, Point>> }

export interface HistoryEntry {
  /** Null for a level-only breadcrumb pushed when an explicit level change leaves a completely
   * uninspected state (Step 5 review remediation B1) -- there is no subject to restore, only the
   * level being left. Non-null entries behave exactly as before. */
  subjectId: string | null;
  kind: InspectedKind | null;
  level: Level;
  /** That level's `geometryRevision` at the moment this entry was pushed (Appendix F3). Back never
   * restores geometry from this number -- positions/camera always come from the level's current
   * live state, which already IS "the latest geometry revision for that level" (Step 4 point 5).
   * This is kept only so a transition test can assert that precedence explicitly: a later drag
   * (revision N+1) must survive a Back to an entry pushed at revision N. */
  geometryRevision: number;
}

export interface ExplorerViewState {
  activeLevel: Level;
  levelViews: Record<Level, LevelViewState>;
  inspectedSubjectId: string | null;
  inspectedKind: InspectedKind | null;
  /** The level `inspectedSubjectId` was actually inspected under (Step 5 review remediation A1).
   * Non-null exactly when `inspectedSubjectId` is non-null. `activeLevel` keeps changing under an
   * unchanged inspection (Step 4's cross-level inspection persistence), so `activeLevel` alone
   * cannot answer "what level was this subject inspected under" once the user has switched levels
   * without re-inspecting. Only INSPECT_NODE/INSPECT_EDGE/NAVIGATE_BACK write this -- NAVIGATE_LEVEL
   * must never touch it, or the whole point is lost. */
  inspectedLevel: Level | null;
  /** Bumped on every membership-changing action; a cheap signal for effects that must not fire on inspection alone. */
  membershipRevision: number;
  /** IDs admitted by the most recent membership-changing action, for "N resources added below" feedback. */
  newlyAddedIds: string[];
  history: HistoryEntry[];
  /** Bumped only by RESET (a new snapshot/workspace). A late camera/drag event stamped with a
   * stale generation is ignored, so it cannot land in a fresh snapshot's just-cleared geometry. */
  generation: number;
}

export type ExplorerAction =
  | { type: 'INSPECT_NODE'; id: string }
  | { type: 'INSPECT_EDGE'; id: string }
  | { type: 'CLEAR_INSPECTION' }
  /** Explicit level navigation (segmented control, View methods/classes, Explore). Admits a bounded batch of anything newly eligible since this level was last visited. `placement` supplies actual dimensions for every ID in `eligibleIds` (survivors included) so newly admitted cards can be placed below the current bounding box; omit it only from tests that do not exercise geometry. */
  | { type: 'NAVIGATE_LEVEL'; level: Level; eligibleIds: string[]; batchSize: number; placement?: Record<string, PlacementDims> }
  /** A scope edit (checkbox, reset, remove-from-scope) applied to the active level. `explicitClassAddId` marks a direct single-class checkbox add, which appends exactly that class rather than a ranked batch. `otherLevels` carries the fresh eligible-ID set for the levels NOT currently active (Appendix F3): a scope edit changes eligibility for every level at once, not just the one on screen, so an inactive level's cached membership must drop now-ineligible survivors immediately rather than waiting for its next visit -- otherwise a later reconciliation cannot distinguish "still eligible, never left" from "removed then re-added" (Step 4 point 8). Omitting it (e.g. existing pure tests) simply skips that bookkeeping; membership for the active level is unaffected either way. */
  | { type: 'SCOPE_UPDATED'; eligibleIds: string[]; explicitClassAddId?: string; batchSize: number; placement?: Record<string, PlacementDims>; otherLevels?: Partial<Record<Level, string[]>>; expansionChildren?: Record<string, string[]> }
  /** Reveal the next batch from everything already eligible-but-undisplayed on the active level. */
  | { type: 'SHOW_MORE'; eligibleIds: string[]; batchSize: number; placement?: Record<string, PlacementDims> }
  /** Pop the last inspection off history and restore it. Purely restorative: drops now-ineligible survivors but never auto-admits new eligibility (that is what NAVIGATE_LEVEL / Show more are for). Never admits, so it needs no placement. */
  | { type: 'NAVIGATE_BACK'; eligibleIds: string[] }
  /** A new snapshot/workspace: reinitialize every level, populate only the given starting level, and bump `generation` so late geometry events from the previous snapshot cannot land. */
  | { type: 'RESET'; level: Level; eligibleIds: string[]; batchSize: number; placement?: Record<string, PlacementDims> }
  /** The canvas settled on a new pan/zoom for `level` (debounced real user camera movement, or the
   * one-time initial fit). Stamped with the `generation` the caller observed when the gesture
   * settled; ignored if that no longer matches (a late event from before a snapshot reset). */
  | { type: 'SET_CAMERA'; level: Level; camera: Camera; generation: number }
  /** A manual drag completed for `id` on `level`. Ignored if `id` is no longer displayed there
   * (e.g. removed from scope mid-drag) or `generation` is stale. */
  | { type: 'NODE_MOVED'; level: Level; id: string; position: Point; generation: number; containerId?: string | null }
  /** Several cards moved by one gesture -- a dragged expanded container carrying its whole subtree,
   * or a multi-card group drag -- applied as one dispatch with one `geometryRevision` bump instead of
   * a NODE_MOVED per card (review remediation F-05). Each entry is applied exactly as NODE_MOVED
   * applies its single one; an entry for an ID no longer displayed there is skipped, same as NODE_MOVED. */
  | { type: 'NODES_MOVED'; level: Level; moves: { id: string; position: Point; containerId: string | null }[]; generation: number }
  /** Expand `id` in place into its children at the given positions. `ownerId` is the expanded card
   * it sits inside (null for a displayed card). Ignored when that card is not actually there. */
  | { type: 'EXPAND_RESOURCE'; level: Level; id: string; ownerId: string | null; childPositions: Record<string, Point>; generation: number; moves?: CardMoves }
  /** Collapse `id` (and every expansion nested inside it) back to a card centered at `position`. */
  | { type: 'COLLAPSE_RESOURCE'; level: Level; id: string; position: Point; generation: number; moves?: CardMoves }
  /** A user resize of one card; `position` keeps its top-left corner where it was. `containerId` is
   * the expanded card it sits inside, or null for a displayed card. */
  | { type: 'RESIZE_RESOURCE'; level: Level; id: string; containerId: string | null; size: Size; position: Point; generation: number; moves?: CardMoves }
  /** A user resize of an expanded container's box (`minSize` excludes its padding). */
  | { type: 'RESIZE_CONTAINER'; level: Level; id: string; minSize: Size; generation: number; moves?: CardMoves }
  /** Step 5 (Appendix B): apply a freshly computed focused arrangement -- canvas double-click or
   * the inspector's "Arrange around this resource" action -- to `level`'s positions in one atomic
   * dispatch. `positions` covers every currently displayed card (the caller computed it from that
   * exact set); an ID not present here is left untouched. Distinct from NODE_MOVED (one card, a
   * drag) and from membership admission (SCOPE_UPDATED/SHOW_MORE/NAVIGATE_LEVEL place only newly
   * admitted cards, never rewrite a survivor's position) -- this is the one action allowed to move
   * already-displayed survivors in bulk. Ignored if `generation` is stale, matching SET_CAMERA/
   * NODE_MOVED, so a late result from before a snapshot reset cannot land. */
  | { type: 'ARRANGE_AROUND_RESOURCE'; level: Level; positions: Record<string, Point>; generation: number; childPositions?: Record<string, Record<string, Point>> };

const HISTORY_LIMIT = 20;

function emptyLevelView(): LevelViewState {
  return { displayedIds: [], priorEligibleIds: [], initialized: false, positions: {}, camera: null, geometryRevision: 0, cameraRevision: 0, geometryInitialized: false, appendWidth: null, expansions: {}, sizes: {} };
}

export function initExplorerViewState(level: Level = 'PACKAGE'): ExplorerViewState {
  return {
    activeLevel: level,
    levelViews: { PACKAGE: emptyLevelView(), CLASS: emptyLevelView(), METHOD: emptyLevelView() },
    inspectedSubjectId: null,
    inspectedKind: null,
    inspectedLevel: null,
    membershipRevision: 0,
    newlyAddedIds: [],
    history: [],
    generation: 0,
  };
}

/**
 * Drops expansions (and sizes) that no longer belong to a shown card: an expansion survives only
 * while its owner chain ends at a surviving displayed card, each link being a card its owner still
 * holds. `children` (a scope edit) gives each expanded card's in-scope child IDs; stored child
 * positions outside it are dropped, so a child that leaves scope takes its slot, its own expansion
 * and its size with it, and comes back like a new child. Returns the same objects when nothing is
 * dropped, so an unchanged level keeps reference identity.
 */
function pruneExpansions(view: LevelViewState, survivors: string[], children?: Record<string, string[]>): { expansions: Record<string, ExpansionState>; sizes: Record<string, Size> } {
  const top = new Set(survivors);
  let source = view.expansions, trimmed = false;
  if (children) {
    source = {};
    for (const [id, e] of Object.entries(view.expansions)) {
      const allowed = children[id];
      if (!allowed) { source[id] = e; continue; }
      const inScope = new Set(allowed), childPositions: Record<string, Point> = {};
      for (const [child, p] of Object.entries(e.childPositions)) if (inScope.has(child)) childPositions[child] = p;
      if (Object.keys(childPositions).length === Object.keys(e.childPositions).length) source[id] = e;
      else { source[id] = { ...e, childPositions }; trimmed = true; }
    }
  }
  const kept: Record<string, ExpansionState> = {};
  const rooted = (id: string, seen = new Set<string>()): boolean => {
    const e = source[id];
    if (!e || seen.has(id)) return false;
    seen.add(id);
    if (e.ownerId === null) return top.has(id);
    const owner = source[e.ownerId];
    return !!owner && (!children || id in owner.childPositions) && rooted(e.ownerId, seen);
  };
  for (const id of Object.keys(source)) if (rooted(id)) kept[id] = source[id];
  const live = new Set(survivors);
  for (const e of Object.values(kept)) for (const id of Object.keys(e.childPositions)) live.add(id);
  const sizes: Record<string, Size> = {};
  for (const id of Object.keys(view.sizes)) if (live.has(id)) sizes[id] = view.sizes[id];
  return {
    expansions: !trimmed && Object.keys(kept).length === Object.keys(view.expansions).length ? view.expansions : kept,
    sizes: Object.keys(sizes).length === Object.keys(view.sizes).length ? view.sizes : sizes,
  };
}

/** Removes `id`'s expansion and every expansion nested inside it. */
function withoutExpansionTree(expansions: Record<string, ExpansionState>, id: string): Record<string, ExpansionState> {
  const drop = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [other, e] of Object.entries(expansions)) if (!drop.has(other) && e.ownerId !== null && drop.has(e.ownerId)) { drop.add(other); grew = true; }
  }
  const out: Record<string, ExpansionState> = {};
  for (const [other, e] of Object.entries(expansions)) if (!drop.has(other)) out[other] = e;
  return out;
}

function applyMoves(view: LevelViewState, moves: CardMoves | undefined): LevelViewState {
  if (!moves) return view;
  const shown = new Set(view.displayedIds);
  const positions = { ...view.positions };
  for (const [id, p] of Object.entries(moves.positions)) if (shown.has(id)) positions[id] = p;
  const expansions = { ...view.expansions };
  for (const [id, children] of Object.entries(moves.childPositions)) if (expansions[id]) expansions[id] = { ...expansions[id], childPositions: { ...expansions[id].childPositions, ...children } };
  return { ...view, positions, expansions };
}

/** Writes one card's position wherever it lives: the level's page or its container's children. */
function withPosition(view: LevelViewState, id: string, containerId: string | null, position: Point): LevelViewState | null {
  if (containerId === null) {
    if (!view.displayedIds.includes(id)) return null;
    return { ...view, positions: { ...view.positions, [id]: position } };
  }
  const owner = view.expansions[containerId];
  if (!owner) return null;
  return { ...view, expansions: { ...view.expansions, [containerId]: { ...owner, childPositions: { ...owner.childPositions, [id]: position } } } };
}

/**
 * Appendix A3: positions for survivors are echoed back verbatim (dropping any ID no longer
 * displayed -- Appendix A3.7, "on scope removal, discard removed-node geometry"); positions for a
 * newly admitted batch are computed by graphPlacement.placeAdditions below the survivors' actual
 * bounding box. When `placement` is omitted (a caller that does not exercise geometry, e.g. most
 * of the existing pure reducer tests) new IDs simply get no position yet -- membership is still
 * exactly correct, only geometry is deferred, matching the pre-Step-3 contract for those callers.
 */
function reconcilePositions(
  view: LevelViewState,
  survivors: string[],
  added: string[],
  placement?: Record<string, PlacementDims>,
): { positions: Record<string, Point>; appendWidth: number | null } {
  const survivorPositions: Record<string, Point> = {};
  for (const id of survivors) {
    const p = view.positions[id];
    if (p) survivorPositions[id] = p;
  }
  if (!added.length || !placement) return { positions: survivorPositions, appendWidth: view.appendWidth };
  const survivorBounds: CardBounds[] = survivors
    .filter(id => survivorPositions[id] && placement[id])
    .map(id => ({ id, x: placement[id].center?.x ?? survivorPositions[id].x, y: placement[id].center?.y ?? survivorPositions[id].y, width: placement[id].width, height: placement[id].height }));
  const additionCards: AdditionCard[] = added.map(id => ({
    id,
    width: placement[id]?.width ?? 250,
    height: placement[id]?.height ?? 128,
    name: placement[id]?.name ?? id,
  }));
  const { positions: newPositions, appendWidth } = placeAdditions(survivorBounds, additionCards, view.appendWidth);
  return { positions: { ...survivorPositions, ...newPositions }, appendWidth };
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
  placement?: Record<string, PlacementDims>,
): { next: LevelViewState; added: string[]; changed: boolean } {
  const eligibleSet = new Set(eligibleIdsRanked);
  const priorEligibleSet = new Set(view.priorEligibleIds);
  const survivors = view.displayedIds.filter(id => eligibleSet.has(id));
  const survivorSet = new Set(survivors);
  const added = explicitAddId !== undefined
    ? (eligibleSet.has(explicitAddId) && !survivorSet.has(explicitAddId) ? [explicitAddId] : [])
    : eligibleIdsRanked.filter(id => !priorEligibleSet.has(id) && !survivorSet.has(id)).slice(0, Math.max(0, batchSize));
  const { positions, appendWidth } = reconcilePositions(view, survivors, added, placement);
  const geometryInitialized = view.geometryInitialized || Object.keys(positions).length > 0;
  return {
    next: {
      displayedIds: [...survivors, ...added],
      priorEligibleIds: eligibleIdsRanked,
      initialized: true,
      positions,
      appendWidth,
      camera: view.camera,
      geometryRevision: added.some(id => positions[id]) ? view.geometryRevision + 1 : view.geometryRevision,
      cameraRevision: view.cameraRevision,
      geometryInitialized,
      ...pruneExpansions(view, survivors),
    },
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
function appendPendingBatch(
  view: LevelViewState,
  eligibleIdsRanked: string[],
  batchSize: number,
  placement?: Record<string, PlacementDims>,
): { next: LevelViewState; added: string[]; changed: boolean } {
  const eligibleSet = new Set(eligibleIdsRanked);
  const survivors = view.displayedIds.filter(id => eligibleSet.has(id));
  const survivorSet = new Set(survivors);
  const pending = eligibleIdsRanked.filter(id => !survivorSet.has(id));
  const added = pending.slice(0, Math.max(0, batchSize));
  const { positions, appendWidth } = reconcilePositions(view, survivors, added, placement);
  const geometryInitialized = view.geometryInitialized || Object.keys(positions).length > 0;
  return {
    next: {
      displayedIds: [...survivors, ...added],
      priorEligibleIds: eligibleIdsRanked,
      initialized: true,
      positions,
      appendWidth,
      camera: view.camera,
      geometryRevision: added.some(id => positions[id]) ? view.geometryRevision + 1 : view.geometryRevision,
      cameraRevision: view.cameraRevision,
      geometryInitialized,
      ...pruneExpansions(view, survivors),
    },
    added,
    changed: added.length > 0 || survivors.length !== view.displayedIds.length,
  };
}

function pushHistory(state: ExplorerViewState, entry: HistoryEntry | null): HistoryEntry[] {
  if (!entry) return state.history;
  const top = state.history[state.history.length - 1];
  // A null subjectId (B1's level-only breadcrumb) has no subject identity to dedup on, so two
  // distinct level-only entries must be told apart by level instead -- otherwise switching levels
  // twice with nothing inspected would collapse into a single (wrong) breadcrumb.
  if (top && top.subjectId === entry.subjectId && top.kind === entry.kind && (entry.subjectId !== null || top.level === entry.level)) return state.history;
  return [...state.history.slice(-(HISTORY_LIMIT - 1)), entry];
}

function currentEntry(state: ExplorerViewState): HistoryEntry | null {
  if (!state.inspectedSubjectId) return null;
  // Read inspectedLevel (the level this subject was actually inspected under), never activeLevel --
  // activeLevel keeps changing underneath an unchanged inspection (Step 4's cross-level inspection
  // persistence), so by the time a *later* inspection or CLEAR_INSPECTION calls this, activeLevel
  // may already be a different level than the one this subject was inspected under (Step 5 review
  // remediation A1).
  const level = state.inspectedLevel!;
  return { subjectId: state.inspectedSubjectId, kind: state.inspectedKind!, level, geometryRevision: state.levelViews[level].geometryRevision };
}

function inspect(state: ExplorerViewState, id: string, kind: InspectedKind): ExplorerViewState {
  if (state.inspectedSubjectId === id && state.inspectedKind === kind) return state;
  return { ...state, inspectedSubjectId: id, inspectedKind: kind, inspectedLevel: state.activeLevel, history: pushHistory(state, currentEntry(state)) };
}

/**
 * Appendix F3: drop now-ineligible IDs from a level the user is NOT currently viewing, and forget
 * them from `priorEligibleIds` too, so a later re-addition is recognized as genuinely new instead
 * of an unbroken survivor. Never admits anything -- an inactive level's newly-eligible IDs stay
 * deferred to its next real visit (NAVIGATE_LEVEL/NAVIGATE_BACK) or Show more, exactly like today.
 * A true no-op (same reference, `initialized` untouched) when nothing is actually dropped,
 * including on a level that has never been visited at all. This must never call
 * `reconcileLevelView`: that path sets `initialized: true` and overwrites `priorEligibleIds` with
 * the FULL eligible set, which would erase the very distinction this function exists to preserve.
 */
function shadowTrimLevel(view: LevelViewState, eligibleIds: string[]): { next: LevelViewState; changed: boolean } {
  const eligibleSet = new Set(eligibleIds);
  const survivors = view.displayedIds.filter(id => eligibleSet.has(id));
  const priorEligibleIds = view.priorEligibleIds.filter(id => eligibleSet.has(id));
  if (survivors.length === view.displayedIds.length && priorEligibleIds.length === view.priorEligibleIds.length) {
    return { next: view, changed: false };
  }
  // Dropped IDs' geometry goes with them (Appendix A3.7); this never bumps geometryRevision,
  // matching reconcileLevelView's rule that only a newly PLACED position does (never a removal).
  const positions: Record<string, Point> = {};
  for (const id of survivors) if (view.positions[id]) positions[id] = view.positions[id];
  return { next: { ...view, displayedIds: survivors, priorEligibleIds, positions, ...pruneExpansions(view, survivors) }, changed: survivors.length !== view.displayedIds.length };
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
      return { ...state, inspectedSubjectId: null, inspectedKind: null, inspectedLevel: null, history: pushHistory(state, currentEntry(state)) };
    }
    case 'NAVIGATE_LEVEL': {
      // Step 5 review remediation B1: a drill-down (View classes/View methods, or the segmented
      // control) that starts from a completely uninspected state must still leave a way back --
      // otherwise history stays empty and Back is stuck disabled. There is no subject to record, so
      // push a level-only breadcrumb naming the level being left, and only when the level is
      // actually changing (re-navigating to the already-active level is a no-op elsewhere and must
      // not spam an entry).
      const leavingUninspected = !state.inspectedSubjectId && action.level !== state.activeLevel;
      const history = leavingUninspected
        ? pushHistory(state, { subjectId: null, kind: null, level: state.activeLevel, geometryRevision: state.levelViews[state.activeLevel].geometryRevision })
        : state.history;
      const { next, added, changed } = reconcileLevelView(state.levelViews[action.level], action.eligibleIds, undefined, action.batchSize, action.placement);
      return {
        ...state,
        activeLevel: action.level,
        levelViews: { ...state.levelViews, [action.level]: next },
        newlyAddedIds: added,
        membershipRevision: changed ? state.membershipRevision + 1 : state.membershipRevision,
        history,
      };
    }
    case 'SCOPE_UPDATED': {
      const { next, added, changed } = reconcileLevelView(state.levelViews[state.activeLevel], action.eligibleIds, action.explicitClassAddId, action.batchSize, action.placement);
      // Expanded cards on every level lose children that left scope (see pruneExpansions).
      const withChildren = (view: LevelViewState): LevelViewState => {
        if (!action.expansionChildren || !Object.keys(view.expansions).length) return view;
        const pruned = pruneExpansions(view, view.displayedIds, action.expansionChildren);
        return pruned.expansions === view.expansions && pruned.sizes === view.sizes ? view : { ...view, ...pruned };
      };
      const levelViews: Record<Level, LevelViewState> = { ...state.levelViews, [state.activeLevel]: withChildren(next) };
      let otherChanged = false;
      if (action.otherLevels) {
        for (const key of Object.keys(action.otherLevels)) {
          const lvl = key as Level;
          if (lvl === state.activeLevel) continue;
          const trimmed = shadowTrimLevel(state.levelViews[lvl], action.otherLevels[lvl]!);
          levelViews[lvl] = withChildren(trimmed.next);
          otherChanged = otherChanged || trimmed.changed;
        }
      }
      return {
        ...state,
        levelViews,
        newlyAddedIds: added,
        membershipRevision: (changed || otherChanged) ? state.membershipRevision + 1 : state.membershipRevision,
      };
    }
    case 'SHOW_MORE': {
      const { next, added, changed } = appendPendingBatch(state.levelViews[state.activeLevel], action.eligibleIds, action.batchSize, action.placement);
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
        // Keep the inspectedLevel-is-non-null-iff-inspectedSubjectId-is-non-null invariant for a
        // restored level-only (B1) breadcrumb, whose subjectId is null.
        inspectedLevel: entry.subjectId !== null ? entry.level : null,
        history: state.history.slice(0, -1),
        newlyAddedIds: [],
        membershipRevision: changed ? state.membershipRevision + 1 : state.membershipRevision,
      };
    }
    case 'RESET': {
      const fresh = initExplorerViewState(action.level);
      const { next } = reconcileLevelView(fresh.levelViews[action.level], action.eligibleIds, undefined, action.batchSize, action.placement);
      return { ...fresh, levelViews: { ...fresh.levelViews, [action.level]: next }, membershipRevision: 1, newlyAddedIds: next.displayedIds, generation: state.generation + 1 };
    }
    case 'SET_CAMERA': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      if (view.camera && view.camera.zoom === action.camera.zoom && view.camera.pan.x === action.camera.pan.x && view.camera.pan.y === action.camera.pan.y) return state;
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...view, camera: action.camera, cameraRevision: view.cameraRevision + 1 } } };
    }
    case 'NODE_MOVED': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      const containerId = action.containerId ?? null;
      const existing = containerId === null ? view.positions[action.id] : view.expansions[containerId]?.childPositions[action.id];
      if (existing && existing.x === action.position.x && existing.y === action.position.y) return state;
      const moved = withPosition(view, action.id, containerId, action.position);
      if (!moved) return state;
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...moved, geometryRevision: view.geometryRevision + 1 } } };
    }
    case 'NODES_MOVED': {
      if (action.generation !== state.generation) return state;
      let view = state.levelViews[action.level];
      let changed = false;
      for (const m of action.moves) {
        const containerId = m.containerId ?? null;
        const existing = containerId === null ? view.positions[m.id] : view.expansions[containerId]?.childPositions[m.id];
        if (existing && existing.x === m.position.x && existing.y === m.position.y) continue;
        const moved = withPosition(view, m.id, containerId, m.position);
        if (!moved) continue;
        view = moved;
        changed = true;
      }
      if (!changed) return state;
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...view, geometryRevision: state.levelViews[action.level].geometryRevision + 1 } } };
    }
    case 'EXPAND_RESOURCE': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      if (view.expansions[action.id]) return state;
      if (action.ownerId === null ? !view.displayedIds.includes(action.id) : !view.expansions[action.ownerId]) return state;
      const expansions = { ...view.expansions, [action.id]: { ownerId: action.ownerId, childPositions: action.childPositions, minSize: null } };
      const next = applyMoves({ ...view, expansions }, action.moves);
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...next, geometryRevision: view.geometryRevision + 1 } } };
    }
    case 'COLLAPSE_RESOURCE': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      const expansion = view.expansions[action.id];
      if (!expansion) return state;
      const collapsed = withPosition({ ...view, expansions: withoutExpansionTree(view.expansions, action.id) }, action.id, expansion.ownerId, action.position);
      if (!collapsed) return state;
      const { sizes } = pruneExpansions(collapsed, collapsed.displayedIds);
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...applyMoves(collapsed, action.moves), sizes, geometryRevision: view.geometryRevision + 1 } } };
    }
    case 'RESIZE_RESOURCE': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      const moved = withPosition(view, action.id, action.containerId, action.position);
      if (!moved) return state;
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...applyMoves(moved, action.moves), sizes: { ...view.sizes, [action.id]: action.size }, geometryRevision: view.geometryRevision + 1 } } };
    }
    case 'RESIZE_CONTAINER': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      const expansion = view.expansions[action.id];
      if (!expansion) return state;
      const resized = { ...view, expansions: { ...view.expansions, [action.id]: { ...expansion, minSize: action.minSize } } };
      return { ...state, levelViews: { ...state.levelViews, [action.level]: { ...applyMoves(resized, action.moves), geometryRevision: view.geometryRevision + 1 } } };
    }
    case 'ARRANGE_AROUND_RESOURCE': {
      if (action.generation !== state.generation) return state;
      const view = state.levelViews[action.level];
      // An arranged expanded card moves with its children: the caller translates them (and any
      // nested expansion's children) and passes those per container here, in the same dispatch.
      const expansions = action.childPositions ? applyMoves(view, { positions: {}, childPositions: action.childPositions }).expansions : view.expansions;
      return {
        ...state,
        levelViews: { ...state.levelViews, [action.level]: { ...view, positions: { ...view.positions, ...action.positions }, expansions, geometryRevision: view.geometryRevision + 1 } },
      };
    }
    default:
      return state;
  }
}
