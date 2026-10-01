import { useCallback, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { AtlasGraph } from '../explorer/graphModel';
import { ReviewComparison, ReviewSourceIdentityMaps, projectReviewGraph, reviewBaseRefFor, reviewSourceIdentityMaps, toReviewAtlasGraph } from './reviewModel';

export interface ReviewComparisonState {
  review: ReviewComparison | null;
  /** `graph`/`identityMaps` are the Base+changes overlay projection -- the map's only review view. */
  graph: AtlasGraph | null;
  identityMaps: ReviewSourceIdentityMaps | null;
  /** Identifies one loaded comparison, so a shared journey can associate source inspection with the
   * comparison currently drawn (see toggleJourneyReview / REVIEW_RECAPTURED in explorerJourney.ts). */
  reviewKey: string | null;
  loading: boolean;
  error: string;
  baseRef: string;
  setBaseRef: (value: string) => void;
  /** Loads (or reloads, on Recompare) the comparison. Returns the fresh graph/reviewKey so a caller
   * mid-toggle can act on the just-arrived result instead of a value captured before the request. */
  load: () => Promise<{ graph: AtlasGraph; identityMaps: ReviewSourceIdentityMaps; reviewKey: string } | null>;
  reset: () => void;
}

/** Owns one workspace's Git-review comparison: capture lifecycle, the Base+changes overlay graph
 * projected from it, and the source-identity maps that route API calls back to each side's real
 * symbol/relationship IDs and snapshot (display IDs are keyed on the comparison, not the database). */
export function useReviewComparison(workspaceId: string | null, currentGraph: AtlasGraph | null = null): ReviewComparisonState {
  const [review, setReview] = useState<ReviewComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Keyed by workspace: a revision typed for one repository usually does not exist in the next one opened.
  const [storedBaseRef, setStoredBaseRef] = useState<{ workspaceId: string | null; value: string }>({ workspaceId: null, value: '' });
  const baseRef = reviewBaseRefFor(storedBaseRef, workspaceId);
  const setBaseRef = useCallback((value: string) => setStoredBaseRef({ workspaceId, value }), [workspaceId]);
  const requestInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!workspaceId || requestInFlight.current) return null;
    requestInFlight.current = true;
    setLoading(true); setError('');
    try {
      const response: ReviewComparison = await apiClient.createReview(workspaceId, baseRef);
      setReview(response);
      const projected = projectReviewGraph(response, 'OVERLAY', currentGraph || undefined);
      const graph = toReviewAtlasGraph('OVERLAY', projected);
      const identityMaps = reviewSourceIdentityMaps(response, 'OVERLAY', projected);
      const reviewKey = `${response.base.snapshotId}:${response.head.snapshotId}`;
      return { graph, identityMaps, reviewKey };
    } catch (e: any) {
      setError(e.message || 'Could not compare the working tree.');
      return null;
    } finally {
      requestInFlight.current = false; setLoading(false);
    }
  }, [workspaceId, baseRef, currentGraph]);

  const reset = useCallback(() => { setReview(null); setError(''); requestInFlight.current = false; }, []);

  // Derived once per `review` identity (only load()/reset() ever replace it), not on every render:
  // App re-renders constantly (2s queue polling, journey updates, ...) and re-running
  // projectReviewGraph/toReviewAtlasGraph each time handed callers a fresh `graph` object every
  // render, which every useMemo keyed on graph identity downstream (App's `projected`, `geometry`,
  // etc.) then treated as a real change.
  const derived = useMemo(() => {
    if (!review) return { graph: null as AtlasGraph | null, identityMaps: null as ReviewSourceIdentityMaps | null, reviewKey: null as string | null };
    const projected = projectReviewGraph(review, 'OVERLAY', currentGraph || undefined);
    return {
      graph: toReviewAtlasGraph('OVERLAY', projected),
      identityMaps: reviewSourceIdentityMaps(review, 'OVERLAY', projected),
      reviewKey: `${review.base.snapshotId}:${review.head.snapshotId}`
    };
  }, [review, currentGraph]);
  return { review, graph: derived.graph, identityMaps: derived.identityMaps, reviewKey: derived.reviewKey, loading, error, baseRef, setBaseRef, load, reset };
}
