import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import './styles/App.css';
import { apiClient } from './api/client';
import GraphCanvas from './features/explorer/GraphCanvas';
import { AtlasGraph, AtlasNode, AtlasEdge, Level, isType, ownerAt, getEligibleIds, rankEligibleIds, projectDisplayed } from './features/explorer/graphModel';
import { ScopeSelection, wholeSystemScope, scopeToLabel, isNodeInScope, isClassInScope, togglePackages, toggleClass } from './features/explorer/scopeModel';
import { explorerViewReducer, initExplorerViewState, PlacementDims, Point, Camera } from './features/explorer/explorerViewState';
import { arrangeAroundResource, ArrangeCard, ArrangeEdge } from './features/explorer/focusedArrangement';
import { nodeCard } from './features/explorer/nodeCard';
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
  // Left navigation panel width: null means "use the responsive CSS default"; once the user drags
  // the resize handle we pin an explicit --nav-width and remember it across sessions.
  const navRef=useRef<HTMLElement>(null);
  const [navWidth,setNavWidth]=useState<number|null>(()=>{try{const v=localStorage.getItem('navWidth');return v?Number(v):null;}catch{return null;}});
  function startNavResize(e:React.PointerEvent<HTMLDivElement>){
    e.preventDefault();
    const handle=e.currentTarget,startX=e.clientX,startWidth=navRef.current?.getBoundingClientRect().width||navWidth||238;
    handle.setPointerCapture(e.pointerId);
    const onMove=(ev:PointerEvent)=>setNavWidth(Math.round(Math.min(window.innerWidth*0.7,Math.max(180,startWidth+(ev.clientX-startX)))));
    const onUp=()=>{
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove',onMove);
      handle.removeEventListener('pointerup',onUp);
      setNavWidth(w=>{try{if(w!=null)localStorage.setItem('navWidth',String(w));}catch{}return w;});
    };
    handle.addEventListener('pointermove',onMove);
    handle.addEventListener('pointerup',onUp);
  }
  const name=workspace?.path?.split('/').filter(Boolean).pop()||'Your workspace';
  const levelOf=(n:AtlasNode):Level=>n.kind==='PACKAGE'?'PACKAGE':isType(n)?'CLASS':'METHOD';
  const eligibleFor=(targetLevel:Level,targetScope:ScopeSelection=scope):string[]=>graph?rankEligibleIds(graph,targetLevel,getEligibleIds(graph,targetLevel,targetScope)):[];
  // Actual card dimensions (nodeCard.ts owns them) for a set of eligible IDs, so the reducer can
  // place a newly admitted batch below the current bounding box (Step 3, Appendix A3) without
  // itself importing nodeCard or duplicating its dimension logic. Always covers survivors too
  // (dimensions are needed to compute their exact bottom/left edge, not just their center).
  const placementFor=(ids:string[]):Record<string,PlacementDims>|undefined=>{
    if(!graph)return undefined;
    const all=new Map(graph.nodes.map(n=>[n.id,n]));
    const out:Record<string,PlacementDims>={};
    for(const id of ids){const n=all.get(id);if(n){const c=nodeCard(n);out[id]={width:c.width,height:c.height,name:n.qualifiedName||n.simpleName};}}
    return out;
  };
  const node=graph&&viewState.inspectedKind==='NODE'&&viewState.inspectedSubjectId?graph.nodes.find(n=>n.id===viewState.inspectedSubjectId)||null:null;
  const displayedIds=viewState.levelViews[level].displayedIds;
  const levelGeometry=viewState.levelViews[level];
  function handleCameraChange(camera:Camera){dispatchView({type:'SET_CAMERA',level,camera,generation:viewState.generation});}
  function handleNodeMoved(id:string,position:Point){dispatchView({type:'NODE_MOVED',level,id,position,generation:viewState.generation});}
  const projected=useMemo(()=>graph?projectDisplayed(graph,level,displayedIds,kind):{nodes:[] as AtlasNode[],edges:[] as AtlasEdge[]},[graph,level,displayedIds,kind]);
  // An inspected aggregate edge must survive a relationship-filter change that excludes its kind
  // (Step 4, Appendix F3): its identity is resolved independently of the currently filtered
  // `projected.edges` by also checking an unfiltered ('ALL') projection of the same displayed page.
  // aggregateEdges() keys its aggregate ID on the underlying edge's own kind, not on this filter
  // parameter, so the same relationship keeps the same ID in both projections.
  // Only pay for the second aggregation when it can actually matter: an edge is currently
  // inspected AND the plain filtered projection above did not already contain it. This runs on
  // every filter/inspection change rather than unconditionally on every graph/level/displayedIds
  // change (which the explanation poller retriggers on each `graph` replacement, doubling
  // `decorate()` over every displayed node for no reason most of the time).
  const allKindsEdges=useMemo(()=>{
    if(!graph||viewState.inspectedKind!=='EDGE'||!viewState.inspectedSubjectId)return [] as AtlasEdge[];
    if(projected.edges.some(e=>e.id===viewState.inspectedSubjectId))return [] as AtlasEdge[];
    return projectDisplayed(graph,level,displayedIds,'ALL').edges;
  },[graph,level,displayedIds,viewState.inspectedKind,viewState.inspectedSubjectId,projected.edges]);
  // Unresolved relationships (target_symbol_id IS NULL) never reach projectDisplayed's edge
  // aggregation, since they have no target to aggregate onto — but the inspector's own "Inspect
  // relationship" button on an unresolved row dispatches INSPECT_EDGE with that record's raw ID, so
  // the lookup needs the same fallback shape InspectorPanel used to construct that button's target.
  const unresolvedEdge=viewState.inspectedKind==='EDGE'&&viewState.inspectedSubjectId
    ? (graph?.metadata?.unresolvedRelationships||[]).find((e:any)=>e.id===viewState.inspectedSubjectId)
    : undefined;
  const edge=viewState.inspectedKind==='EDGE'&&viewState.inspectedSubjectId
    ? projected.edges.find(e=>e.id===viewState.inspectedSubjectId)
      || allKindsEdges.find(e=>e.id===viewState.inspectedSubjectId)
      || (unresolvedEdge?{...unresolvedEdge,targetId:null,descriptiveLabel:unresolvedEdge.unresolvedTarget}:null)
    : null;
  // True only when the inspected edge is real but the current relationship filter hides its
  // drawing -- distinct from "unresolved" (never drawn regardless of filter, no notice needed).
  const edgeFilteredOut=!!edge&&!unresolvedEdge&&!projected.edges.some(e=>e.id===edge.id);
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
    const placementIn=(g:AtlasGraph,ids:string[]):Record<string,PlacementDims>=>{const all=new Map(g.nodes.map(n=>[n.id,n]));const out:Record<string,PlacementDims>={};for(const id of ids){const n=all.get(id);if(n){const c=nodeCard(n);out[id]={width:c.width,height:c.height,name:n.qualifiedName||n.simpleName};}}return out;};
    const initialPackageIds=rankEligibleIds(data,'PACKAGE',getEligibleIds(data,'PACKAGE',wholeSystemScope()));
    dispatchView({type:'RESET',level:'PACKAGE',eligibleIds:initialPackageIds,batchSize:Infinity,placement:placementIn(data,initialPackageIds)});
    const selected=params.get('selectedSymbol');
    if(selected){
      const n=data.nodes.find((n:AtlasNode)=>n.id===selected||n.simpleName===selected);
      if(n){
        const targetLevel=levelOf(n);
        if(targetLevel!=='PACKAGE'){const ids=rankEligibleIds(data,targetLevel,getEligibleIds(data,targetLevel,wholeSystemScope()));dispatchView({type:'NAVIGATE_LEVEL',level:targetLevel,eligibleIds:ids,batchSize:BATCH_SIZE,placement:placementIn(data,ids)});}
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
  // Named navigation commands (Step 4, Story 6/H3): explicit level changes triggered from a
  // specific resource ("View classes", "View methods", the tree's ⌖ button, the
  // inspector's "View methods"). Canvas double-click no longer routes through here -- it will get
  // its own dedicated arrangement command in Step 5 (Appendix B); until then it does nothing.
  function navigateExplicit(n:AtlasNode,targetLevel:Level){
    if(!graph)return;
    // NAVIGATE_LEVEL must run first: its reducer case pushes a level-only history breadcrumb when
    // this navigation starts from a completely uninspected state (Step 5 review remediation B1),
    // which only fires while inspectedSubjectId is still whatever it was before this call. Dispatching
    // INSPECT_NODE first would set it before NAVIGATE_LEVEL runs, silently skipping that breadcrumb.
    const ids=eligibleFor(targetLevel);
    dispatchView({type:'NAVIGATE_LEVEL',level:targetLevel,eligibleIds:ids,batchSize:BATCH_SIZE,placement:placementFor(ids)});
    dispatchView({type:'INSPECT_NODE',id:n.id});
    setTab('map');setSearch('');setMobilePane('map');
  }
  function viewClasses(n:AtlasNode){navigateExplicit(n,'CLASS');}
  function viewMethods(n:AtlasNode){navigateExplicit(n,'METHOD');}
  // Step 5 (Appendix B): the dedicated focused-arrangement command, wired to canvas double-click
  // (GraphCanvas's dbltap handler) and the inspector's keyboard/touch-accessible "Arrange around
  // this resource" action -- never to a single click, level navigation, or inspection. Uses exactly
  // the current displayed page (`projected`) and current filter, never the full backend graph, and
  // anchors the focus at its existing stored coordinate so an unchanged camera keeps its screen
  // position fixed (no fit is performed). A no-op when `id` is absent from the currently displayed
  // graph -- matching the inspector button's own disabled condition (H3).
  function arrangeAround(id:string){
    if(!graph)return;
    const cards:ArrangeCard[]=projected.nodes.map(n=>{const c=nodeCard(n);return {id:n.id,width:c.width,height:c.height,qualifiedName:n.qualifiedName||n.simpleName};});
    const arrangeEdges:ArrangeEdge[]=projected.edges.filter(e=>e.targetId).map(e=>({sourceId:e.sourceId,targetId:e.targetId!}));
    const anchor=levelGeometry.positions[id]||{x:0,y:0};
    const positions=arrangeAroundResource(cards,arrangeEdges,id,anchor);
    if(!positions)return;
    dispatchView({type:'ARRANGE_AROUND_RESOURCE',level,positions,generation:viewState.generation});
  }
  // Story 6: "Code map" returns to the last map view -- whatever level, scope, and inspection the
  // user had -- rather than resetting to Packages or clearing selection. viewState already
  // preserves all of that regardless of which tab is showing, so this is just a tab switch.
  function openCodeMap(){setTab('map');setMobilePane('map');}
  function handleScopeChange(next:ScopeSelection,explicitClassAddId?:string){
    setScope(next);
    if(!graph)return;
    const ids=eligibleFor(level,next);
    // Appendix F3: a scope edit changes eligibility for every level at once, not just the one
    // currently on screen. The two inactive levels must drop now-ineligible survivors immediately
    // too, or a later reconciliation cannot tell "still eligible, never left" apart from "removed
    // then re-added" (Step 4 point 8). Only set membership is needed here, so use the unranked
    // eligible-ID set rather than paying for a rank nobody reads.
    const otherLevels:Partial<Record<Level,string[]>>={};
    for(const lvl of (['PACKAGE','CLASS','METHOD'] as Level[])) if(lvl!==level) otherLevels[lvl]=getEligibleIds(graph,lvl,next);
    dispatchView({type:'SCOPE_UPDATED',eligibleIds:ids,explicitClassAddId,batchSize:level==='PACKAGE'?Infinity:BATCH_SIZE,placement:placementFor(ids),otherLevels});
  }
  function resetScope(){handleScopeChange(wholeSystemScope());}
  // Removes one or many map cards from scope as a single scope edit: folding every removal into one
  // accumulator (rather than calling handleScopeChange per card, which would each start from the same
  // stale `scope`) keeps all of them. Packages go first as one batch; a class or method then removes
  // its owning class only if that class is still in the accumulated scope. Scope holds only packages
  // and classes, so `removed` names what actually leaves it -- a method card's class -- for the menu label.
  function planScopeRemoval(targets:AtlasNode[]):{next:ScopeSelection;removed:AtlasNode[]}{
    if(!graph)return {next:scope,removed:[]};
    const all=new Map(graph.nodes.map(item=>[item.id,item]));
    let next=scope;
    const packages=targets.filter(n=>n.kind==='PACKAGE'&&isNodeInScope(n,scope,graph));
    if(packages.length)next=togglePackages(next,packages.map(n=>n.id),graph);
    const owners=new Map<string,AtlasNode>();
    for(const n of targets){if(n.kind==='PACKAGE')continue;const owner=isType(n)?n:ownerAt(n,'CLASS',all);if(owner)owners.set(owner.id,owner);}
    const removed=[...packages];
    for(const owner of owners.values())if(isClassInScope(owner,next,graph)){next=toggleClass(next,owner,graph);removed.push(owner);}
    return {next,removed};
  }
  function removeFromScope(targets:AtlasNode[]){
    const {next}=planScopeRemoval(targets);
    if(next!==scope)handleScopeChange(next);
  }
  const results=graph&&search.trim()?graph.nodes.filter(n=>(n.qualifiedName||n.simpleName).toLowerCase().includes(search.toLowerCase())).slice(0,35):[];
  const packages=graph?.nodes.filter(n=>n.kind==='PACKAGE')||[];
  const typeCount=graph?.nodes.filter(isType).length||0;
  // Walk from the most recent end so a subject visited twice non-consecutively (dedup in the
  // reducer only collapses immediate repeats) still yields exactly 3 distinct, most-recent-first
  // entries instead of a duplicate React key.
  const recentHistory=(()=>{const seen=new Set<string>(),out:typeof viewState.history=[];for(let i=viewState.history.length-1;i>=0&&out.length<3;i--){const h=viewState.history[i];if(h.kind!=='NODE'||h.subjectId===null||seen.has(h.subjectId))continue;seen.add(h.subjectId);out.push(h);}return out;})();
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
      <aside className="navigation" ref={navRef} style={navWidth!=null?{['--nav-width' as any]:`${navWidth}px`}:undefined}><nav className="workspace-nav"><button className={tab==='map'?'active':''} onClick={openCodeMap}>▦ <span>Code map</span></button><button className={tab==='routes'?'active':''} onClick={()=>{setTab('routes');setMobilePane('map');}}>▷ <span>Entry points</span><small>{routes.length}</small></button><button className={tab==='context'?'active':''} onClick={()=>{setTab('context');setMobilePane('map');}}>▤ <span>Project context</span></button></nav>
        <NavigationPane graph={graph} scope={scope} selectedNode={node} search={search} onScopeChange={handleScopeChange} onSelect={select} onViewClasses={viewClasses} onViewMethods={viewMethods}/>
        {recentHistory.length>0&&<div className="recent-symbols"><h3>Recently viewed</h3>{recentHistory.map(h=>{const n=graph.nodes.find(x=>x.id===h.subjectId);return n?<button key={h.subjectId} onClick={()=>select(n)}>◷ {n.simpleName}</button>:null;})}</div>}
        <div className="workspace-summary"><strong>{name}</strong><span>{typeCount} types across {packages.length} packages</span><button className="text-button" disabled={busy} onClick={()=>analyze()}>↻ Re-analyze source</button></div>
      </aside>
      <div className="nav-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize navigation panel" onPointerDown={startNavResize} onDoubleClick={()=>{setNavWidth(null);try{localStorage.removeItem('navWidth');}catch{}}} />
      <section className="workspace-content">
        {tab==='context'&&workspace?<ProjectDocuments key={workspace.id} workspaceId={workspace.id} onChanged={()=>setRevision(r=>r+1)}/>:tab==='routes'?<section className="entry-view"><div className="page-heading"><div><h1>Start with a request</h1><p>Follow an HTTP entry point into its handler and dependencies.</p></div></div>{routes.length?routes.map(r=>{const handler=graph.nodes.find(n=>n.id===r.symbol_version_id);return <button className="route-card" key={r.id} onClick={()=>{if(handler)(handler.kind==='PACKAGE'?viewClasses:viewMethods)(handler);}}><span className="tag">{r.http_method}</span><strong>{r.path}</strong><span>{handler?.simpleName||r.handler_qualified}</span><span>Explore ↗</span></button>;}):<div className="empty-state"><h2>No HTTP routes found</h2><p>Explore packages and classes to find this application's entry points.</p><button onClick={openCodeMap}>Open code map</button></div>}</section>:<>
          <div className="map-heading"><div className="breadcrumbs"><button onClick={openCodeMap}>{scopeCrumb}</button><span>/</span><span className="breadcrumb-level">{levelWord}</span>{node&&<><span>/</span><button onClick={()=>select(node)}>{node.simpleName}</button></>}</div><div className="page-heading"><div><h1>{node?node.simpleName:'Understand the whole system'}</h1><p>{node?'Follow the relationships around this part of the codebase.':`${typeCount} types across ${packages.length} packages. Choose a starting point.`}</p></div><button onClick={()=>{const entry=viewState.history[viewState.history.length-1];if(entry)dispatchView({type:'NAVIGATE_BACK',eligibleIds:eligibleFor(entry.level)});}} disabled={!viewState.history.length}>← Back</button></div>
          <div className="graph-toolbar"><div className="segmented" aria-label="Graph level">{(['PACKAGE','CLASS','METHOD'] as Level[]).map(l=><button className={level===l?'active':''} key={l} onClick={()=>{if(l===level)return;const ids=eligibleFor(l);dispatchView({type:'NAVIGATE_LEVEL',level:l,eligibleIds:ids,batchSize:l==='PACKAGE'?Infinity:BATCH_SIZE,placement:placementFor(ids)});if(viewState.inspectedKind==='EDGE'&&!unresolvedEdge)dispatchView({type:'CLEAR_INSPECTION'});}}>{l==='PACKAGE'?'Packages':l==='CLASS'?'Classes':'Methods'}</button>)}</div><select aria-label="Relationship kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">All dependencies</option>{[...new Set(graph.edges.map(e=>e.kind))].sort().map(k=><option key={k} value={k}>{k.toLowerCase().replaceAll('_',' ')}</option>)}</select></div>
          <div className="scope-banner"><span className="scope-banner-icon" aria-hidden="true">{scope.mode==='ALL'?'◈':'⌖'}</span><div className="scope-banner-text"><strong>{graph?scopeToLabel(graph,scope):''}</strong><span>Showing {levelWord.toLowerCase()} · {scopedCount} {levelWord.toLowerCase()}{scope.mode!=='ALL'?` in ${scopeUnitLabel()}`:''}</span></div><div className="scope-banner-actions">{node&&<span className="tag inspecting-chip">Inspecting {node.simpleName}</span>}{edge&&!node&&<span className="tag inspecting-chip">Inspecting a relationship</span>}{viewState.newlyAddedIds.length>0&&displayedIds.length>viewState.newlyAddedIds.length&&<span className="tag added-below-chip">{viewState.newlyAddedIds.length} added below</span>}{omittedCount>0&&<button className="show-more" onClick={()=>{const ids=eligibleFor(level);dispatchView({type:'SHOW_MORE',eligibleIds:ids,batchSize:BATCH_SIZE,placement:placementFor(ids)});}}>Showing {visibleCount} of {scopedCount} in scope · show {Math.min(BATCH_SIZE,omittedCount)} more</button>}{scope.mode==='CUSTOM'&&<button className="text-button" onClick={resetScope}>Reset to whole system</button>}</div></div>
          </div>
          {scopeEmpty
            ? <div className="scope-empty-state"><h2>No packages or classes selected</h2><p>Check packages or classes in the left tree to define what the graph shows.</p><button className="primary" onClick={resetScope}>Select all</button></div>
            : <GraphCanvas nodes={projected.nodes} edges={projected.edges} positions={levelGeometry.positions} camera={levelGeometry.camera} selectedId={node?.id||edge?.id} onNodeSelect={select} onEdgeSelect={inspectEdge} canRemoveFromScope={n=>isNodeInScope(n,scope,graph)} onRemoveFromScope={removeFromScope} scopeRemovalTargets={nodes=>planScopeRemoval(nodes).removed} onCameraChange={handleCameraChange} onNodeMoved={handleNodeMoved} onArrangeAroundResource={arrangeAround} onViewCode={n=>setSource({node:n,type:'symbol'})}/>}
          <div className="graph-legend"><span><i className="line-sample"/>Static dependency</span><span><i className="line-sample uncertain"/>Candidate / unresolved</span><span>{level==='METHOD'?'Method call occurrences':`${level==='PACKAGE'?'Package':'Class'} connections group occurrences by kind and resolution`}</span></div>
        </>}
      </section>
      {tab!=='context'&&<InspectorPanel selectedNode={node} selectedEdge={edge} mapStatus={mapStatus} edgeFilteredOut={edgeFilteredOut} workspaceId={workspace?.id||null} snapshotId={snapshot} graph={graph} routes={routes} revision={revision} onExplanationReady={()=>setRevision(r=>r+1)} onInspectEdge={inspectEdge} onSelect={select} onViewClasses={viewClasses} onViewMethods={viewMethods} onArrangeAroundResource={n=>arrangeAround(n.id)} onSource={(n,type='symbol')=>setSource({node:n,type})} onClose={()=>{dispatchView({type:'CLEAR_INSPECTION'});setMobilePane('map');}}/>}
    </main></>}
    <footer className="app-footer">{graph?.metadata?.diagnostics?.warnings?.length>0&&<details className="analysis-warnings"><summary>{graph?.metadata?.diagnostics?.warnings.length} analysis warning(s)</summary><div>{graph?.metadata?.diagnostics?.warnings.map((w:string,i:number)=><p key={i}>{w}</p>)}</div></details>}<span><i className={`status-dot ${graph?'configured':''}`}/>{status}</span>{graph&&<span>{graph.metadata?.unresolvedCount||0} unresolved external targets</span>}<div className="queue-summary">{queue?.activeJobId&&queue.synthesisStatus!=='READY'&&<span className="synthesis-progress"><i aria-hidden="true"/>{queue.synthesisStage || 'Preparing architecture'} · {synthesisElapsed}s · {queue.synthesisCompleted || 0} validated</span>}{!queue?.activeJobId&&queue?.jobStatus==='CANCELLED'&&<span>Explain all cancelled</span>}{queue&&<span>{queue.completed} explained · {queue.pending+queue.inProgress} queued · {queue.failed} failed</span>}{snapshot&&<button className={queue?.activeJobId?'':'primary'} onClick={explainAll}>{queue?.activeJobId?'Stop explain all':'✧ Explain all'}</button>}</div></footer>
    <SettingsScreen isOpen={settings} onClose={()=>setSettings(false)}/>
    {source&&snapshot&&<SourceDialog snapshot={snapshot} subject={source.node} type={source.type} onClose={()=>setSource(null)}/>}
  </div>;
}
