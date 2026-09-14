import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
export default function SourceDialog({snapshot, subject, type='symbol', onClose}: {snapshot: string; subject: {id:string; simpleName?:string}; type?:string; onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [sources,setSources]=useState<any[]>([]), [error,setError]=useState(''), [loading,setLoading]=useState(true);
  useEffect(()=>{ dialog.current?.showModal(); let alive=true; apiClient.getSource(snapshot,subject.id,type).then(s=>{if(alive){setSources(Array.isArray(s)?s:[s]);setLoading(false);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[snapshot,subject.id,type]);
  useEffect(()=>{ body.current?.querySelector('.code-line.highlighted')?.scrollIntoView({block:'center'}); },[sources]);
  return <dialog className="source-dialog" ref={dialog} onCancel={onClose} onClose={onClose}><header><div><h2>{subject.simpleName || 'Relationship evidence'}</h2><p>Read-only source from the analyzed snapshot</p></div><button onClick={onClose} aria-label="Close source">✕</button></header>
    <div ref={body}>{!error&&sources.length>0&&sources[0].totalSites>sources.length&&<p className="notice">Showing the first {sources.length} of {sources[0].totalSites} source sites for this relationship.</p>}{error?<p className="notice">{error}</p>:sources.length?sources.map((source,i)=><section key={i}><div className="source-path">{source.path} <span>Lines {source.startLine}–{source.endLine}</span></div>{source.exact===false&&<p className="notice">File on disk has changed since this was indexed; this file may be outdated. Re-analyze the project to refresh it.</p>}{typeof source.content==='string'?<pre>{source.content.split('\n').map((line:string,n:number)=>{const num=n+1;return <div className={`code-line${num>=source.startLine&&num<=source.endLine?' highlighted':''}`} key={n}><span>{num}</span><code>{line || ' '}</code></div>;})}</pre>:<p className="notice">Source content unavailable for this occurrence.</p>}</section>):<p className="notice">{loading?'Loading source evidence…':'No source evidence stored for this occurrence. Re-analyze the project to refresh the index.'}</p>}</div>
  </dialog>;
}
