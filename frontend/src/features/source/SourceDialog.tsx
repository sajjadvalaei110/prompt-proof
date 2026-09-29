import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { FileEvidence, groupSourceEvidence, highlightedLines, rangeSummary } from './sourceEvidence';
import { DiffRow, ReviewHunk, buildUnifiedRows, toSplitRows } from './fileDiff';
/** Mirrors SourceService.MAX_BATCH_IDS: larger routes show evidence for their first occurrences and say so. */
const MAX_BATCH_IDS = 5000;
/** `subject.ids` (with type 'relationships') asks for every occurrence behind one merged graph route at once. */
export interface SourceSubject { id: string; simpleName?: string; ids?: string[] }
/** Diff data for the review-mode dialog. Every file this dialog can show belongs to one pinned
 * snapshot (`snapshot`, either the base or head side); `filesByPath` names which paths changed and
 * carries the `git diff --unified=0` hunks needed to place added/removed lines against the other
 * side's retained content (fetched on demand -- see the effect below). */
export interface ReviewDiffContext { baseSnapshotId: string; headSnapshotId: string; filesByPath: Record<string, { status: string; hunks: ReviewHunk[]; lineCountsAvailable: boolean }> }
const DIFF_LAYOUT_KEY = 'sourceDiffLayout';
export default function SourceDialog({snapshot, subject, type='symbol', snapshotLabel='analyzed snapshot', historical=false, reviewDiff, onClose}: {snapshot: string; subject: SourceSubject; type?:string; snapshotLabel?: string; historical?: boolean; reviewDiff?: ReviewDiffContext; onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [files,setFiles]=useState<FileEvidence[]>([]), [error,setError]=useState(''), [loading,setLoading]=useState(true);
  // Populated only for files reviewDiff names as changed, once the other side's content has been
  // fetched (a second, non-blocking step after the ordinary evidence request below resolves).
  const [diffRowsByPath,setDiffRowsByPath]=useState<Map<string,DiffRow[]>>(new Map());
  const [layout,setLayout]=useState<'unified'|'split'>(()=>{try{return localStorage.getItem(DIFF_LAYOUT_KEY)==='split'?'split':'unified';}catch{return'unified';}});
  const setDiffLayout=(next:'unified'|'split')=>{setLayout(next);try{localStorage.setItem(DIFF_LAYOUT_KEY,next);}catch{}};
  // Which pinned snapshot this whole dialog instance is showing -- every file in it comes from the
  // same `snapshot`, so the diff side (which one is "old" and which is "new") is fixed for the dialog.
  const diffSide:'base'|'head'|null = reviewDiff ? (snapshot===reviewDiff.baseSnapshotId?'base':snapshot===reviewDiff.headSnapshotId?'head':null) : null;
  // Server-side truncation of a *single* occurrence's evidence: SourceService.relationship() caps rows
  // at the configured evidence-occurrence limit and reports the true count as `totalSites`. That field
  // lives on the raw rows and is deliberately not part of FileEvidence (grouping is per file, this is
  // per request), so it is captured here before groupSourceEvidence folds the rows together.
  const [serverSites,setServerSites]=useState<{shown:number;total:number}|null>(null);
  // Memoized on the array identity: the join stays exact (a digest could collide and silently skip a
  // refetch), but a ~185KB string is no longer rebuilt on every render pass merely to compare it.
  const idsKey=useMemo(()=>subject.ids?.join(',')||'',[subject.ids]);
  useEffect(()=>{
    // showModal() throws InvalidStateError on an already-open dialog (HTML standard 4.12.3), and this
    // effect re-runs on any dependency change while the dialog is open (a background analysis poll
    // replacing `snapshot`, or a different occurrence chosen in the inspector).
    if(!dialog.current?.open)dialog.current?.showModal();
    // A dialog stays mounted while callers select another symbol or occurrence. Clear the prior
    // snapshot's evidence before issuing the new request so it cannot appear under a new review fact.
    setFiles([]);setError('');setLoading(true);setServerSites(null);setDiffRowsByPath(new Map());
    let alive=true;
    const request=type==='relationships'&&subject.ids?apiClient.getRelationshipsSource(snapshot,subject.ids.slice(0,MAX_BATCH_IDS)):apiClient.getSource(snapshot,subject.id,type);
    request.then(s=>{if(!alive)return;
      const rows=Array.isArray(s)?s:[s];
      const grouped=groupSourceEvidence(rows);
      setFiles(grouped);
      const total=rows.reduce((m:number,r:any)=>Math.max(m,r?.totalSites||0),0);
      setServerSites(total>rows.length?{shown:rows.length,total}:null);
      setLoading(false);
      // Diff content is fetched after the ordinary evidence resolves and does not block it: a review
      // dialog still shows the pinned source immediately, then upgrades changed files to a diff.
      if(!reviewDiff||!diffSide)return;
      const changed=grouped.filter(f=>reviewDiff.filesByPath[f.path]?.lineCountsAvailable);
      if(!changed.length)return;
      const otherSnapshot=diffSide==='base'?reviewDiff.headSnapshotId:reviewDiff.baseSnapshotId;
      Promise.all(changed.map(f=>apiClient.getSnapshotFile(otherSnapshot,f.path).then(r=>r.content as string|null).catch(()=>null)))
        .then(others=>{
          if(!alive)return;
          const next=new Map<string,DiffRow[]>();
          changed.forEach((f,i)=>{
            const hunks=reviewDiff.filesByPath[f.path].hunks;
            const other=others[i];
            const current=typeof f.content==='string'?f.content:null;
            const oldText=diffSide==='base'?current:other;
            const newText=diffSide==='base'?other:current;
            next.set(f.path,buildUnifiedRows(oldText,newText,hunks));
          });
          setDiffRowsByPath(next);
        });
    }).catch(e=>{if(alive){setError(e.message);setLoading(false);}});
    return()=>{alive=false;};
  },[snapshot,subject.id,idsKey,type,reviewDiff,diffSide]);
  useEffect(()=>{ body.current?.querySelector('.highlighted')?.scrollIntoView({block:'center'}); },[files,diffRowsByPath,layout]);
  const lineCount=files.reduce((n,f)=>n+f.ranges.length,0);
  const truncated=type==='relationships'&&(subject.ids?.length||0)>MAX_BATCH_IDS;
  const anyDiff=diffRowsByPath.size>0;
  return <dialog className={`source-dialog${anyDiff&&layout==='split'?' source-dialog-split':''}`} ref={dialog} onCancel={onClose} onClose={onClose}><header><div><h2>{subject.simpleName || 'Relationship evidence'}</h2><p>Read-only source from the {snapshotLabel}{files.length>0&&type!=='symbol'?` · ${lineCount} highlighted ${lineCount===1?'range':'ranges'} in ${files.length} ${files.length===1?'file':'files'}`:''}</p></div>{anyDiff&&<div className="diff-layout-toggle" role="group" aria-label="Diff layout"><button aria-pressed={layout==='unified'} onClick={()=>setDiffLayout('unified')}>Unified</button><button aria-pressed={layout==='split'} onClick={()=>setDiffLayout('split')}>Split</button></div>}<button onClick={onClose} aria-label="Close source">✕</button></header>{truncated&&<p className="notice">Showing evidence for the first {MAX_BATCH_IDS} of {subject.ids!.length} occurrences on this line. Narrow the scope or relationship filter to see the rest.</p>}{!error&&serverSites&&<p className="notice">Showing the first {serverSites.shown} of {serverSites.total} source sites for this relationship.</p>}
    <div ref={body}>{error?<p className="notice">{error}</p>:files.length?files.map(file=>{
      const diffRows=diffRowsByPath.get(file.path);
      const changeStatus=reviewDiff?.filesByPath[file.path]?.status;
      return <section key={file.path}><div className="source-path">{file.path} <span>{diffRows?(changeStatus==='ADDED'?'Added file':changeStatus==='DELETED'?'Removed file':'Changed file'):file.ranges.length>1?`${file.ranges.length} ranges · lines ${rangeSummary(file)}`:`Lines ${rangeSummary(file)}`}</span></div>{file.exact===false&&<p className="notice">{historical ? 'This captured comparison source is pinned to its review snapshot.' : 'File on disk has changed since this was indexed; this file may be outdated. Re-analyze the project to refresh it.'}</p>}
      {diffRows ? (layout==='unified' ? renderUnifiedDiff(diffRows,diffSide,file) : renderSplitDiff(diffRows,diffSide,file)) :
        typeof file.content==='string'?(()=>{const lines=file.content.split('\n');const marked=highlightedLines(file,lines.length);return <pre>{lines.map((line:string,n:number)=>{const num=n+1;const kinds=marked.get(num);return <div className={`code-line${kinds?' highlighted':''}`} key={n} title={kinds?.length?kinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span>{num}</span><code>{line || ' '}</code></div>;})}</pre>;})():<p className="notice">Source content unavailable for this occurrence.</p>}</section>;
    }):<p className="notice">{loading?'Loading source evidence…':'No source evidence stored for this occurrence. Re-analyze the project to refresh the index.'}</p>}</div>
  </dialog>;
}
/** Unified layout: one column, +/- gutter markers, highlighted declaration/evidence ranges keyed to
 * whichever side's numbering this dialog's pinned snapshot uses (`diffSide`). */
function renderUnifiedDiff(rows: DiffRow[], diffSide: 'base'|'head'|null, file: FileEvidence) {
  const sideLineCount=rows.reduce((max,r)=>Math.max(max,(diffSide==='head'?r.newNo:r.oldNo)||0),0);
  const marked=highlightedLines(file,sideLineCount);
  return <pre className="diff-unified">{rows.map((row,n)=>{
    const currentLineNo=diffSide==='head'?row.newNo:row.oldNo;
    const kinds=currentLineNo!=null?marked.get(currentLineNo):undefined;
    return <div className={`code-line diff-row-${row.type}${kinds?' highlighted':''}`} key={n} title={kinds?.length?kinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}>
      <span className="diff-gutter">{row.oldNo??''}</span><span className="diff-gutter">{row.newNo??''}</span>
      <span className="diff-marker" aria-hidden="true">{row.type==='add'?'+':row.type==='del'?'−':''}</span>
      <code>{row.text || ' '}</code>
    </div>;
  })}</pre>;
}
/** Split layout: base on the left, after-change on the right, hunks aligned; a padded side renders a
 * blank row so the two columns stay in step. Highlights the same declaration/evidence ranges the
 * unified layout does, on whichever column is this dialog's pinned side (`diffSide`) -- left/oldNo
 * for 'base', right/newNo for 'head' -- since that numbering is the one `file`'s ranges are keyed to. */
function renderSplitDiff(rows: DiffRow[], diffSide: 'base'|'head'|null, file: FileEvidence) {
  const pinnedRight=diffSide==='head';
  const sideLineCount=rows.reduce((max,r)=>Math.max(max,(pinnedRight?r.newNo:r.oldNo)||0),0);
  const marked=highlightedLines(file,sideLineCount);
  const split=toSplitRows(rows);
  return <div className="diff-split-table" role="table">{split.map((pair,n)=>{
    const leftKinds=!pinnedRight&&pair.left?.oldNo!=null?marked.get(pair.left.oldNo):undefined;
    const rightKinds=pinnedRight&&pair.right?.newNo!=null?marked.get(pair.right.newNo):undefined;
    return <div className="diff-split-row" role="row" key={n}>
    <div className={`diff-split-cell${pair.left?` diff-row-${pair.left.type}`:' diff-split-blank'}${leftKinds?' highlighted':''}`} role="cell" title={leftKinds?.length?leftKinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span className="diff-gutter">{pair.left?.oldNo??''}</span><code>{pair.left?(pair.left.text||' '):''}</code></div>
    <div className={`diff-split-cell${pair.right?` diff-row-${pair.right.type}`:' diff-split-blank'}${rightKinds?' highlighted':''}`} role="cell" title={rightKinds?.length?rightKinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span className="diff-gutter">{pair.right?.newNo??''}</span><code>{pair.right?(pair.right.text||' '):''}</code></div>
  </div>;})}</div>;
}
