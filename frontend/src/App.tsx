import { useEffect, useMemo, useReducer, useState } from 'react';
import './styles/App.css';
import { apiClient } from './api/client';
import GraphCanvas from './features/explorer/GraphCanvas';
import { AtlasGraph, AtlasNode, AtlasEdge, Level, isType, ownerAt, getEligibleIds, rankEligibleIds, projectDisplayed } from './features/explorer/graphModel';
import { ScopeSelection, wholeSystemScope, scopeToLabel, isNodeInScope, isClassInScope, togglePackage, toggleClass } from './features/explorer/scopeModel';
import { explorerViewReducer, initExplorerViewState } from './features/explorer/explorerViewState';
import NavigationPane from './features/explorer/NavigationPane';
import InspectorPanel from './features/inspector/InspectorPanel';
import SettingsScreen from './features/settings/SettingsScreen';
import ProjectDocuments from './features/context/ProjectDocuments';
import SourceDialog from './features/source/SourceDialog';
import { startSerialPolling } from './utils/serialPolling';

export default function App() {
  const params = new URLSearchParams(location.search);
  const [path,setPath]=useState(params.get('path')||''),[workspace,setWorkspace]=useState<any>(null),[snapshot,setSnapshot]=useState<string|null>(null);
  const [graph,setGraph]=useState<AtlasGraph|null>(null),[routes,setRoutes]=useState<any[]>([]),[recent,setRecent]=useState<any[]>([]);
  const [status,setStatus]=useState('Open a project to begin'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  // Inspection, active level, and per-level displayed-page membership all live in one reducer
  // (explorerViewState.ts) so that inspecting a resource can never reset scope, level, or the
  // displayed page — see Step 2 of the stable-map plan. Positions/camera are not tracked yet.
  const [viewState,dispatchView]=useReducer(explorerViewReducer,undefined,()=>initExplorerViewState());
  const BATCH_SIZE=12;
  const level=viewState.activeLevel;
  const [scope,setScope]=useState<ScopeSelection>(wholeSystemScope()),[kind,setKind]=useState('ALL');
  const [tab,setTab]=useState('map'),[search,setSearch]=useState(''),[settings,setSettings]=useState(params.get('settings')==='true');
  const [queue,setQueue]=useState<any>(null),[revision,setRevision]=useState(0),[profile,setProfile]=useState<any>(null),[source,setSource]=useState<{node:{id:string;simpleName?:string};type:string}|null>(null);
  const [mobilePane,setMobilePane]=useState('map'),[showOpen,setShowOpen]=useState(false);
  const name=workspace?.path?.split('/').filter(Boolean).pop()||'Your workspace';
  const levelOf=(n:AtlasNode):Level=>n.kind==='PACKAGE'?'PACKAGE':isType(n)?'CLASS':'METHOD';
  const eligibleFor=(targetLevel:Level,targetScope:ScopeSelection=scope):string[]=>graph?rankEligibleIds(graph,targetLevel,getEligibleIds(graph,targetLevel,targetScope)):[];
  const node=graph&&viewState.inspectedKind==='NODE'&&viewState.inspectedSubjectId?graph.nodes.find(n=>n.id===viewState.inspectedSubjectId)||null:null;
  const displayedIds=viewState.levelViews[level].displayedIds;
  const projected=useMemo(()=>graph?projectDisplayed(graph,level,displayedIds,kind):{nodes:[] as AtlasNode[],edges:[] as AtlasEdge[]},[graph,level,displayedIds,kind]);
  // Unresolved relationships (target_symbol_id IS NULL) never reach projectDisplayed's edge
  // aggregation, since they have no target to aggregate onto — but the inspector's own "Inspect
  // relationship" button on an unresolved row dispatches INSPECT_EDGE with that record's raw ID, so
  // the lookup needs the same fallback shape InspectorPanel used to construct that button's target.
  const unresolvedEdge=viewState.inspectedKind==='EDGE'&&viewState.inspectedSubjectId
    ? (graph?.metadata?.unresolvedRelationships||[]).find((e:any)=>e.id===viewState.inspectedSubjectId)
    : undefined;
  const edge=viewState.inspectedKind==='EDGE'&&viewState.inspectedSubjectId
    ? projected.edges.find(e=>e.id===viewState.inspectedSubjectId)
      || (unresolvedEdge?{...unresolvedEdge,targetId:null,descriptiveLabel:unresolvedEdge.unresolvedTarget}:null)
    : null;
  const eligibleIds=useMemo(()=>graph?getEligibleIds(graph,level,scope):[],[graph,level,scope]);
  const scopedCount=eligibleIds.length,visibleCount=projected.nodes.length,omittedCount=Math.max(0,scopedCount-visibleCount);
  // A node can only actually be a rendered card when its own natural level (Package/Class/Method)
  // IS the currently active graph level: a cached page from a level the user isn't looking at
  // right now is not "displayed" on the map they're looking at, even if that other level's page
  // happens to still contain this ID from an earlier visit.
  const mapStatus=node&&graph?(!isNodeInScope(node,scope,graph)?'OUT_OF_SCOPE':level===levelOf(node)&&displayedIds.includes(node.id)?'DISPLAYED':'IN_SCOPE_NOT_DISPLAYED'):null;
  async function loadSnapshot(id:string, ws?:any) {
    const [data,entryPoints]=await Promise.all([apiClient.getGraph(id),apiClient.getSpringRoutes(id)]);
    if(!ws&&!data?.metadata?.workspaceId)throw new Error('Snapshot response is missing workspace metadata; try re-opening the project.');
    const owner=ws||await apiClient.getWorkspace(data.metadata.workspaceId);
    setWorkspace(owner);setPath(owner.path);setSnapshot(id);setGraph(data);setRoutes(entryPoints);setScope(wholeSystemScope());setTab('map');setQueue(null);setStatus('Source analysis ready');setShowOpen(false);
    dispatchView({type:'RESET',level:'PACKAGE',eligibleIds:rankEligibleIds(data,'PACKAGE',getEligibleIds(data,'PACKAGE',wholeSystemScope())),batchSize:Infinity});
    const selected=params.get('selectedSymbol');
    if(selected){
      const n=data.nodes.find((n:AtlasNode)=>n.id===selected||n.simpleName===selected);
      if(n){
        const targetLevel=levelOf(n);
        if(targetLevel!=='PACKAGE')dispatchView({type:'NAVIGATE_LEVEL',level:targetLevel,eligibleIds:rankEligibleIds(data,targetLevel,getEligibleIds(data,targetLevel,wholeSystemScope())),batchSize:BATCH_SIZE});
        dispatchView({type:'INSPECT_NODE',id:n.id});
      }
    }
    historyReplace(id);
  }
  function historyReplace(id:string){const url=new URL(location.href);url.search='';url.searchParams.set('snapshotId',id);window.history.replaceState(null,'',url);}
  async function analyze(input=path) {
    if(!input.trim()){setError('Enter a repository path accessible to the local server.');return;}
    setBusy(true);setError('');try{setStatus('Registering project…');const ws=await apiClient.createWorkspace(input.trim());setStatus('Analyzing Java source…');let job=await apiClient.triggerAnalysis(ws.id);while(!['COMPLETED','FAILED','CANCELLED'].includes(job.status)){await new Promise(r=>setTimeout(r,500));job=await apiClient.getJob(job.id);}if(job.status!=='COMPLETED')throw new Error(job.errorMessage||`Analysis ${job.status.toLowerCase()}`);const current=await apiClient.getWorkspace(ws.id);if(!current.activeSnapshotId)throw new Error('Analysis did not publish a snapshot');await loadSnapshot(current.activeSnapshotId,current);setRecent(await apiClient.listWorkspaces());}catch(e:any){setError(e.message);setStatus('Analysis could not finish');}finally{setBusy(false);}
  }
  useEffect(()=>{apiClient.listWorkspaces().then(setRecent).catch(e=>setError(e.message));if(params.get('snapshotId')){setBusy(true);loadSnapshot(params.get('snapshotId')!).catch(e=>setError(e.message)).finally(()=>setBusy(false));}else if(params.get('autoPath'))analyze(params.get('autoPath')!);},[]);
  useEffect(()=>{apiClient.getModelProfiles().then(p=>setProfile(p[0])).catch(()=>setProfile(null));},[settings]);
  useEffect(()=>{
    if(!workspace)return;
    return startSerialPolling({
      load:()=>apiClient.getQueueStatus(workspace.id),
      onValue:q=>{setQueue(q);if(!q.activeJobId){if(q.jobStatus==='COMPLETED')setStatus('Explain all completed');else if(q.jobStatus==='FAILED')setStatus('Explain all failed');else if(q.jobStatus==='CANCELLED')setStatus('Explain all cancelled');}},
      shouldContinue:q=>Boolean(q.activeJobId),
      intervalMs:2000
    });
  },[workspace?.id,queue?.activeJobId]);
  useEffect(()=>{
    if(!snapshot)return;
    let alive=true;
    apiClient.getGraph(snapshot).then(data=>{if(alive)setGraph(previous=>JSON.stringify(previous)===JSON.stringify(data)?previous:data);}).catch(()=>{});
    return()=>{alive=false;};
  },[snapshot,revision,queue?.completed,queue?.failed,queue?.synthesisStatus]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();document.getElementById('global-search')?.focus();}if(e.key==='Escape'){setSearch('');}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  function select(n:AtlasNode){dispatchView({type:'INSPECT_NODE',id:n.id});setSearch('');setMobilePane('details');}
  function inspectEdge(e:AtlasEdge){dispatchView({type:'INSPECT_EDGE',id:e.id});setMobilePane('details');}
  function explore(n:AtlasNode){
    if(!graph)return;
    const targetLevel:Level=n.kind==='PACKAGE'?'CLASS':'METHOD';
    dispatchView({type:'INSPECT_NODE',id:n.id});
    dispatchView({type:'NAVIGATE_LEVEL',level:targetLevel,eligibleIds:eligibleFor(targetLevel),batchSize:BATCH_SIZE});
    setTab('map');setSearch('');setMobilePane('map');
  }
  function openCodeMap(){
    if(!graph)return;
    dispatchView({type:'NAVIGATE_LEVEL',level:'PACKAGE',eligibleIds:eligibleFor('PACKAGE'),batchSize:Infinity});
    dispatchView({type:'CLEAR_INSPECTION'});
    setTab('map');setMobilePane('map');
  }
  function handleScopeChange(next:ScopeSelection,explicitClassAddId?:string){
    setScope(next);
    if(!graph)return;
    dispatchView({type:'SCOPE_UPDATED',eligibleIds:eligibleFor(level,next),explicitClassAddId,batchSize:level==='PACKAGE'?Infinity:BATCH_SIZE});
  }
  function resetScope(){handleScopeChange(wholeSystemScope());}
  function removeFromScope(n:AtlasNode){
    if(!graph)return;
    if(!isNodeInScope(n,scope,graph))return;
    const next=n.kind==='PACKAGE'?togglePackage(scope,n,graph):(()=>{const owner=isType(n)?n:ownerAt(n,'CLASS',new Map(graph.nodes.map(item=>[item.id,item])));return owner&&isClassInScope(owner,scope,graph)?toggleClass(scope,owner,graph):scope;})();
    if(next!==scope)handleScopeChange(next);
  }
  const results=graph&&search.trim()?graph.nodes.filter(n=>(n.qualifiedName||n.simpleName).toLowerCase().includes(search.toLowerCase())).slice(0,35):[];
  const packages=graph?.nodes.filter(n=>n.kind==='PACKAGE')||[];
  const typeCount=graph?.nodes.filter(isType).length||0;
  // Walk from the most recent end so a subject visited twice non-consecutively (dedup in the
  // reducer only collapses immediate repeats) still yields exactly 3 distinct, most-recent-first
  // entries instead of a duplicate React key.
  const recentHistory=(()=>{const seen=new Set<string>(),out:typeof viewState.history=[];for(let i=viewState.history.length-1;i>=0&&out.length<3;i--){const h=viewState.history[i];if(h.kind!=='NODE'||seen.has(h.subjectId))continue;seen.add(h.subjectId);out.push(h);}return out;})();
  function scopeUnitLabel(){if(scope.mode==='ALL')return'whole system';const pkgs=scope.selectedPackageIds.size,cls=scope.selectedClassIds.size;if(pkgs&&cls)return`${pkgs} selected package${pkgs===1?'':'s'} and ${cls} selected class${cls===1?'':'es'}`;if(pkgs)return`${pkgs} selected package${pkgs===1?'':'s'}`;if(cls)return`${cls} selected class${cls===1?'':'es'}`;return'no selection';}
  const levelWord=level==='PACKAGE'?'Packages':level==='CLASS'?'Classes':'Methods';
  const scopeCrumb=scope.mode==='ALL'?'Whole system':scopeUnitLabel();
  const scopeEmpty=scope.mode==='CUSTOM'&&scope.selectedPackageIds.size===0&&scope.selectedClassIds.size===0;
  const synthesisElapsed=queue?.synthesisStageStartedAt
    ? Math.max(0,Math.floor((Date.now()-Date.parse(queue.synthesisStageStartedAt))/1000))
    : 0;
  async function explainAll(){if(!workspace||!snapshot)return;try{if(queue?.activeJobId){await apiClient.cancelJob(queue.activeJobId);setStatus('Pending explanation work cancelled');}else{await apiClient.startExplainAll(workspace.id,snapshot,1);setStatus('Synthesizing architecture, then explaining classes and methods');}setQueue(await apiClient.getQueueStatus(workspace.id));}catch(e:any){setError(e.message);}}
  return <div className="app-container">
    <header className="app-header"><button className="brand" onClick={openCodeMap}><span className="brand-mark">◈</span>Code Atlas</button><button className="workspace-switch" onClick={()=>setShowOpen(!showOpen)}>{workspace?name:'Open project'} <span>⌄</span></button>
      <div className="global-search"><span>⌕</span><input id="global-search" aria-label="Search codebase" placeholder="Find a class, method, or package…" value={search} onChange={e=>setSearch(e.target.value)} disabled={!graph}/><kbd>Ctrl K</kbd>{search&&<div className="search-results">{results.length?results.map(n=><button key={n.id} onClick={()=>{select(n);setTab('map');}}><span>{n.simpleName}<small>{n.qualifiedName}</small></span><span className="tag">{n.kind.toLowerCase()}</span></button>):<p>No matching symbols</p>}</div>}</div>
      <button className="model-status" onClick={()=>setSettings(true)}><span className={`status-dot ${profile?.baseUrl?'configured':''}`}/>{profile?.baseUrl?'Model configured':'Set up model'}</button><button className="icon-button" aria-label="Model settings" onClick={()=>setSettings(true)}>⚙</button>
    </header>
    {queue?.errorMessage&&<div className="error-banner" role="alert"><span>{queue.errorMessage}</span></div>}
    {error&&<div className="error-banner" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">✕</button></div>}
    {(showOpen||!graph)&&<section className={graph?'open-project-bar':'welcome'}><div><span className="welcome-icon">◈</span><h1>{graph?'Open a project':'Find your way through the code.'}</h1><p>Explore the structure. Follow a dependency. Understand why it exists.</p></div><form onSubmit={e=>{e.preventDefault();analyze();}}><label>Local repository path<input value={path} onChange={e=>setPath(e.target.value)} placeholder="/path/to/your/java-project" disabled={busy}/></label><button className="primary" disabled={busy}>{busy?'Analyzing…':'Analyze project'}</button></form><p className="muted">Source-only analysis. Your repository is read-only; no Gradle builds or application code are executed.</p>{recent.length>0&&<div className="recent-projects"><h3>Recent projects</h3>{recent.map(ws=><button key={ws.id} disabled={busy} onClick={()=>{if(ws.activeSnapshotId){setBusy(true);loadSnapshot(ws.activeSnapshotId,ws).catch(e=>setError(e.message)).finally(()=>setBusy(false));}else{setPath(ws.path);analyze(ws.path);}}}><span>▱ {ws.path.split('/').pop()}<small>{ws.path}</small></span><span>Open ↗</span></button>)}</div>}</section>}
    {graph&&<><nav className="mobile-tabs">{['explorer','map','details'].map(p=><button className={mobilePane===p?'active':''} key={p} onClick={()=>setMobilePane(p)}>{p}</button>)}</nav><main className={`app-main pane-${mobilePane}`}>
      <aside className="navigation"><nav className="workspace-nav"><button className={tab==='map'?'active':''} onClick={openCodeMap}>▦ <span>Code map</span></button><button className={tab==='routes'?'active':''} onClick={()=>{setTab('routes');setMobilePane('map');}}>▷ <span>Entry points</span><small>{routes.length}</small></button><button className={tab==='context'?'active':''} onClick={()=>{setTab('context');setMobilePane('map');}}>▤ <span>Project context</span></button></nav>
        <NavigationPane graph={graph} scope={scope} selectedNode={node} search={search} onScopeChange={handleScopeChange} onSelect={select} onExplore={explore}/>
        {recentHistory.length>0&&<div className="recent-symbols"><h3>Recently viewed</h3>{recentHistory.map(h=>{const n=graph.nodes.find(x=>x.id===h.subjectId);return n?<button key={h.subjectId} onClick={()=>select(n)}>◷ {n.simpleName}</button>:null;})}</div>}
        <div className="workspace-summary"><strong>{name}</strong><span>{typeCount} types across {packages.length} packages</span><button className="text-button" disabled={busy} onClick={()=>analyze()}>↻ Re-analyze source</button></div>
      </aside>
      <section className="workspace-content">
        {tab==='context'&&workspace?<ProjectDocuments key={workspace.id} workspaceId={workspace.id} onChanged={()=>setRevision(r=>r+1)}/>:tab==='routes'?<section className="entry-view"><div className="page-heading"><div><h1>Start with a request</h1><p>Follow an HTTP entry point into its handler and dependencies.</p></div></div>{routes.length?routes.map(r=>{const handler=graph.nodes.find(n=>n.id===r.symbol_version_id);return <button className="route-card" key={r.id} onClick={()=>{if(handler)explore(handler);}}><span className="tag">{r.http_method}</span><strong>{r.path}</strong><span>{handler?.simpleName||r.handler_qualified}</span><span>Explore ↗</span></button>;}):<div className="empty-state"><h2>No HTTP routes found</h2><p>Explore packages and classes to find this application's entry points.</p><button onClick={openCodeMap}>Open code map</button></div>}</section>:<>
          <div className="map-heading"><div className="breadcrumbs"><button onClick={openCodeMap}>{scopeCrumb}</button><span>/</span><span className="breadcrumb-level">{levelWord}</span>{node&&<><span>/</span><button onClick={()=>select(node)}>{node.simpleName}</button></>}</div><div className="page-heading"><div><h1>{node?node.simpleName:'Understand the whole system'}</h1><p>{node?'Follow the relationships around this part of the codebase.':`${typeCount} types across ${packages.length} packages. Choose a starting point.`}</p></div><button onClick={()=>{const entry=viewState.history[viewState.history.length-1];if(entry)dispatchView({type:'NAVIGATE_BACK',eligibleIds:eligibleFor(entry.level)});}} disabled={!viewState.history.length}>← Back</button></div>
          <div className="graph-toolbar"><div className="segmented" aria-label="Graph level">{(['PACKAGE','CLASS','METHOD'] as Level[]).map(l=><button className={level===l?'active':''} key={l} onClick={()=>{if(l===level)return;dispatchView({type:'NAVIGATE_LEVEL',level:l,eligibleIds:eligibleFor(l),batchSize:l==='PACKAGE'?Infinity:BATCH_SIZE});dispatchView({type:'CLEAR_INSPECTION'});}}>{l==='PACKAGE'?'Packages':l==='CLASS'?'Classes':'Methods'}</button>)}</div><select aria-label="Relationship kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">All dependencies</option>{[...new Set(graph.edges.map(e=>e.kind))].sort().map(k=><option key={k} value={k}>{k.toLowerCase().replaceAll('_',' ')}</option>)}</select></div>
          <div className="scope-banner"><span className="scope-banner-icon" aria-hidden="true">{scope.mode==='ALL'?'◈':'⌖'}</span><div className="scope-banner-text"><strong>{graph?scopeToLabel(graph,scope):''}</strong><span>Showing {levelWord.toLowerCase()} · {scopedCount} {levelWord.toLowerCase()}{scope.mode!=='ALL'?` in ${scopeUnitLabel()}`:''}</span></div><div className="scope-banner-actions">{node&&<span className="tag inspecting-chip">Inspecting {node.simpleName}</span>}{edge&&!node&&<span className="tag inspecting-chip">Inspecting a relationship</span>}{omittedCount>0&&<button className="show-more" onClick={()=>dispatchView({type:'SHOW_MORE',eligibleIds:eligibleFor(level),batchSize:BATCH_SIZE})}>Showing {visibleCount} of {scopedCount} in scope · show {Math.min(BATCH_SIZE,omittedCount)} more</button>}{scope.mode==='CUSTOM'&&<button className="text-button" onClick={resetScope}>Reset to whole system</button>}</div></div>
          </div>
          {scopeEmpty
            ? <div className="scope-empty-state"><h2>No packages or classes selected</h2><p>Check packages or classes in the left tree to define what the graph shows.</p><button className="primary" onClick={resetScope}>Select all</button></div>
            : <GraphCanvas nodes={projected.nodes} edges={projected.edges} selectedId={node?.id||edge?.id} onNodeSelect={select} onExplore={explore} onEdgeSelect={inspectEdge} canRemoveFromScope={n=>isNodeInScope(n,scope,graph)} onRemoveFromScope={removeFromScope}/>}
          <div className="graph-legend"><span><i className="line-sample"/>Static dependency</span><span><i className="line-sample uncertain"/>Candidate / unresolved</span><span>{level==='METHOD'?'Method call occurrences':`${level==='PACKAGE'?'Package':'Class'} connections group occurrences by kind and resolution`}</span></div>
        </>}
      </section>
      {tab!=='context'&&<InspectorPanel selectedNode={node} selectedEdge={edge} mapStatus={mapStatus} workspaceId={workspace?.id||null} snapshotId={snapshot} graph={graph} routes={routes} revision={revision} onExplanationReady={()=>setRevision(r=>r+1)} onInspectEdge={inspectEdge} onSelect={select} onExplore={explore} onSource={(n,type='symbol')=>setSource({node:n,type})} onClose={()=>{dispatchView({type:'CLEAR_INSPECTION'});setMobilePane('map');}}/>}
    </main></>}
    <footer className="app-footer">{graph?.metadata?.diagnostics?.warnings?.length>0&&<details className="analysis-warnings"><summary>{graph?.metadata?.diagnostics?.warnings.length} analysis warning(s)</summary><div>{graph?.metadata?.diagnostics?.warnings.map((w:string,i:number)=><p key={i}>{w}</p>)}</div></details>}<span><i className={`status-dot ${graph?'configured':''}`}/>{status}</span>{graph&&<span>{graph.metadata?.unresolvedCount||0} unresolved external targets</span>}<div className="queue-summary">{queue?.activeJobId&&queue.synthesisStatus!=='READY'&&<span className="synthesis-progress"><i aria-hidden="true"/>{queue.synthesisStage || 'Preparing architecture'} · {synthesisElapsed}s · {queue.synthesisCompleted || 0} validated</span>}{!queue?.activeJobId&&queue?.jobStatus==='CANCELLED'&&<span>Explain all cancelled</span>}{queue&&<span>{queue.completed} explained · {queue.pending+queue.inProgress} queued · {queue.failed} failed</span>}{snapshot&&<button className={queue?.activeJobId?'':'primary'} onClick={explainAll}>{queue?.activeJobId?'Stop explain all':'✧ Explain all'}</button>}</div></footer>
    <SettingsScreen isOpen={settings} onClose={()=>setSettings(false)}/>
    {source&&snapshot&&<SourceDialog snapshot={snapshot} subject={source.node} type={source.type} onClose={()=>setSource(null)}/>}
  </div>;
}
