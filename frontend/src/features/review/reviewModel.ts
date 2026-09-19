import type { AtlasGraph, AtlasNode, AtlasEdge } from '../explorer/graphModel';

/**
 * Version 1 review comparisons are facts from two immutable analysis snapshots. This module only
 * selects a side for presentation; it never derives a relationship from generated prose.
 */
export type ReviewMode = 'BASE' | 'OVERLAY' | 'HEAD';
export type ReviewChange = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'UNCHANGED';

export interface ReviewSide<T> { snapshotId?: string; value: T }
export interface ReviewNodeRow<T = any> {
  comparisonKey: string;
  change: ReviewChange;
  addedLines: number;
  removedLines: number;
  base?: T;
  head?: T;
}
export interface ReviewRelationshipRow<T = any> {
  comparisonKey: string;
  change: Exclude<ReviewChange, 'MODIFIED'>;
  base?: T;
  head?: T;
}
export interface ReviewComparison {
  schemaVersion: string;
  workspaceId: string;
  base: { snapshotId: string; requestedRef?: string; resolvedRef?: string; warning?: string };
  head: { snapshotId: string; ref: string; headOid?: string; fingerprint?: string; capturedAt?: string };
  summary: { addedLines: number; removedLines: number; changedFiles: number };
  /** Every changed path is retained, including non-Java and binary files without graph facts. */
  files?: { path: string; status: string; addedLines: number; removedLines: number; javaFile: boolean; lineCountsAvailable: boolean }[];
  nodes: ReviewNodeRow[];
  relationships: ReviewRelationshipRow[];
  diagnostics?: { severity: string; code: string; message: string }[];
}

export interface ProjectedReviewNode {
  comparisonKey: string;
  change: ReviewChange;
  addedLines: number;
  removedLines: number;
  side: 'base' | 'head';
  snapshotId: string;
  node: any;
}
export interface ProjectedReviewRelationship {
  comparisonKey: string;
  change: Exclude<ReviewChange, 'MODIFIED'>;
  side: 'base' | 'head';
  snapshotId: string;
  relationship: any;
}

export interface ReviewGraphNode extends ProjectedReviewNode { id: string; label: string; kind: string; sourceId: string; parentId?: string }
export interface ReviewGraphEdge extends ProjectedReviewRelationship { id: string; sourceId: string; targetId: string; kind: string }

export interface ReviewSourceIdentity { id: string; snapshotId: string; side: 'base' | 'head' }
export interface ReviewSourceIdentityMaps {
  /** Display node ID to the selected side's actual symbol ID and source snapshot. */
  symbols: Record<string, ReviewSourceIdentity>;
  /** Actual relationship occurrence ID to its retained snapshot. */
  relationships: Record<string, ReviewSourceIdentity>;
  /** Both base and head symbol IDs resolve to the same display node when they are a matched row. */
  displayBySymbolId: Record<string, string>;
}
export interface ReviewExplorerContext {
  graph: AtlasGraph;
  workspace: { id: string; path?: string; [key: string]: any };
  /** Fallback snapshot for explorer APIs. Selected review nodes/edges carry their own side snapshot. */
  snapshot: string;
  /** Inactive instances retain their journey state but do not own global listeners or a canvas. */
  active: boolean;
  mode: ReviewMode;
  sourceIdentityMaps: ReviewSourceIdentityMaps;
  reviewKey: string;
}

const sideFor = (mode: ReviewMode, _change: ReviewChange, base: any, head: any): 'base' | 'head' | null => {
  if (mode === 'BASE') return base ? 'base' : null;
  if (mode === 'HEAD') return head ? 'head' : null;
  // Overlay contains the post-change structure whenever it exists, plus removed base-only facts.
  return head ? 'head' : base ? 'base' : null;
};

export function projectReviewNodes(review: ReviewComparison, mode: ReviewMode): ProjectedReviewNode[] {
  return review.nodes.flatMap(row => {
    const side = sideFor(mode, row.change, row.base, row.head);
    if (!side) return [];
    return [{ comparisonKey: row.comparisonKey, change: row.change, addedLines: row.addedLines || 0,
      removedLines: row.removedLines || 0, side, snapshotId: side === 'base' ? review.base.snapshotId : review.head.snapshotId,
      node: side === 'base' ? row.base : row.head }];
  });
}

export function projectReviewRelationships(review: ReviewComparison, mode: ReviewMode): ProjectedReviewRelationship[] {
  return review.relationships.flatMap(row => {
    const side = sideFor(mode, row.change, row.base, row.head);
    if (!side) return [];
    return [{ comparisonKey: row.comparisonKey, change: row.change, side,
      snapshotId: side === 'base' ? review.base.snapshotId : review.head.snapshotId,
      relationship: side === 'base' ? row.base : row.head }];
  });
}

/** Overlay groups a route by ordered endpoints and its change status, never collapsing an added or
 * removed route into an unchanged one that happens to share its endpoints. */
export function projectReviewGraph(review: ReviewComparison, mode: ReviewMode) {
  const projected = projectReviewNodes(review, mode);
  // Snapshot-local IDs are not stable across analysis runs. A display ID derives from the opaque
  // comparison key; both sides of a modified resource map to it, keeping base-only relationships
  // visible beside after-change relationships in an overlay.
  const sourceToDisplay = new Map<string, string>();
  for (const row of review.nodes) {
    const displayId = `review-node:${row.comparisonKey}`;
    if (mode !== 'HEAD' && row.base?.id) sourceToDisplay.set(row.base.id, displayId);
    if (mode !== 'BASE' && row.head?.id) sourceToDisplay.set(row.head.id, displayId);
  }
  const nodes: ReviewGraphNode[] = projected.map(row => ({ ...row, id: sourceToDisplay.get(row.node.id)!, sourceId: row.node.id,
    parentId: row.node.parentId ? sourceToDisplay.get(row.node.parentId) : undefined,
    label: row.node.qualifiedName || row.node.simpleName || row.node.name || row.node.id,
    kind: row.node.kind || 'RESOURCE' }));
  const nodeIds = new Set(nodes.map(n => n.id));
  // Keep parser occurrences separate here. `projectDisplayed` is the graph adapter's one
  // occurrence aggregator: it retains occurrence IDs for source evidence and, in overlay mode,
  // groups by both endpoint pair and review status. Aggregating here would silently discard
  // duplicate call sites before that invariant has a chance to run.
  const edges: ReviewGraphEdge[] = [];
  for (const row of projectReviewRelationships(review, mode)) {
    const relationship = row.relationship;
    const sourceId = sourceToDisplay.get(relationship?.sourceId), targetId = sourceToDisplay.get(relationship?.targetId);
    if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;
    // The graph canvas will aggregate these occurrences for drawing, but the inspector and source
    // viewer must still receive the real retained-snapshot relationship ID. A row is one parser
    // occurrence, so never substitute its comparison key or the eventual aggregate route ID here.
    edges.push({ ...row, id: relationship.id || `review-edge:${row.comparisonKey}`, sourceId, targetId, kind: relationship.kind || 'relationship' });
  }
  return { nodes, edges, sourceToDisplay };
}

/** Convert comparison rows to the explorer's graph adapter shape. Comparison identity is used only
 * for display/navigation. API calls retain each side's real symbol/relationship ID and snapshot. */
export function toReviewAtlasGraph(mode: ReviewMode, projected: ReturnType<typeof projectReviewGraph>): AtlasGraph {
  return {
    nodes: projected.nodes.map(row => ({
      ...row.node,
      id: row.id,
      parentId: row.parentId,
      detailCount: 0,
      reviewSourceId: row.sourceId,
      ...(mode === 'OVERLAY' ? { reviewChange: row.change, reviewAddedLines: row.addedLines, reviewRemovedLines: row.removedLines } : {}),
      reviewSnapshotId: row.snapshotId,
      reviewSide: row.side
    } as AtlasNode)),
    edges: projected.edges.map(row => ({
      ...row.relationship,
      // Endpoint IDs are presentation IDs so graph navigation stays inside the projected graph.
      // The edge ID remains the occurrence ID; projectDisplayed's aggregate keeps it in
      // occurrenceIds, which source and explanation APIs consume.
      id: row.id,
      sourceId: row.sourceId,
      targetId: row.targetId,
      ...(mode === 'OVERLAY' ? { reviewChange: row.change } : {}),
      reviewSourceId: row.relationship?.id || row.id,
      reviewSnapshotId: row.snapshotId,
      reviewSide: row.side
    } as AtlasEdge))
  };
}

export function reviewSourceIdentityMaps(review: ReviewComparison, mode: ReviewMode, projected: ReturnType<typeof projectReviewGraph>): ReviewSourceIdentityMaps {
  const symbols: ReviewSourceIdentityMaps['symbols'] = {};
  for (const node of projected.nodes) symbols[node.id] = { id: node.sourceId, snapshotId: node.snapshotId, side: node.side };
  const relationships: ReviewSourceIdentityMaps['relationships'] = {};
  for (const edge of projected.edges) relationships[edge.id] = { id: edge.relationship?.id || edge.id, snapshotId: edge.snapshotId, side: edge.side };
  const displayBySymbolId: Record<string, string> = {};
  for (const row of review.nodes) {
    const displayId = `review-node:${row.comparisonKey}`;
    if (mode !== 'HEAD' && row.base?.id) displayBySymbolId[row.base.id] = displayId;
    if (mode !== 'BASE' && row.head?.id) displayBySymbolId[row.head.id] = displayId;
  }
  return { symbols, relationships, displayBySymbolId };
}

export function changeLabel(change: ReviewChange) {
  return change === 'ADDED' ? 'Added' : change === 'REMOVED' ? 'Removed' : change === 'MODIFIED' ? 'Changed' : 'Unchanged';
}
