import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import {
  ReviewComparison,
  ReviewExplorerContext,
  ReviewMode,
  changeLabel,
  projectReviewGraph,
  projectReviewNodes,
  projectReviewRelationships,
  reviewSourceIdentityMaps,
  toReviewAtlasGraph,
} from './reviewModel';

type SourceTarget = { id: string; ids?: string[]; simpleName?: string; snapshotId: string; label: string; type: 'symbol' | 'relationships' };
type RenderExplorer = (context: ReviewExplorerContext) => ReactNode;
const MODES: ReviewMode[] = ['BASE', 'OVERLAY', 'HEAD'];
const titleOf = (item: any) => item?.qualifiedName || item?.simpleName || item?.name || 'Unnamed resource';
const kindOf = (item: any) => item?.kind?.toLowerCase().replaceAll('_', ' ') || 'resource';
const relationLabel = (item: any, names: Map<string, string>) => {
  const source = names.get(item?.sourceId) || item?.sourceName || 'Unknown source';
  const target = names.get(item?.targetId) || item?.targetName || item?.unresolvedTarget || 'Unknown target';
  return `${source} → ${target}`;
};

export default function ReviewPanel({ workspaceId, active = false, onSource, renderExplorer }: { workspaceId: string; active?: boolean; onSource: (target: SourceTarget) => void; renderExplorer: RenderExplorer }) {
  const [baseRef, setBaseRef] = useState('');
  const [review, setReview] = useState<ReviewComparison | null>(null);
  const [mode, setMode] = useState<ReviewMode>('OVERLAY');
  const [changedOnly, setChangedOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const resourceNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const row of review?.nodes || []) {
      if (row.base) names.set(row.base.id, titleOf(row.base));
      if (row.head) names.set(row.head.id, titleOf(row.head));
    }
    return names;
  }, [review]);
  const requestInFlight = useRef(false);
  const load = async (ref = baseRef) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true); setError('');
    try { setReview(await apiClient.createReview(workspaceId, ref)); }
    catch (e: any) { setError(e.message || 'Could not compare the working tree.'); }
    finally { requestInFlight.current = false; setLoading(false); }
  };
  useEffect(() => {
    // Opening the tab immediately shows the repository's default merge-base comparison. The panel
    // remains mounted when the user returns to the code map, so its three explorer journeys survive
    // the round trip without issuing another capture.
    if (active && !review && !loading && !requestInFlight.current) void load('');
    // `load` is intentionally event-local and requestInFlight guards StrictMode/rapid activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, workspaceId]);
  const nodes = useMemo(() => review ? projectReviewNodes(review, mode).filter(n => !changedOnly || n.change !== 'UNCHANGED') : [], [review, mode, changedOnly]);
  const relationships = useMemo(() => review ? projectReviewRelationships(review, mode) : [], [review, mode]);
  const displayRelationships = changedOnly && mode === 'OVERLAY' ? relationships.filter(r => r.change !== 'UNCHANGED') : relationships;
  // Keep one ordinary ExplorerApp journey per side. Each slot stays mounted while the radio view
  // changes; only its active canvas/listeners are enabled, so scope, expansion, resize, history and
  // inspection survive a trip to another review side.
  const contexts = useMemo(() => {
    if (!review) return null;
    const reviewKey = `${review.base.snapshotId}:${review.head.snapshotId}`;
    return Object.fromEntries(MODES.map(view => {
      const projected = projectReviewGraph(review, view);
      const graph = toReviewAtlasGraph(view, projected);
      const context: ReviewExplorerContext = {
        graph,
        workspace: { id: workspaceId, path: undefined },
        snapshot: view === 'BASE' ? review.base.snapshotId : review.head.snapshotId,
        active: false,
        mode: view,
        sourceIdentityMaps: reviewSourceIdentityMaps(review, view, projected),
        reviewKey,
      };
      return [view, context];
    })) as Record<ReviewMode, ReviewExplorerContext>;
  }, [review, workspaceId]);
  const submit = (event: FormEvent) => { event.preventDefault(); void load(); };
  const sourceFor = (item: any, snapshotId: string, side: 'base' | 'head', type: SourceTarget['type'] = 'symbol') => {
    if (!item?.id || (type === 'symbol' && item.kind === 'PACKAGE')) return;
    onSource({ id: item.id, simpleName: type === 'symbol' ? titleOf(item) : relationLabel(item, resourceNames), snapshotId, label: side === 'base' ? 'base snapshot' : 'changed snapshot', type });
  };
  return <section className="review-panel" aria-label="Review changes">
    <header className="review-heading"><div><p className="review-kicker">Git review</p><h1>Review the change in context</h1><p>Compare the working tree with a base revision. Facts and source evidence remain pinned to their snapshot.</p></div></header>
    <form className="review-form" onSubmit={submit}><label>Base revision<input aria-label="Base revision" value={baseRef} onChange={e => setBaseRef(e.target.value)} placeholder="Default merge base, or origin/main" /></label><button className="primary" aria-label="Compare changes" disabled={loading}>{loading ? 'Comparing…' : 'Compare changes'}</button></form>
    {error && <p className="notice" role="alert">{error}</p>}
    {!review && !loading && !error && <p className="notice">No comparison is available yet.</p>}
    {review && contexts && <>
      <div className="review-summary" aria-label="Review summary"><span><b data-testid="review-added-lines">+{review.summary.addedLines}</b> lines added</span><span><b data-testid="review-removed-lines">−{review.summary.removedLines}</b> lines removed</span><span>{review.summary.changedFiles} changed files</span><span>Base: <code>{review.base.resolvedRef || review.base.requestedRef || 'merge base'}</code></span></div>
      {review.files?.length ? <details className="review-files"><summary>{review.files.length} changed files, including non-Java files without graph resources</summary><div>{review.files.map(file => <p key={file.path}><code>{file.status}</code> {file.path} {file.lineCountsAvailable ? <span>+{file.addedLines} −{file.removedLines}</span> : <span>Binary or non-text file; line counts unavailable</span>} {!file.javaFile && <em>Not part of the Java relationship graph</em>}</p>)}</div></details> : null}
      {review.base.warning && <p className="notice">{review.base.warning}</p>}
      <fieldset className="review-mode"><legend>Review view</legend>{([['BASE','Base codebase'],['OVERLAY','Base + changes'],['HEAD','After changes']] as const).map(([value,label]) => <label key={value}><input type="radio" name="review-view" value={value} checked={mode === value} onChange={() => setMode(value)} />{label}</label>)}</fieldset>
      <div className="review-toolbar"><label><input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} />Changed resources in list only</label>{mode === 'OVERLAY' && <span>Changed resources are amber; added relationships are green; removed relationships are red and dashed.</span>}</div>
      <section className="review-map-section"><h2>Relationship map</h2><div className="review-explorer-stack">{MODES.map(view => <div className={`review-explorer-instance review-view-${view.toLowerCase()}`} key={view} hidden={mode !== view} aria-hidden={mode !== view}>{renderExplorer({ ...contexts[view], active: active && mode === view })}</div>)}</div></section>
      <div className="review-columns"><section><h2>{changedOnly ? 'Changed resources' : 'Resources'} <small>{nodes.length}</small></h2><div className="review-resources">{nodes.map(row => <article key={row.comparisonKey} data-testid={`review-resource-${row.comparisonKey}`} className={`review-resource review-change-${row.change.toLowerCase()}`}><div><span className="review-change">{mode === 'OVERLAY' ? changeLabel(row.change) : kindOf(row.node)}</span><h3>{titleOf(row.node)}</h3><p>{kindOf(row.node)} · <b>+{row.addedLines}</b> <b>−{row.removedLines}</b></p></div><button aria-label={`View source from ${row.side === 'base' ? 'base' : 'changed'} snapshot`} disabled={row.node?.kind === 'PACKAGE'} title={row.node?.kind === 'PACKAGE' ? 'Packages do not have a declaration source range' : undefined} onClick={() => sourceFor(row.node, row.snapshotId, row.side)}>View source</button></article>)}</div>{!nodes.length && <p className="review-empty">No resources match this view.</p>}</section>
        <section><h2>Relationships <small>{displayRelationships.length}</small></h2><div className="review-relationships">{displayRelationships.map(row => <article key={row.comparisonKey} data-testid={`review-relationship-${row.comparisonKey}`} className={`review-relationship review-relation-${row.change.toLowerCase()}`}><i aria-hidden="true"/><div><span>{mode === 'OVERLAY' ? changeLabel(row.change) : row.relationship?.kind?.toLowerCase().replaceAll('_', ' ')}</span><strong>{relationLabel(row.relationship, resourceNames)}</strong><small>{row.relationship?.resolution?.toLowerCase() || 'resolution unavailable'}</small></div><button aria-label={`View relationship source from ${row.side === 'base' ? 'base' : 'changed'} snapshot`} disabled={!row.relationship?.id} onClick={() => sourceFor(row.relationship, row.snapshotId, row.side, 'relationships')}>Evidence</button></article>)}</div>{!displayRelationships.length && <p className="review-empty">No relationships match this view.</p>}</section></div>
      {review.diagnostics?.length ? <details className="review-diagnostics"><summary>{review.diagnostics.length} comparison diagnostics</summary>{review.diagnostics.map(d => <p key={`${d.code}:${d.message}`}>{d.severity.toLowerCase()}: {d.message}</p>)}</details> : null}
    </>}
  </section>;
}
