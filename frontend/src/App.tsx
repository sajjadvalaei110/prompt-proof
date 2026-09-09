import { useEffect, useMemo, useState } from 'react';
import './styles/App.css';
import { apiClient } from './api/client';
import GraphCanvas from './features/explorer/GraphCanvas';
import { AtlasGraph, AtlasNode, AtlasEdge, Level, isType, projectGraph } from './features/explorer/graphModel';
import { ScopeSelection, wholeSystemScope, scopeToLabel, focusScopeSelection } from './features/explorer/scopeModel';
import NavigationPane from './features/explorer/NavigationPane';
import InspectorPanel from './features/inspector/InspectorPanel';
import SettingsScreen from './features/settings/SettingsScreen';
import ProjectDocuments from './features/context/ProjectDocuments';
import SourceDialog from './features/source/SourceDialog';

export default function App() {
  const params = new URLSearchParams(location.search);
  const [path,setPath]=useState(params.get('path')||''),[workspace,setWorkspace]=useState<any>(null),[snapshot,setSnapshot]=useState<string|null>(null);
  const [graph,setGraph]=useState<AtlasGraph|null>(null),[routes,setRoutes]=useState<any[]>([]),[recent,setRecent]=useState<any[]>([]);
  const [status,setStatus]=useState('Open a project to begin'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [node,setNode]=useState<AtlasNode|null>(null),[edge,setEdge]=useState<AtlasEdge|null>(null),[history,setHistory]=useState<AtlasNode[]>([]);
  const [nodeLimit,setNodeLimit]=useState(12);
  const [level,setLevel]=useState<Level>('PACKAGE'),[scope,setScope]=useState<ScopeSelection>(wholeSystemScope()),[kind,setKind]=useState('ALL');
  const [tab,setTab]=useState('map'),[search,setSearch]=useState(''),[settings,setSettings]=useState(params.get('settings')==='true');
  const [queue,setQueue]=useState<any>(null),[revision,setRevision]=useState(0),[profile,setProfile]=useState<any>(null),[source,setSource]=useState<{node:{id:string;simpleName?:string};type:string}|null>(null);
  const [mobilePane,setMobilePane]=useState('map'),[showOpen,setShowOpen]=useState(false);
  const name=workspace?.path?.split('/').filter(Boolean).pop()||'Your workspace';
  async function loadSnapshot(id:string, ws?:any) {
    const [data,entryPoints]=await Promise.all([apiClient.getGraph(id),apiClient.getSpringRoutes(id)]);
    if(!ws&&!data?.metadata?.workspaceId)throw new Error('Snapshot response is missing workspace metadata; try re-opening the project.');
    const owner=ws||await apiClient.getWorkspace(data.metadata.workspaceId);
    setWorkspace(owner);setPath(owner.path);setSnapshot(id);setGraph(data);setRoutes(entryPoints);setNode(null);setEdge(null);setHistory([]);setScope(wholeSystemScope());setLevel('PACKAGE');setTab('map');setQueue(null);setStatus('Source analysis ready');setShowOpen(false);
    const selected=params.get('selectedSymbol'); if(selected){const n=data.nodes.find((n:AtlasNode)=>n.id===selected||n.simpleName===selected);if(n){setNode(n);setLevel(n.kind==='METHOD'?'METHOD':'CLASS');}}
    historyReplace(id);
  }
  function historyReplace(id:string){const url=new URL(location.href);url.search='';url.searchParams.set('snapshotId',id);window.history.replaceState(null,'',url);}
  async function analyze(input=path) {
    if(!input.trim()){setError('Enter a repository path accessible to the local server.');return;}
    setBusy(true);setError('');try{setStatus('Registering project…');const ws=await apiClient.createWorkspace(input.trim());setStatus('Analyzing Java source…');let job=await apiClient.triggerAnalysis(ws.id);while(!['COMPLETED','FAILED','CANCELLED'].includes(job.status)){await new Promise(r=>setTimeout(r,500));job=await apiClient.getJob(job.id);}if(job.status!=='COMPLETED')throw new Error(job.errorMessage||`Analysis ${job.status.toLowerCase()}`);const current=await apiClient.getWorkspace(ws.id);if(!current.activeSnapshotId)throw new Error('Analysis did not publish a snapshot');await loadSnapshot(current.activeSnapshotId,current);setRecent(await apiClient.listWorkspaces());}catch(e:any){setError(e.message);setStatus('Analysis could not finish');}finally{setBusy(false);}
  }
  useEffect(()=>{apiClient.listWorkspaces().then(setRecent).catch(e=>setError(e.message));if(params.get('snapshotId')){setBusy(true);loadSnapshot(params.get('snapshotId')!).catch(e=>setError(e.message)).finally(()=>setBusy(false));}else if(params.get('autoPath'))analyze(params.get('autoPath')!);},[]);
  useEffect(()=>{apiClient.getModelProfiles().then(p=>setProfile(p[0])).catch(()=>setProfile(null));},[settings]);
  useEffect(()=>{if(!workspace)return;let alive=true;const poll=()=>apiClient.getQueueStatus(workspace.id).then(q=>{if(alive)setQueue(q);}).catch(()=>{});poll();const timer=setInterval(poll,2000);return()=>{alive=false;clearInterval(timer);};},[workspace?.id]);
  useEffect(()=>{
    if(!snapshot)return;
    let alive=true;
    apiClient.getGraph(snapshot).then(data=>{if(alive)setGraph(previous=>JSON.stringify(previous)===JSON.stringify(data)?previous:data);}).catch(()=>{});
    return()=>{alive=false;};
  },[snapshot,revision,queue]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();document.getElementById('global-search')?.focus();}if(e.key==='Escape'){setSearch('');}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  function select(n:AtlasNode){if(node&&node.id!==n.id)setHistory(h=>[...h.slice(-19),node]);setNode(n);setEdge(null);setSearch('');if(n.kind!=='PACKAGE'){setLevel(n.kind==='METHOD'?'METHOD':'CLASS');setNodeLimit(12);}setMobilePane('details');}
  function explore(n:AtlasNode){if(!graph)return;const focused=focusScopeSelection(n,graph);select(n);setScope(focused.scope);setLevel(focused.level);setNodeLimit(12);setTab('map');setMobilePane('map');}
  function whole(){setScope(wholeSystemScope());setLevel('PACKAGE');setNodeLimit(12);setNode(null);setEdge(null);setTab('map');setMobilePane('map');}
  const projected=useMemo(()=>graph?projectGraph(graph,level,scope,kind,level==='PACKAGE'?Infinity:nodeLimit):{nodes:[],edges:[],scopedCount:0,visibleCount:0,omittedCount:0},[graph,level,scope,kind,nodeLimit]);
  const results=graph&&search.trim()?graph.nodes.filter(n=>(n.qualifiedName||n.simpleName).toLowerCase().includes(search.toLowerCase())).slice(0,35):[];
  const packages=graph?.nodes.filter(n=>n.kind==='PACKAGE')||[];
  const typeCount=graph?.nodes.filter(isType).length||0;
  function scopeUnitLabel(){if(scope.mode==='ALL')return'whole system';const pkgs=scope.selectedPackageIds.size,cls=scope.selectedClassIds.size;if(pkgs&&cls)return`${pkgs} selected package${pkgs===1?'':'s'} and ${cls} selected class${cls===1?'':'es'}`;if(pkgs)return`${pkgs} selected package${pkgs===1?'':'s'}`;if(cls)return`${cls} selected class${cls===1?'':'es'}`;return'no selection';}
  const levelWord=level==='PACKAGE'?'Packages':level==='CLASS'?'Classes':'Methods';
  const scopeCrumb=scope.mode==='ALL'?'Whole system':scopeUnitLabel();
  const scopeEmpty=scope.mode==='CUSTOM'&&scope.selectedPackageIds.size===0&&scope.selectedClassIds.size===0;
  async function explainAll(){if(!workspace||!snapshot)return;try{if(queue?.activeJobId){await apiClient.cancelJob(queue.activeJobId);setStatus('Pending explanation work cancelled');}else{await apiClient.startExplainAll(workspace.id,snapshot,1);setStatus('Synthesizing architecture, then explaining classes and methods');}setQueue(await apiClient.getQueueStatus(workspace.id));}catch(e:any){setError(e.message);}}
  return <div className="app-container">
    <header className="app-header"><button className="brand" onClick={whole}><span className="brand-mark">◈</span>Code Atlas</button><button className="workspace-switch" onClick={()=>setShowOpen(!showOpen)}>{workspace?name:'Open project'} <span>⌄</span></button>
      <div className="global-search"><span>⌕</span><input id="global-search" aria-label="Search codebase" placeholder="Find a class, method, or package…" value={search} onChange={e=>setSearch(e.target.value)} disabled={!graph}/><kbd>Ctrl K</kbd>{search&&<div className="search-results">{results.length?results.map(n=><button key={n.id} onClick={()=>{select(n);setLevel(n.kind==='PACKAGE'?'PACKAGE':n.kind==='METHOD'?'METHOD':'CLASS');setTab('map');}}><span>{n.simpleName}<small>{n.qualifiedName}</small></span><span className="tag">{n.kind.toLowerCase()}</span></button>):<p>No matching symbols</p>}</div>}</div>
      <button className="model-status" onClick={()=>setSettings(true)}><span className={`status-dot ${profile?.baseUrl?'configured':''}`}/>{profile?.baseUrl?'Model configured':'Set up model'}</button><button className="icon-button" aria-label="Model settings" onClick={()=>setSettings(true)}>⚙</button>
    </header>
    {queue?.errorMessage&&<div className="error-banner" role="alert"><span>{queue.errorMessage}</span></div>}
    {error&&<div className="error-banner" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">✕</button></div>}
    {(showOpen||!graph)&&<section className={graph?'open-project-bar':'welcome'}><div><span className="welcome-icon">◈</span><h1>{graph?'Open a project':'Find your way through the code.'}</h1><p>Explore the structure. Follow a dependency. Understand why it exists.</p></div><form onSubmit={e=>{e.preventDefault();analyze();}}><label>Local repository path<input value={path} onChange={e=>setPath(e.target.value)} placeholder="/path/to/your/java-project" disabled={busy}/></label><button className="primary" disabled={busy}>{busy?'Analyzing…':'Analyze project'}</button></form><p className="muted">Source-only analysis. Your repository is read-only; no Gradle builds or application code are executed.</p>{recent.length>0&&<div className="recent-projects"><h3>Recent projects</h3>{recent.map(ws=><button key={ws.id} disabled={busy} onClick={()=>{if(ws.activeSnapshotId){setBusy(true);loadSnapshot(ws.activeSnapshotId,ws).catch(e=>setError(e.message)).finally(()=>setBusy(false));}else{setPath(ws.path);analyze(ws.path);}}}><span>▱ {ws.path.split('/').pop()}<small>{ws.path}</small></span><span>Open ↗</span></button>)}</div>}</section>}
    {graph&&<><nav className="mobile-tabs">{['explorer','map','details'].map(p=><button className={mobilePane===p?'active':''} key={p} onClick={()=>setMobilePane(p)}>{p}</button>)}</nav><main className={`app-main pane-${mobilePane}`}>
      <aside className="navigation"><nav className="workspace-nav"><button className={tab==='map'?'active':''} onClick={whole}>▦ <span>Code map</span></button><button className={tab==='routes'?'active':''} onClick={()=>{setTab('routes');setMobilePane('map');}}>▷ <span>Entry points</span><small>{routes.length}</small></button><button className={tab==='context'?'active':''} onClick={()=>{setTab('context');setMobilePane('map');}}>▤ <span>Project context</span></button></nav>
        <NavigationPane graph={graph} scope={scope} selectedNode={node} search={search} onScopeChange={setScope} onSelect={select} onFocusScope={explore}/>
        {history.length>0&&<div className="recent-symbols"><h3>Recently viewed</h3>{history.slice(-3).reverse().map((n,i)=><button key={`${n.id}-${i}`} onClick={()=>select(n)}>◷ {n.simpleName}</button>)}</div>}
        <div className="workspace-summary"><strong>{name}</strong><span>{typeCount} types across {packages.length} packages</span><button className="text-button" disabled={busy} onClick={()=>analyze()}>↻ Re-analyze source</button></div>
      </aside>
      <section className="workspace-content">
        {tab==='context'&&workspace?<ProjectDocuments key={workspace.id} workspaceId={workspace.id} onChanged={()=>setRevision(r=>r+1)}/>:tab==='routes'?<section className="entry-view"><div className="page-heading"><div><h1>Start with a request</h1><p>Follow an HTTP entry point into its handler and dependencies.</p></div></div>{routes.length?routes.map(r=>{const handler=graph.nodes.find(n=>n.id===r.symbol_version_id);return <button className="route-card" key={r.id} onClick={()=>{if(handler)explore(handler);}}><span className="tag">{r.http_method}</span><strong>{r.path}</strong><span>{handler?.simpleName||r.handler_qualified}</span><span>Explore ↗</span></button>;}):<div className="empty-state"><h2>No HTTP routes found</h2><p>Explore packages and classes to find this application's entry points.</p><button onClick={whole}>Open code map</button></div>}</section>:<>
          <div className="map-heading"><div className="breadcrumbs"><button onClick={whole}>{scopeCrumb}</button><span>/</span><span className="breadcrumb-level">{levelWord}</span>{node&&<><span>/</span><button onClick={()=>select(node)}>{node.simpleName}</button></>}</div><div className="page-heading"><div><h1>{node?node.simpleName:'Understand the whole system'}</h1><p>{node?'Follow the relationships around this part of the codebase.':`${typeCount} types across ${packages.length} packages. Choose a starting point.`}</p></div><button onClick={()=>{if(history.length){const previous=history[history.length-1];setHistory(h=>h.slice(0,-1));setNode(previous);setEdge(null);setLevel(previous.kind==='PACKAGE'?'PACKAGE':previous.kind==='METHOD'?'METHOD':'CLASS');setNodeLimit(12);}}} disabled={!history.length}>← Back</button></div>
          <div className="graph-toolbar"><div className="segmented" aria-label="Graph level">{(['PACKAGE','CLASS','METHOD'] as Level[]).map(l=><button className={level===l?'active':''} key={l} onClick={()=>{setLevel(l);setNodeLimit(12);setEdge(null);setNode(null);}}>{l==='PACKAGE'?'Packages':l==='CLASS'?'Classes':'Methods'}</button>)}</div><select aria-label="Relationship kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">All dependencies</option>{[...new Set(graph.edges.map(e=>e.kind))].sort().map(k=><option key={k} value={k}>{k.toLowerCase().replaceAll('_',' ')}</option>)}</select></div>
          <div className="scope-banner"><span className="scope-banner-icon" aria-hidden="true">{scope.mode==='ALL'?'◈':'⌖'}</span><div className="scope-banner-text"><strong>{graph?scopeToLabel(graph,scope):''}</strong><span>Showing {levelWord.toLowerCase()} · {projected.scopedCount} {levelWord.toLowerCase()}{scope.mode!=='ALL'?` in ${scopeUnitLabel()}`:''}</span></div><div className="scope-banner-actions">{node&&<span className="tag inspecting-chip">Inspecting {node.simpleName}</span>}{edge&&!node&&<span className="tag inspecting-chip">Inspecting a relationship</span>}{projected.omittedCount>0&&<button className="show-more" onClick={()=>setNodeLimit(l=>l+12)}>Showing {projected.visibleCount} of {projected.scopedCount} in scope · show {Math.min(12,projected.omittedCount)} more</button>}{scope.mode==='CUSTOM'&&<button className="text-button" onClick={whole}>Reset to whole system</button>}</div></div>
          </div>
          {scopeEmpty?<div className="scope-empty-state"><h2>No packages or classes selected</h2><p>Check packages or classes in the left tree to define what the graph shows.</p><button className="primary" onClick={whole}>Select all</button></div>:<GraphCanvas nodes={projected.nodes} edges={projected.edges} selectedId={node?.id||edge?.id} onNodeSelect={select} onExplore={explore} onEdgeSelect={e=>{setEdge(e);setNode(null);setMobilePane('details');}}/>}
          <div className="graph-legend"><span><i className="line-sample"/>Static dependency</span><span><i className="line-sample uncertain"/>Candidate / unresolved</span><span>{level==='METHOD'?'Method call occurrences':`${level==='PACKAGE'?'Package':'Class'} connections group occurrences by kind and resolution`}</span></div>
        </>}
      </section>
      {tab!=='context'&&<InspectorPanel selectedNode={node} selectedEdge={edge} workspaceId={workspace?.id||null} snapshotId={snapshot} graph={graph} routes={routes} revision={revision} onInspectEdge={e=>{setEdge(e);setNode(null);setMobilePane('details');}} onSelect={select} onExplore={explore} onSource={(n,type='symbol')=>setSource({node:n,type})} onClose={()=>{setNode(null);setEdge(null);setMobilePane('map');}}/>}
    </main></>}
    <footer className="app-footer">{graph?.metadata?.diagnostics?.warnings?.length>0&&<details className="analysis-warnings"><summary>{graph?.metadata?.diagnostics?.warnings.length} analysis warning(s)</summary><div>{graph?.metadata?.diagnostics?.warnings.map((w:string,i:number)=><p key={i}>{w}</p>)}</div></details>}<span><i className={`status-dot ${graph?'configured':''}`}/>{status}</span>{graph&&<span>{graph.metadata?.unresolvedCount||0} unresolved external targets</span>}<div className="queue-summary">{queue?.activeJobId&&queue.synthesisStatus!=='READY'&&<span>Building architecture drafts…</span>}{queue&&<span>{queue.completed} explained · {queue.pending+queue.inProgress} queued · {queue.failed} failed</span>}{snapshot&&<button className={queue?.activeJobId?'':'primary'} onClick={explainAll}>{queue?.activeJobId?'Stop explain all':'✧ Explain all'}</button>}</div></footer>
    <SettingsScreen isOpen={settings} onClose={()=>setSettings(false)}/>
    {source&&snapshot&&<SourceDialog snapshot={snapshot} subject={source.node} type={source.type} onClose={()=>setSource(null)}/>}
  </div>;
}
