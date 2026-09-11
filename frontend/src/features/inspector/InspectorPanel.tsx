import { useState, useEffect, useRef } from 'react';
import GeminiBadge from '../../components/GeminiBadge';
import { apiClient } from '../../api/client';
import { AtlasNode, AtlasEdge, AtlasGraph, isType } from '../explorer/graphModel';
import { startSerialPolling } from '../../utils/serialPolling';
/** `mapStatus` distinguishes an inspected subject that is outside the current scope from one that
 * is in scope but simply not on the current displayed page (Story 1 / Story 6: "Not shown in the
 * current map" / "In scope, not currently displayed"). Null when nothing is inspected, or for edges. */
/** `edgeFilteredOut` is true when the inspected relationship is real but the current relationship
 * filter hides its drawing on the map (Step 4, Appendix F3) -- distinct from unresolved, which is
 * never drawn regardless of filter. */
interface Props { selectedNode: AtlasNode | null; selectedEdge: AtlasEdge | null; mapStatus?: 'OUT_OF_SCOPE' | 'IN_SCOPE_NOT_DISPLAYED' | 'DISPLAYED' | null; edgeFilteredOut?: boolean; workspaceId: string | null; snapshotId: string | null; graph: AtlasGraph; routes: any[]; revision: number; onSelect: (node: AtlasNode) => void; onViewClasses: (node: AtlasNode) => void; onViewMethods: (node: AtlasNode) => void; onArrangeAroundResource: (node: AtlasNode) => void; onSource: (node: {id:string;simpleName?:string}, type?:string) => void; onClose: () => void; onInspectEdge: (edge:AtlasEdge) => void; onExplanationReady: () => void }
export default function InspectorPanel({selectedNode: node, selectedEdge: edge, mapStatus, edgeFilteredOut, workspaceId, snapshotId, graph, routes, revision, onSelect, onViewClasses, onViewMethods, onArrangeAroundResource, onSource, onClose, onInspectEdge, onExplanationReady}: Props) {
  const [rawExplanation,setExplanation]=useState<any>(null), [loadedSubject,setLoadedSubject]=useState<string|null>(null), [evidence,setEvidence]=useState<any[]>([]), [error,setError]=useState(''), [requesting,setRequesting]=useState(false), [site,setSite]=useState(0), [requestRevision,setRequestRevision]=useState(0);
  const requestedSubject=useRef<string|null>(null);
  const type=edge?'relationship':'symbol';
  const subject=edge?(edge.occurrenceIds?.[site] || edge.id):node?.id;
  const explanation=loadedSubject===subject?rawExplanation:null;
  const graphStatus=edge?graph.edges.find(e=>e.id===subject)?.explanationStatus:graph.nodes.find(n=>n.id===subject)?.explanationStatus;
  useEffect(()=>{setExplanation(null);setEvidence([]);setError('');},[snapshotId,subject]);
  useEffect(()=>{setSite(0);setExplanation(null);setError('');setEvidence([]);},[node?.id,edge?.id]);
  useEffect(()=>{
    if (!snapshotId || !subject || node?.kind==='PACKAGE') return;
    return startSerialPolling({
      load:async()=>{
        const [result,ev]=await Promise.all([apiClient.getSubjectExplanation(snapshotId!,subject!,type),apiClient.getExplanationEvidence(snapshotId!,subject!,type)]);
        return {result,ev};
      },
      onValue:({result,ev})=>{setLoadedSubject(subject!);setExplanation(result);setEvidence(ev);setError('');if(result?.status==='READY'&&requestedSubject.current===subject){requestedSubject.current=null;onExplanationReady();}},
      shouldContinue:({result})=>['QUEUED','RUNNING'].includes(result?.status),
      intervalMs:2500,
      onError:(e:any)=>setError(e.message)
    });
  },[snapshotId,subject,type,revision,requestRevision,graphStatus,node?.kind]);
  const parent=graph.nodes.find(n=>n.id===node?.parentId);
  const children=graph.nodes.filter(n=>n.parentId===node?.id);
  const methods=children.filter(n=>n.kind==='METHOD');
  const relatedIds=new Set([node?.id,...children.map(n=>n.id)]);
  const incoming=graph.edges.filter(e=>e.targetId&&relatedIds.has(e.targetId)&&!relatedIds.has(e.sourceId));
  const unresolved=(graph.metadata?.unresolvedRelationships || []).filter((e:any)=>relatedIds.has(e.sourceId));
  const outgoing=graph.edges.filter(e=>relatedIds.has(e.sourceId)&&(!e.targetId||!relatedIds.has(e.targetId)));
  const find=(id:string|null|undefined)=>graph.nodes.find(n=>n.id===id);
  const status=explanation?.status||'NOT_REQUESTED';
  async function explain(){if(!workspaceId||!snapshotId||!subject)return;setRequesting(true);try{await apiClient.requestExplanation(workspaceId,snapshotId,subject,type);requestedSubject.current=subject;setLoadedSubject(subject);setExplanation((prev:any)=>({...prev,status:'QUEUED'}));setRequestRevision(r=>r+1);setError('');}catch(e:any){setError(e.message);}finally{setRequesting(false);}}
  function groupEdges(edges:AtlasEdge[],incoming:boolean){ const unique=new Map<string,{node:AtlasNode;count:number}>();for(const e of edges){const n=find(incoming?e.sourceId:e.targetId);if(!n)continue;const old=unique.get(n.id);unique.set(n.id,{node:n,count:(old?.count||0)+1});}return [...unique.values()]; }
  function renderGroups(groups:{node:AtlasNode;count:number}[]){ return groups.map(({node:n,count})=><button className="related-row" key={n.id} onClick={()=>onSelect(n)}><span>{n.simpleName}<small>{find(n.parentId)?.simpleName}</small></span><span>{count} {count===1?'site':'sites'} ↗</span></button>); }
  const incomingGroups=groupEdges(incoming,true), outgoingGroups=groupEdges(outgoing,false);
  if(!node&&!edge) return <aside className="inspector idle"><div className="inspector-label">Your reading companion</div><div className="empty-symbol">◇</div><h2>Start with the big picture.</h2><p>Select a package to see what it contains, or a class to follow its dependencies.</p><div className="reading-guide"><h3>A path into the codebase</h3><p><b>Explore packages</b><br/>See how the system is organized.</p><p><b>Follow an entry point</b><br/>Trace a request through its collaborators.</p><p><b>Understand a method</b><br/>Read its explanation, then open the code.</p></div><div className="quiet-note">Graph facts remain available without a model connection.</div></aside>;
  return <aside className="inspector"><header className="inspector-top"><span>{edge?'Relationship':node?.kind.toLowerCase()}</span>{status==='READY'&&<span className="explanation-ready"><GeminiBadge/><span className="tag">Ready</span></span>}<button className="icon-button" onClick={onClose} aria-label="Close inspector">✕</button></header>
    <div className="subject-heading"><span className="subject-icon">{node?.kind==='METHOD'?'ƒ':edge?'↗':'◇'}</span><div><h2>{edge?`${find(edge.sourceId)?.simpleName||'Unknown source'} → ${find(edge.targetId)?.simpleName||edge.descriptiveLabel||'Unresolved target'}`:node?.simpleName}</h2><p>{node?.qualifiedName||edge?.kind.toLowerCase().replaceAll('_',' ')}</p></div></div>
    {node&&mapStatus==='OUT_OF_SCOPE'&&<p className="notice">Outside current scope.</p>}
    {node&&mapStatus==='IN_SCOPE_NOT_DISPLAYED'&&<p className="notice">In scope, not currently displayed.</p>}
    {edge&&edgeFilteredOut&&<p className="notice">Not shown with the current relationship filter.</p>}
    {node&&<button className="full-width arrange-action" disabled={mapStatus!=='DISPLAYED'} title={mapStatus!=='DISPLAYED'?'Resource is not in current map view':undefined} onClick={()=>onArrangeAroundResource(node)}><span aria-hidden="true">☵</span> Arrange around this resource</button>}
    {node?.roles?.length ? <div className="role-list">{node.roles.map(r=><span className="tag" key={r}>{r.toLowerCase().replaceAll('_',' ')}</span>)}</div>:null}
    {node?.kind==='PACKAGE'?<><section><h3>Inside this package <span className="count">{children.length}</span></h3><p>Explore the declarations that make up {node.simpleName}.</p><button className="primary full-width" onClick={()=>onViewClasses(node)}>View classes ↗</button>{children.map(n=><button className="related-row" key={n.id} onClick={()=>onSelect(n)}><span>◇ {n.simpleName}</span><span>↗</span></button>)}</section></>:<>
    {edge && <section><div className={`tag ${edge.resolution==='RESOLVED'?'':'amber'}`}>{edge.resolution.toLowerCase()}</div><p>{edge.occurrenceCount || 1} underlying occurrence(s). Arrows follow static source direction.</p>{(edge.occurrenceIds?.length||0)>1&&<label>Occurrence<select value={site} onChange={e=>setSite(Number(e.target.value))}>{edge.occurrenceIds!.map((_,i)=><option value={i} key={i}>Source occurrence {i+1}</option>)}</select></label>}<button className="full-width" onClick={()=>onSource({id:subject!},'relationship')}>View source evidence</button>{[find(edge.sourceId),find(edge.targetId)].filter(Boolean).map(n=><button key={n!.id} className="related-row" onClick={()=>onSelect(n!)}>Go to {n!.simpleName}<span>↗</span></button>)}</section>}
    {explanation?.preExplanation&&<details className="architecture-draft" open={!explanation?.hoverSummary}><summary>Architecture draft{explanation.preExplanation.status==='STALE'?' · stale':''}</summary><p>{explanation.preExplanation.businessLogic}</p><small>Inferred from the project inventory and documents. Full code explanation is separate.</small><small>{explanation.preExplanation.provenance}</small></details>}
    <section className="explanation-section"><div className="section-heading"><h3>✧ Explanation</h3><span className={`tag ${['FAILED','STALE'].includes(status)?'amber':''}`}>{status.toLowerCase().replaceAll('_',' ')}</span></div>
    {explanation?.hoverSummary&&<><h3 className="responsibility">{explanation.shortLabel}</h3><p>{explanation.hoverSummary}</p></>}
    {status==='NOT_REQUESTED'&&<p>Understand this {edge?'relationship':node?.kind.toLowerCase()} in the context of the application, its collaborators, and your project documents.</p>}
    {status==='STALE'&&<p className="notice">Context has changed. This explanation needs a refresh.</p>}
    {['QUEUED','RUNNING'].includes(status)&&<p>Generating with project context…</p>}
    {status==='FAILED'&&<p className="notice">{explanation?.errorDetail||'Generation failed. Check the configured model or retry.'}</p>}
    {explanation?.claims?.map((claim:any,i:number)=><div className="claim" key={i}><small>{claim.basis==='SOURCE_FACT'?'Source fact':claim.basis==='INFERRED_PURPOSE'?'Inferred purpose':'Unknown'}</small><p>{claim.description||claim.text}</p>{claim.evidenceIds?.map((id:string)=>{const ev=evidence.find(e=>e.id===id);return <details className="evidence-disclosure" key={id}><summary>{ev?.label||id}</summary><pre>{ev?.content||'Evidence text unavailable in this older explanation. Regenerate to store its context.'}</pre></details>;})}</div>)}
    {explanation?.unknowns?.length>0&&<details className="uncertainties"><summary>Uncertainties ({explanation.unknowns.length})</summary><ul>{explanation.unknowns.map((u:string,i:number)=><li key={i}>{u}</li>)}</ul></details>}
    <button className="primary full-width" disabled={requesting||!workspaceId||['QUEUED','RUNNING'].includes(status)} onClick={explain}>{requesting?'Requesting…':status==='READY'||status==='STALE'?'Refresh explanation':'Explain with project context'}</button>
    {explanation?.provenance&&<small className="provenance">{explanation.provenance}</small>}{error&&<p className="notice" role="alert">{error}</p>}
    </section>
    {node&&<section className="source-action"><button className="full-width" onClick={()=>onSource(node)}>〈/〉 View {node.kind==='METHOD'?'method':'class'} code</button><small>Opens only when you need the implementation.</small></section>}
    </>}
    {methods.length>0&&<section><div className="section-heading"><h3>Methods</h3><span className="count">{methods.length}</span></div>{methods.map(m=><div className="method-row" key={m.id}><button onClick={()=>onSelect(m)} title={m.qualifiedName}><span>ƒ</span> {m.qualifiedName?.slice((node?.qualifiedName?.length||0)+1)||m.simpleName}</button><button aria-label={`View code for ${m.simpleName}`} title="View method code" onClick={()=>onSource(m)}>〈/〉</button></div>)}<button className="text-button" onClick={()=>onViewMethods(node!)}>View methods ↗</button></section>}
    {node&&node.kind!=='PACKAGE'&&<><section><h3>Called or used by <span className="count">{incomingGroups.length}</span></h3>{renderGroups(incomingGroups)}{!incomingGroups.length&&<p>No incoming relationships in this snapshot.</p>}</section><section><h3>Depends on <span className="count">{outgoingGroups.length+unresolved.length}</span></h3>{renderGroups(outgoingGroups)}{unresolved.map((e:any)=><div className="unresolved-row" key={e.id}><span className="tag amber">Unresolved {e.kind.toLowerCase()}</span><p>{e.unresolvedTarget}</p><small>{e.reason}</small><button className="text-button" onClick={()=>onSource({id:e.id},'relationship')}>View occurrence</button><button className="text-button" onClick={()=>onInspectEdge({...e,targetId:null,descriptiveLabel:e.unresolvedTarget})}>Inspect relationship</button></div>)}{!outgoingGroups.length&&!unresolved.length&&<p>No outgoing relationships in this snapshot.</p>}</section></>}
    {node&&routes.filter(r=>relatedIds.has(r.symbol_version_id)).length>0&&<section><h3>Entry points</h3>{routes.filter(r=>relatedIds.has(r.symbol_version_id)).map(r=><p key={r.id}><span className="tag">{r.http_method}</span> {r.path}</p>)}</section>}
    {parent&&<section><h3>Belongs to</h3><button className="related-row" onClick={()=>onSelect(parent)}>{parent.simpleName}<span>↗</span></button></section>}
    {node&&isType(node)&&<div className="quiet-note">Relationships describe static dependencies. Runtime dispatch may vary.</div>}
  </aside>;
}
