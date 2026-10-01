import { useEffect, useMemo, useRef, useState } from 'react';
import { DefinitionLocation, apiClient } from '../../api/client';
import { FileEvidence, groupSourceEvidence, highlightedLines, rangeSummary } from './sourceEvidence';
import { DiffRow, ReviewHunk, SplitRow, buildUnifiedRows, toSplitRows } from './fileDiff';
import { FileOccurrences, LineMark, LineOccurrence, decodeOccurrences, lineSegments, navigationHint, occurrencesByLine } from './codeTokens';
import { NavStack, NavView, canGoBack, canGoForward, currentView, initialNavStack, pushView, stepView } from './navigationStack';
import { FindOptions, FindResult, findCounter, findMatches, stepMatch } from './findInFile';
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
/** Occurrence requests in flight at once; a dialog can show many files. */
const MAX_OCCURRENCE_REQUESTS = 4;
type OccurrenceState = FileOccurrences | 'loading' | 'failed';
type NavMessage = { text: string; hint?: boolean } | null;
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** Cache key of one file of one snapshot, so a late answer for an earlier snapshot can never be read as the current one's. */
const fileKey = (snapshot: string, path: string) => `${snapshot}\u0000${path}`;
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
  // Go to definition (ADR 0013). The back/forward stack is dialog-local and never journey history.
  const [nav,setNav]=useState<NavStack>(initialNavStack);
  const [navMessage,setNavMessage]=useState<NavMessage>(null);
  const [picker,setPicker]=useState<DefinitionLocation[]|null>(null);
  // Caches keyed by (snapshot, path): whole files opened by a jump, and each file's occurrences (fetched once per
  // file). Clearing them on a snapshot change is not enough on its own: a request still in flight would refill
  // a path-only key with the previous snapshot's answer.
  const [fileCache,setFileCache]=useState<Map<string,{content?:string;error?:string}>>(new Map());
  const [occurrences,setOccurrences]=useState<Map<string,OccurrenceState>>(new Map());
  // Occurrences are fetched only once the user shows navigation intent (Ctrl/Cmd held, or a jump made).
  const [navArmed,setNavArmed]=useState(false),[modHeld,setModHeld]=useState(false);
  useEffect(()=>{setFileCache(new Map());setOccurrences(new Map());setNavArmed(false);},[snapshot]);
  useEffect(()=>{
    // showModal() throws InvalidStateError on an already-open dialog (HTML standard 4.12.3), and this
    // effect re-runs on any dependency change while the dialog is open (a background analysis poll
    // replacing `snapshot`, or a different occurrence chosen in the inspector).
    if(!dialog.current?.open)dialog.current?.showModal();
    // A dialog stays mounted while callers select another symbol or occurrence. Clear the prior
    // snapshot's evidence before issuing the new request so it cannot appear under a new review fact.
    setFiles([]);setError('');setLoading(true);setServerSites(null);setDiffRowsByPath(new Map());
    setNav(initialNavStack());setNavMessage(null);setPicker(null);
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
  const view:NavView=currentView(nav);
  useEffect(()=>{ if(view.kind==='evidence'&&nav.entries[nav.index].scrollTop===null)body.current?.querySelector('.highlighted')?.scrollIntoView({block:'center'}); },[files,diffRowsByPath,layout]);
  // A jump shows the target's whole file from this snapshot; fetched once per path.
  useEffect(()=>{
    if(view.kind!=='file'||fileCache.has(fileKey(snapshot,view.path)))return;
    const path=view.path,key=fileKey(snapshot,path);
    setFileCache(m=>new Map(m).set(key,{}));
    apiClient.getSnapshotFile(snapshot,path).then(r=>setFileCache(m=>new Map(m).set(key,{content:typeof r?.content==='string'?r.content:''})))
      .catch(e=>setFileCache(m=>new Map(m).set(key,{error:e.message})));
  },[view,snapshot,fileCache]);
  const shownFiles=useMemo<FileEvidence[]>(()=>{
    if(view.kind==='evidence')return files;
    const cached=fileCache.get(fileKey(snapshot,view.path));
    return cached?.content!==undefined?[{path:view.path,content:cached.content,ranges:[{startLine:view.line,endLine:view.endLine}]}]:[];
  },[view,snapshot,files,fileCache]);
  const fileViewError=view.kind==='file'?fileCache.get(fileKey(snapshot,view.path))?.error:undefined;

  // Find in file (ADR 0013): literal text over exactly what is rendered -- plain lines, or the diff rows
  // of the current layout -- so it works for every snapshot, language and mode.
  const findInput=useRef<HTMLInputElement>(null);
  const [findOpen,setFindOpen]=useState(false),[query,setQuery]=useState(''),[findOptions,setFindOptions]=useState<FindOptions>({matchCase:false,wholeWord:false}),[activeMatch,setActiveMatch]=useState(-1);
  const sections=useMemo(()=>shownFiles.map(file=>{
    const rows=view.kind==='evidence'?diffRowsByPath.get(file.path):undefined;
    if(rows)return layout==='unified'?{file,kind:'unified' as const,rows}:{file,kind:'split' as const,rows,split:toSplitRows(rows)};
    if(typeof file.content==='string')return{file,kind:'plain' as const,lines:file.content.split('\n')};
    return{file,kind:'none' as const};
  }),[shownFiles,view,diffRowsByPath,layout]);
  // Occurrences for the plain (non-diff) files on screen, at most a few requests at a time.
  useEffect(()=>{
    if(!navArmed)return;
    const wanted=sections.filter(s=>s.kind==='plain'&&!occurrences.has(fileKey(snapshot,s.file.path))).map(s=>s.file.path);
    const inFlight=[...occurrences.values()].filter(v=>v==='loading').length;
    const batch=wanted.slice(0,Math.max(0,MAX_OCCURRENCE_REQUESTS-inFlight));
    if(!batch.length)return;
    setOccurrences(m=>{const next=new Map(m);batch.forEach(p=>next.set(fileKey(snapshot,p),'loading'));return next;});
    for(const path of batch){
      const key=fileKey(snapshot,path);
      apiClient.getFileOccurrences(snapshot,path)
        .then(r=>setOccurrences(m=>new Map(m).set(key,decodeOccurrences(r))))
        .catch(()=>setOccurrences(m=>new Map(m).set(key,'failed')));
    }
  },[navArmed,sections,occurrences,snapshot]);
  // Clickable ranges per file and line; only rows the engine wrote make a token clickable.
  const occurrenceLines=useMemo(()=>{
    const byPath=new Map<string,Map<number,LineOccurrence[]>>();
    for(const s of sections){
      const data=s.kind==='plain'?occurrences.get(fileKey(snapshot,s.file.path)):undefined;
      if(s.kind!=='plain'||!data||typeof data==='string'||data.status!=='indexed')continue;
      byPath.set(s.file.path,occurrencesByLine(data.occurrences,s.lines.map(l=>l.length)));
    }
    return byPath;
  },[sections,occurrences,snapshot]);
  const findTargets=useMemo(()=>{
    const keys:string[]=[],texts:string[]=[];
    const add=(key:string,text:string)=>{keys.push(key);texts.push(text);};
    for(const s of sections){
      if(s.kind==='plain')s.lines.forEach((line,n)=>add(`${s.file.path}#${n}`,line));
      else if(s.kind==='unified')s.rows.forEach((row,n)=>add(`${s.file.path}#u${n}`,row.text));
      else if(s.kind==='split')s.split.forEach((pair,n)=>{if(pair.left)add(`${s.file.path}#l${n}`,pair.left.text);if(pair.right)add(`${s.file.path}#r${n}`,pair.right.text);});
    }
    return{keys,texts};
  },[sections]);
  const findResult=useMemo<FindResult>(()=>findOpen?findMatches(findTargets.texts,query,findOptions):{matches:[],capped:false},[findOpen,findTargets,query,findOptions]);
  useEffect(()=>{setActiveMatch(findResult.matches.length?0:-1);},[findResult]);
  const marksByKey=useMemo(()=>{
    const byKey=new Map<string,LineMark[]>();
    findResult.matches.forEach((m,i)=>{const key=findTargets.keys[m.line];let list=byKey.get(key);if(!list){list=[];byKey.set(key,list);}list.push({start:m.start,end:m.end,kind:i===activeMatch?'active':'match'});});
    return byKey;
  },[findResult,findTargets,activeMatch]);
  useEffect(()=>{ if(activeMatch>=0)body.current?.querySelector('.find-active')?.scrollIntoView({block:'center'}); },[activeMatch,findResult]);
  const openFind=()=>{setFindOpen(true);requestAnimationFrame(()=>{findInput.current?.focus();findInput.current?.select();});};
  const closeFind=()=>{setFindOpen(false);setActiveMatch(-1);};
  const step=(dir:1|-1)=>setActiveMatch(i=>stepMatch(i,findResult.matches.length,dir));
  const onDialogKeyDown=(e:React.KeyboardEvent)=>{
    trackModifier(e);
    if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='f'){e.preventDefault();openFind();}
    else if(e.altKey&&!e.ctrlKey&&!e.metaKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();goBackForward(e.key==='ArrowLeft'?-1:1);}
  };
  const onFindKeyDown=(e:React.KeyboardEvent<HTMLInputElement>)=>{
    if(e.key==='Enter'){e.preventDefault();step(e.shiftKey?-1:1);}
    else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeFind();}
  };
  /**
   * One line's code text: plain text when nothing marks it, otherwise text-only spans (never HTML).
   * `at` (plain sections only) adds the file's occurrence rows for that line and the jump target.
   */
  const code=(key:string,text:string,at?:{path:string;line:number})=>{
    let marks=marksByKey.get(key);
    const occs=at?occurrenceLines.get(at.path)?.get(at.line):undefined;
    if(at&&view.kind==='file'&&view.path===at.path&&view.line===at.line){
      const end=view.endLine===view.line?view.endColumn:text.length;
      marks=[...(marks||[]),{start:view.startColumn-1,end,kind:'target'}];
    }
    if(!marks&&!occs)return text||' ';
    const data=at?occurrences.get(fileKey(snapshot,at.path)):undefined;
    const symbols=data&&typeof data!=='string'?data.symbols:[];
    return lineSegments(text,occs,marks).map(seg=>{
      const cls=[seg.active?'find-match find-active':seg.match?'find-match':'',seg.target?'nav-target':'',seg.occurrence?'nav-token':''].filter(Boolean).join(' ')||undefined;
      if(!seg.occurrence)return <span key={seg.start} className={cls}>{seg.text}</span>;
      const o=seg.occurrence,symbol=symbols[o.symbol];
      const external=symbol?.definitions===0;
      const token=o.endLine===o.line&&o.line===at!.line?text.slice(o.startColumn-1,o.endColumn):seg.text;
      return <span key={seg.start} className={cls} data-occ-line={o.line} data-occ-col={o.startColumn} data-occ-token={token}
        title={external?`${symbol?.displayName||token} · outside workspace`:undefined}>{seg.text}</span>;
    });
  };
  /** Opens a definition location in this dialog, remembering where the user was. */
  const jumpTo=(loc:DefinitionLocation)=>{
    setPicker(null);setNavMessage(null);setNavArmed(true);
    setNav(n=>pushView(n,{kind:'file',path:loc.path,line:loc.startLine,startColumn:loc.startColumn,endLine:loc.endLine,endColumn:loc.endColumn},dialog.current?.scrollTop||0));
  };
  const goBackForward=(dir:-1|1)=>{setPicker(null);setNavMessage(null);setNav(n=>stepView(n,dir,dialog.current?.scrollTop||0));};
  /** Ctrl/Cmd+click inside a plain file: go to the definition of the name under the pointer, if it has one. */
  const onCodeClick=(e:React.MouseEvent,path:string)=>{
    if(!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();
    const data=occurrences.get(fileKey(snapshot,path));
    if(data&&typeof data!=='string'&&data.status==='not_indexed'){setNavMessage({text:navigationHint(data),hint:true});return;}
    if(!data){setNavArmed(true);return;}
    const token=(e.target as HTMLElement).closest('[data-occ-line]') as HTMLElement|null;
    if(!token)return;
    const line=Number(token.dataset.occLine),column=Number(token.dataset.occCol),name=token.dataset.occToken||'';
    setPicker(null);setNavMessage(null);
    apiClient.getDefinition(snapshot,path,line,column).then(result=>{
      if(result.status==='not_indexed')setNavMessage({text:navigationHint(result),hint:true});
      else if(result.status==='external')setNavMessage({text:`${name} · outside workspace`});
      else if(result.status==='found'){
        const others=result.locations.filter(l=>!(l.path===path&&l.startLine===line&&l.startColumn===column));
        if(!others.length)setNavMessage({text:`${name} · this is its definition`});
        else if(result.locations.length===1)jumpTo(result.locations[0]);
        else setPicker(result.locations);
      }
    }).catch(err=>setNavMessage({text:`Go to definition failed: ${err.message}`}));
  };
  // Restore an entry's remembered scroll offset after Back/Forward (0, the top, included), or centre a fresh
  // jump's target, once it renders.
  const restored=useRef<NavStack|null>(null);
  useEffect(()=>{
    if(restored.current===nav||!sections.length)return;
    restored.current=nav;
    const entry=nav.entries[nav.index];
    if(entry.scrollTop!==null){if(dialog.current)dialog.current.scrollTop=entry.scrollTop;}
    else if(view.kind==='file')body.current?.querySelector('.nav-target, .highlighted')?.scrollIntoView({block:'center'});
  },[nav,sections,view]);
  const trackModifier=(e:{ctrlKey:boolean;metaKey:boolean})=>{const held=e.ctrlKey||e.metaKey;if(held!==modHeld)setModHeld(held);if(held&&!navArmed)setNavArmed(true);};
  useEffect(()=>{const release=()=>setModHeld(false);window.addEventListener('blur',release);return()=>window.removeEventListener('blur',release);},[]);

  const lineCount=files.reduce((n,f)=>n+f.ranges.length,0);
  const truncated=type==='relationships'&&(subject.ids?.length||0)>MAX_BATCH_IDS;
  const anyDiff=diffRowsByPath.size>0;
  const fileView=view.kind==='file'?view:null;
  return <dialog className={`source-dialog${anyDiff&&layout==='split'&&!fileView?' source-dialog-split':''}${modHeld?' nav-armed':''}`} ref={dialog} tabIndex={-1} onCancel={onClose} onClose={onClose} onKeyDown={onDialogKeyDown} onKeyUp={trackModifier} onMouseMove={trackModifier}><header><div><h2>{fileView?fileName(fileView.path):subject.simpleName || 'Relationship evidence'}</h2><p>{fileView?<>Definition at line {fileView.line} · read-only source from the {snapshotLabel}</>:<>Read-only source from the {snapshotLabel}{files.length>0&&type!=='symbol'?` · ${lineCount} highlighted ${lineCount===1?'range':'ranges'} in ${files.length} ${files.length===1?'file':'files'}`:''}</>}</p></div><div className="source-actions">{nav.entries.length>1&&<><button onClick={()=>goBackForward(-1)} disabled={!canGoBack(nav)} aria-label="Back" title="Back (Alt+←)">←</button><button onClick={()=>goBackForward(1)} disabled={!canGoForward(nav)} aria-label="Forward" title="Forward (Alt+→)">→</button></>}{anyDiff&&!fileView&&<div className="diff-layout-toggle" role="group" aria-label="Diff layout"><button aria-pressed={layout==='unified'} onClick={()=>setDiffLayout('unified')}>Unified</button><button aria-pressed={layout==='split'} onClick={()=>setDiffLayout('split')}>Split</button></div>}<button onClick={openFind} aria-label="Find in file" title="Find in file (Ctrl/Cmd+F)">Find</button><button onClick={onClose} aria-label="Close source">✕</button></div>
    {findOpen&&<div className="find-bar" role="search"><input ref={findInput} type="search" aria-label="Find in file" placeholder="Find" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onFindKeyDown}/><span className="find-count" aria-live="polite">{findCounter(activeMatch,findResult,query)}</span><button aria-pressed={findOptions.matchCase} title="Match case" aria-label="Match case" onClick={()=>setFindOptions(o=>({...o,matchCase:!o.matchCase}))}>Aa</button><button aria-pressed={findOptions.wholeWord} title="Whole word" aria-label="Whole word" onClick={()=>setFindOptions(o=>({...o,wholeWord:!o.wholeWord}))}>W</button><button aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!findResult.matches.length} onClick={()=>step(-1)}>↑</button><button aria-label="Next match" title="Next match (Enter)" disabled={!findResult.matches.length} onClick={()=>step(1)}>↓</button><button aria-label="Close find" title="Close find (Esc)" onClick={closeFind}>✕</button></div>}{navMessage&&<p className={`nav-message${navMessage.hint?' nav-hint':''}`} role="status">{navMessage.text} <button className="link-button" onClick={()=>setNavMessage(null)} aria-label="Dismiss">✕</button></p>}{picker&&<div className="nav-picker" role="listbox" aria-label="Choose a definition"><p>{picker.length} definitions</p>{picker.map(loc=><button role="option" aria-selected={false} key={`${loc.path}:${loc.startLine}:${loc.startColumn}`} onClick={()=>jumpTo(loc)}>{loc.path}:{loc.startLine}</button>)}<button className="link-button" onClick={()=>setPicker(null)}>Cancel</button></div>}</header>{truncated&&<p className="notice">Showing evidence for the first {MAX_BATCH_IDS} of {subject.ids!.length} occurrences on this line. Narrow the scope or relationship filter to see the rest.</p>}{!error&&serverSites&&<p className="notice">Showing the first {serverSites.shown} of {serverSites.total} source sites for this relationship.</p>}
    <div ref={body}>{fileViewError?<p className="notice">{fileViewError}</p>:error&&!fileView?<p className="notice">{error}</p>:sections.length?sections.map(section=>{
      const file=section.file;
      const changeStatus=reviewDiff?.filesByPath[file.path]?.status;
      const isDiff=section.kind==='unified'||section.kind==='split';
      const occ=occurrences.get(fileKey(snapshot,file.path));
      const navNote=section.kind==='plain'&&occ&&typeof occ!=='string'&&occ.truncated?` · go to definition covers the first ${occ.occurrences.length.toLocaleString('en-US')} of ${occ.total.toLocaleString('en-US')} names`:'';
      return <section key={file.path}><div className="source-path">{file.path} <span>{isDiff?(changeStatus==='ADDED'?'Added file':changeStatus==='DELETED'?'Removed file':'Changed file'):fileView?`Line ${fileView.line}${navNote}`:file.ranges.length>1?`${file.ranges.length} ranges · lines ${rangeSummary(file)}`:`Lines ${rangeSummary(file)}`}{!fileView&&!isDiff?navNote:''}</span></div>{file.exact===false&&<p className="notice">{historical ? 'This captured comparison source is pinned to its review snapshot.' : 'File on disk has changed since this was indexed; this file may be outdated. Re-analyze the project to refresh it.'}</p>}
      {isDiff ? <div onClick={e=>{if(e.ctrlKey||e.metaKey)setNavMessage({text:'Go to definition is not available in the Changes diff yet; find in file works here.'});}}>{section.kind==='unified' ? renderUnifiedDiff(section.rows,diffSide,file,(n,text)=>code(`${file.path}#u${n}`,text)) : renderSplitDiff(section.split,section.rows,diffSide,file,(side,n,text)=>code(`${file.path}#${side}${n}`,text))}</div> :
        section.kind==='plain'?(()=>{const marked=highlightedLines(file,section.lines.length);return <pre onClick={e=>onCodeClick(e,file.path)}>{section.lines.map((line:string,n:number)=>{const num=n+1;const kinds=marked.get(num);return <div className={`code-line${kinds?' highlighted':''}`} key={n} title={kinds?.length?kinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span>{num}</span><code>{code(`${file.path}#${n}`,line,{path:file.path,line:num})}</code></div>;})}</pre>;})():<p className="notice">Source content unavailable for this occurrence.</p>}</section>;
    }):<p className="notice">{fileView?'Loading file…':loading?'Loading source evidence…':'No source evidence stored for this occurrence. Re-analyze the project to refresh the index.'}</p>}</div>
  </dialog>;
}
/** Unified layout: one column, +/- gutter markers, highlighted declaration/evidence ranges keyed to
 * whichever side's numbering this dialog's pinned snapshot uses (`diffSide`). */
function renderUnifiedDiff(rows: DiffRow[], diffSide: 'base'|'head'|null, file: FileEvidence, code: (row: number, text: string) => React.ReactNode) {
  const sideLineCount=rows.reduce((max,r)=>Math.max(max,(diffSide==='head'?r.newNo:r.oldNo)||0),0);
  const marked=highlightedLines(file,sideLineCount);
  return <pre className="diff-unified">{rows.map((row,n)=>{
    const currentLineNo=diffSide==='head'?row.newNo:row.oldNo;
    const kinds=currentLineNo!=null?marked.get(currentLineNo):undefined;
    return <div className={`code-line diff-row-${row.type}${kinds?' highlighted':''}`} key={n} title={kinds?.length?kinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}>
      <span className="diff-gutter">{row.oldNo??''}</span><span className="diff-gutter">{row.newNo??''}</span>
      <span className="diff-marker" aria-hidden="true">{row.type==='add'?'+':row.type==='del'?'−':''}</span>
      <code>{code(n,row.text)}</code>
    </div>;
  })}</pre>;
}
/** Split layout: base on the left, after-change on the right, hunks aligned; a padded side renders a
 * blank row so the two columns stay in step. Highlights the same declaration/evidence ranges the
 * unified layout does, on whichever column is this dialog's pinned side (`diffSide`) -- left/oldNo
 * for 'base', right/newNo for 'head' -- since that numbering is the one `file`'s ranges are keyed to. */
function renderSplitDiff(split: SplitRow[], rows: DiffRow[], diffSide: 'base'|'head'|null, file: FileEvidence, code: (side: 'l'|'r', row: number, text: string) => React.ReactNode) {
  const pinnedRight=diffSide==='head';
  const sideLineCount=rows.reduce((max,r)=>Math.max(max,(pinnedRight?r.newNo:r.oldNo)||0),0);
  const marked=highlightedLines(file,sideLineCount);
  return <div className="diff-split-table" role="table">{split.map((pair,n)=>{
    const leftKinds=!pinnedRight&&pair.left?.oldNo!=null?marked.get(pair.left.oldNo):undefined;
    const rightKinds=pinnedRight&&pair.right?.newNo!=null?marked.get(pair.right.newNo):undefined;
    return <div className="diff-split-row" role="row" key={n}>
    <div className={`diff-split-cell${pair.left?` diff-row-${pair.left.type}`:' diff-split-blank'}${leftKinds?' highlighted':''}`} role="cell" title={leftKinds?.length?leftKinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span className="diff-gutter">{pair.left?.oldNo??''}</span><code>{pair.left?code('l',n,pair.left.text):''}</code></div>
    <div className={`diff-split-cell${pair.right?` diff-row-${pair.right.type}`:' diff-split-blank'}${rightKinds?' highlighted':''}`} role="cell" title={rightKinds?.length?rightKinds.map(k=>k.toLowerCase().replaceAll('_',' ')).join(', '):undefined}><span className="diff-gutter">{pair.right?.newNo??''}</span><code>{pair.right?code('r',n,pair.right.text):''}</code></div>
  </div>;})}</div>;
}
