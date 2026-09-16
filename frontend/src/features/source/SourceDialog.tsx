import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { FileEvidence, groupSourceEvidence, highlightedLines, rangeSummary } from './sourceEvidence';
/** Mirrors SourceService.MAX_BATCH_IDS: larger routes show evidence for their first occurrences and say so. */
const MAX_BATCH_IDS = 5000;
/** `subject.ids` (with type 'relationships') asks for every occurrence behind one merged graph route at once. */
export interface SourceSubject { id: string; simpleName?: string; ids?: string[] }
export default function SourceDialog({snapshot, subject, type='symbol', onClose}: {snapshot: string; subject: SourceSubject; type?:string; onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [files,setFiles]=useState<FileEvidence[]>([]), [error,setError]=useState(''), [loading,setLoading]=useState(true);
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
    let alive=true;
    const request=type==='relationships'&&subject.ids?apiClient.getRelationshipsSource(snapshot,subject.ids.slice(0,MAX_BATCH_IDS)):apiClient.getSource(snapshot,subject.id,type);
    request.then(s=>{if(alive){
      const rows=Array.isArray(s)?s:[s];
      setFiles(groupSourceEvidence(rows));
      const total=rows.reduce((m:number,r:any)=>Math.max(m,r?.totalSites||0),0);
      setServerSites(total>rows.length?{shown:rows.length,total}:null);
      setLoading(false);
    }}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[snapshot,subject.id,idsKey,type]);
  useEffect(()=>{ body.current?.querySelector('.code-line.highlighted')?.scrollIntoView({block:'center'}); },[files]);
  const lineCount=files.reduce((n,f)=>n+f.ranges.length,0);
  const truncated=type==='relationships'&&(subject.ids?.length||0)>MAX_BATCH_IDS;
  return <dialog className="source-dialog" ref={dialog} onCancel={onClose} onClose={onClose}><header><div><h2>{subject.simpleName || 'Relationship evidence'}</h2><p>Read-only source from the analyzed snapshot{files.length>0&&type!=='symbol'?` · ${lineCount} highlighted ${lineCount===1?'range':'ranges'} in ${files.length} ${files.length===1?'file':'files'}`:''}</p></div><button onClick={onClose} aria-label="Close source">✕</button></header>{truncated&&<p className="notice">Showing evidence for the first {MAX_BATCH_IDS} of {subject.ids!.length} occurrences on this line. Narrow the scope or relationship filter to see the rest.</p>}{!error&&serverSites&&<p className="notice">Showing the first {serverSites.shown} of {serverSites.total} source sites for this relationship.</p>}
    <div ref={body}>{error?<p className="notice">{error}</p>:files.length?files.map(file=><section key={file.path}><div className="source-path">{file.path} <span>{file.ranges.length>1?`${file.ranges.length} ranges · lines ${rangeSummary(file)}`:`Lines ${rangeSummary(file)}`}</span></div>{file.exact===false&&<p className="notice">File on disk has changed since this was indexed; this file may be outdated. Re-analyze the project to refresh it.</p>}{typeof file.content==='string'?(()=>{const lines=file.content.split('\n');const marked=highlightedLines(file,lines.length);return <pre>{lines.map((line:string,n:number)=>{const num=n+1;const kinds=marked.get(num);return <div className={`code-line${kinds?' highlighted':''}`} key={n} title={kinds?.length?kinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span>{num}</span><code>{line || ' '}</code></div>;})}</pre>;})():<p className="notice">Source content unavailable for this occurrence.</p>}</section>):<p className="notice">{loading?'Loading source evidence…':'No source evidence stored for this occurrence. Re-analyze the project to refresh the index.'}</p>}</div>
  </dialog>;
}
