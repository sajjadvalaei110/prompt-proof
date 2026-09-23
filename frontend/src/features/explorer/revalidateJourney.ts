import { explorerViewReducer } from './explorerViewState';
import type { AtlasGraph } from './graphModel';
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
  const comparisonIdentityChanges = targetIsReview || journey.review;
  let view = journey.view;
  const invalidNode = view.inspectedKind === 'NODE'
    && (!view.inspectedSubjectId || !nodeIds.has(view.inspectedSubjectId));

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
    return entry.kind === 'NODE' && nodeIds.has(entry.subjectId);
  });
  if (history.length !== view.history.length) view = { ...view, history };

  const multiIds = journey.multiIds.filter(id => nodeIds.has(id));

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
    && source === journey.source
    ? journey
    : { ...journey, view, multiIds, source };
}
