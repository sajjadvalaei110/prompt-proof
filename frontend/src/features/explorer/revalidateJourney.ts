import { explorerViewReducer, ExplorerViewState } from './explorerViewState';
import { aggregateRouteEndpoints, projectDisplayed, type AtlasGraph } from './graphModel';
import type { Journey } from './explorerJourney';

/**
 * Reconcile inspection state with the graph a journey is about to render.
 *
 * Ordinary graph identity is stable across a Git recapture, so an ordinary tab
 * keeps its edge inspection, relationship source evidence, and corresponding
 * Back entries. A mode boundary or a review recapture changes comparison edge
 * identity, so those review-bound pieces are discarded. Ordinary symbol source
 * is closed when entering Changes so it cannot remain pinned to the ordinary
 * snapshot while the overlay is visible.
 */
export function revalidateJourneyState(journey: Journey, targetGraph: AtlasGraph, targetIsReview: boolean): Journey {
  const nodeIds = new Set(targetGraph.nodes.map(node => node.id));
  const { view, multiIds, outgoingStackRootId } = revalidateSelection(journey, nodeIds, targetIsReview || journey.review);

  let source = journey.source;
  if (source && (!source.node?.id || source.snapshotId || targetIsReview)) {
    // A source pinned to a comparison snapshot is stale after any recapture or
    // after returning to the ordinary graph. An ordinary source is also closed
    // on entry to Changes so it can be reopened through the review identity map.
    source = null;
  } else if (source?.type === 'symbol' && !nodeIds.has(source.node.id)) {
    source = null;
  }
  // An ordinary relationship source intentionally has no graph-node ID to
  // validate. Its snapshot and occurrence IDs belong to the ordinary graph,
  // which remains unchanged while Recompare refreshes the comparison.

  return view === journey.view
    && multiIds.length === journey.multiIds.length
    && outgoingStackRootId === journey.outgoingStackRootId
    && source === journey.source
    ? journey
    : { ...journey, view, multiIds, outgoingStackRootId, source };
}

/**
 * The selection half of revalidateJourneyState: inspection, Back trail, multi-selection and the
 * outgoing stack root checked
 * against the target graph's node IDs (null: unknown, keep nodes), dropping edge identities when
 * the comparison identity changes.
 */
function revalidateSelection(journey: Journey, nodeIds: ReadonlySet<string> | null, comparisonIdentityChanges: boolean): Pick<Journey, 'view' | 'multiIds' | 'outgoingStackRootId'> {
  let view = journey.view;
  const invalidNode = view.inspectedKind === 'NODE'
    && (!view.inspectedSubjectId || (nodeIds !== null && !nodeIds.has(view.inspectedSubjectId)));

  // Review aggregate edge IDs are derived from the comparison capture. They
  // must not survive entering/leaving Changes or a fresh review capture. The
  // ordinary graph's edge IDs, however, remain valid when an ordinary tab is
  // reconciled during Recompare.
  if (invalidNode || (comparisonIdentityChanges && view.inspectedKind === 'EDGE')) {
    view = explorerViewReducer(view, { type: 'CLEAR_INSPECTION' });
  }
  if (!view.inspectedSubjectId && view.inspectedOccurrenceId !== null) {
    view = { ...view, inspectedOccurrenceId: null };
  }

  const history = view.history.filter(entry => {
    if (entry.subjectId === null) return true;
    if (entry.kind === 'EDGE') return !comparisonIdentityChanges;
    return entry.kind === 'NODE' && (nodeIds === null || nodeIds.has(entry.subjectId));
  });
  if (history.length !== view.history.length) view = { ...view, history };

  const multiIds = nodeIds === null ? journey.multiIds : journey.multiIds.filter(id => nodeIds.has(id));
  const root = journey.outgoingStackRootId;
  const outgoingStackRootId = root && nodeIds !== null && !nodeIds.has(root) ? null : root;
  return { view, multiIds: multiIds.length === journey.multiIds.length ? journey.multiIds : multiIds, outgoingStackRootId };
}

/** What a journey's map draws: its cards (children of expanded cards included) and, when asked
 * for and a graph is known, its routes. */
interface DisplayedMap { cards: ReadonlySet<string>; routes: ReadonlySet<string> | null }

/**
 * With the journey's graph this is exactly what the canvas draws, before the relationship filter
 * (an inspected route hidden only by the filter or by an endpoint's expansion is still the same
 * route, see App's `edge` lookup). Without a graph it falls back to the view's own record: the
 * displayed page plus every stored child position, and no route knowledge.
 */
function displayedMap(j: Journey, graph: AtlasGraph | null | undefined, withRoutes: boolean): DisplayedMap {
  const level = j.view.activeLevel, lv = j.view.levelViews[level];
  if (!graph) {
    const cards = new Set(lv.displayedIds);
    if (level !== 'METHOD') for (const e of Object.values(lv.expansions)) for (const id of Object.keys(e.childPositions)) cards.add(id);
    return { cards, routes: null };
  }
  const expanded = projectDisplayed(graph, level, lv.displayedIds, 'ALL', { expansions: Object.entries(lv.expansions).map(([id, e]) => ({ id, ownerId: e.ownerId })), scope: j.scope });
  const cards = new Set(expanded.nodes.map(n => n.id));
  if (!withRoutes) return { cards, routes: null };
  const plain = projectDisplayed(graph, level, lv.displayedIds, 'ALL', { expansions: [], scope: j.scope });
  return { cards, routes: new Set([...expanded.edges, ...plain.edges].map(e => e.id)) };
}

/** Whether both journeys draw from identical inputs, so no card or route can have left the map. */
function sameDisplayInputs(a: Journey, b: Journey): boolean {
  if (a.review !== b.review || a.scope !== b.scope || a.view.activeLevel !== b.view.activeLevel) return false;
  const x = a.view.levelViews[a.view.activeLevel], y = b.view.levelViews[b.view.activeLevel];
  return x.displayedIds === y.displayedIds && x.expansions === y.expansions;
}

function clearInspection(view: ExplorerViewState): ExplorerViewState {
  return { ...view, inspectedSubjectId: null, inspectedKind: null, inspectedOccurrenceId: null, inspectedLevel: null };
}

/**
 * ADR 0009: undo/redo restores `restored`, which already carries the selection of `before` (the
 * present being left). Selection that `before`'s map displayed and `restored`'s map no longer does
 * is dropped: the inspected card, an inspected route, multi-selected cards, and Back-trail entries
 * for such cards and routes (so Back cannot return to them). Selection that was not on the map to
 * begin with (a tree/search pick inside a collapsed package) is left alone. Pruning is not
 * navigation, so it pushes no Back entry. Crossing a Changes toggle changes route identity, so the
 * carried selection is revalidated as a mode switch would.
 *
 * Undo is key-repeated, so the projections run only when needed: never without a selection, never
 * when the step left membership, expansions and scope untouched, and routes only for a route that
 * is inspected or trailed.
 */
export function pruneRestoredSelection(restored: Journey, before: Journey, graphFor?: (j: Journey) => AtlasGraph | null | undefined): Journey {
  if (!restored.view.inspectedSubjectId && !restored.multiIds.length && !restored.outgoingStackRootId && !restored.view.history.some(e => e.subjectId !== null)) return restored;
  let { view, multiIds, outgoingStackRootId } = restored;
  let targetGraph: AtlasGraph | null | undefined;
  if (restored.review !== before.review) {
    targetGraph = graphFor?.(restored);
    ({ view, multiIds, outgoingStackRootId } = revalidateSelection(restored, targetGraph ? new Set(targetGraph.nodes.map(n => n.id)) : null, true));
  }
  if (!sameDisplayInputs(before, restored)) {
    if (targetGraph === undefined) targetGraph = graphFor?.(restored);
    const withRoutes = view.inspectedKind === 'EDGE' || view.history.some(e => e.kind === 'EDGE' && e.subjectId !== null);
    const was = displayedMap(before, graphFor?.(before), withRoutes), now = displayedMap(restored, targetGraph, withRoutes);
    const gone = (id: string) => was.cards.has(id) && !now.cards.has(id);
    // Without route knowledge on both sides, an aggregate route has left the map when one of the
    // cards it joins has. A raw relationship ID (unresolved target) names no card, so it is kept.
    const routeGone = (id: string) => was.routes && now.routes
      ? was.routes.has(id) && !now.routes.has(id)
      : !!aggregateRouteEndpoints(id)?.some(gone);
    const subject = view.inspectedSubjectId;
    if (subject && (view.inspectedKind === 'EDGE' ? routeGone(subject) : view.inspectedKind === 'NODE' && gone(subject))) view = clearInspection(view);
    const history = view.history.filter(e => e.subjectId === null || !(e.kind === 'EDGE' ? routeGone(e.subjectId) : gone(e.subjectId)));
    if (history.length !== view.history.length) view = { ...view, history };
    const kept = multiIds.filter(id => !gone(id));
    if (kept.length !== multiIds.length) multiIds = kept;
    if (outgoingStackRootId && gone(outgoingStackRootId)) outgoingStackRootId = null;
  }
  return view === restored.view && multiIds === restored.multiIds && outgoingStackRootId === restored.outgoingStackRootId
    ? restored : { ...restored, view, multiIds, outgoingStackRootId };
}

/**
 * The outgoing stack ends when its root leaves the map (docs/OUTGOING_STACK.md): after an ordinary
 * update or a review recapture changed what `next` draws relative to `prev`, a root that `next` no
 * longer draws is dropped. It never re-roots. Cheap when no stack is shown or the display inputs are
 * unchanged, which covers every selection click and card move.
 */
export function pruneStackRoot(next: Journey, prev: Journey, graphFor?: (j: Journey) => AtlasGraph | null | undefined): Journey {
  const root = next.outgoingStackRootId;
  if (!root || next === prev || sameDisplayInputs(prev, next)) return next;
  return displayedMap(next, graphFor?.(next), false).cards.has(root) ? next : { ...next, outgoingStackRootId: null };
}
