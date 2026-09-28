import { SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import './styles/App.css';
import { apiClient } from './api/client';
import GraphCanvas from './features/explorer/GraphCanvas';
import { AtlasGraph, AtlasNode, AtlasEdge, Level, isType, ownerAt, getEligibleIds, rankEligibleIds, projectDisplayed, childrenOf, revealContainers } from './features/explorer/graphModel';
import { ScopeSelection, wholeSystemScope, scopeToLabel, isNodeInScope, isClassInScope, togglePackages, toggleClass } from './features/explorer/scopeModel';
import { explorerViewReducer, initExplorerViewState, nearestHiddenAncestor, collapseTargets, ExplorerViewState, ExplorerAction, PlacementDims, Point, Camera, CardMoves } from './features/explorer/explorerViewState';
import { arrangeDisplayed, ArrangeEdge, DisplayedCard } from './features/explorer/focusedArrangement';
import { nodeCard, defaultCardSize, CardSize } from './features/explorer/nodeCard';
import { Box, RoomCard, boxOfCard, containerBox, layoutChildren, roomMoves } from './features/explorer/expansionLayout';
import { geometryForJourney, placementForGraphs } from './features/explorer/placementGeometry';
import NavigationPane from './features/explorer/NavigationPane';
import InspectorPanel from './features/inspector/InspectorPanel';
import SettingsScreen from './features/settings/SettingsScreen';
import ProjectDocuments from './features/context/ProjectDocuments';
import SourceDialog from './features/source/SourceDialog';
import type { SourceSubject } from './features/source/SourceDialog';
import { useReviewComparison } from './features/review/useReviewComparison';
import { startSerialPolling } from './utils/serialPolling';
import { useExplorerJourneys, flushExplorerCamera } from './features/explorer/useExplorerJourneys';
import { Journey, collapseInJourney, cycleRelationStack, newJourney, toggleJourneyReview, toggleRelationStack } from './features/explorer/explorerJourney';
import { revalidateJourneyState } from './features/explorer/revalidateJourney';
import { outgoingStack, stackSummary, type StackDirection } from './features/explorer/outgoingStack';

const REVIEW_BATCH_SIZE = 12;

function initialViewForGraph(g: AtlasGraph) {
  const placement: Record<string, PlacementDims> = {};
  const initialPackageIds = rankEligibleIds(g, 'PACKAGE', getEligibleIds(g, 'PACKAGE', wholeSystemScope()));
  for (const id of initialPackageIds) {
    const n = g.nodes.find(item => item.id === id);
    if (n) { const card = nodeCard(n); placement[id] = { width: card.width, height: card.height, name: n.qualifiedName || n.simpleName }; }
  }
  return explorerViewReducer(initExplorerViewState(), { type: 'RESET', level: 'PACKAGE', eligibleIds: initialPackageIds, batchSize: Infinity, placement });
}

export default function App() {
  const searchId = 'global-search';
  const journeyTabId = (id: number) => `journey-tab-${id}`;
  const panelId = 'exploration-panel';
  const params = new URLSearchParams(location.search);
  const [path,setPath]=useState(params.get('path')||''),[workspace,setWorkspace]=useState<any>(null),[snapshot,setSnapshot]=useState<string|null>(null);
  // `mapGraph` is the ordinary analyzed snapshot; `reviewComparison.graph` is the Base+changes
  // overlay for the currently loaded Git comparison. `graph` below (used by everything downstream --
  // projection, tree, search, inspector, canvas) picks whichever the ACTIVE TAB currently shows, so
  // one tab can browse the map while another reviews changes side by side.
  const [mapGraph,setMapGraph]=useState<AtlasGraph|null>(null),[routes,setRoutes]=useState<any[]>([]),[recent,setRecent]=useState<any[]>([]);
  const [status,setStatus]=useState('Open a project to begin'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const reviewComparison=useReviewComparison(workspace?.id||null,mapGraph);
  // Updates end an outgoing stack whose root they take off the map, judged against the graph each journey renders.
  const journeys=useExplorerJourneys(undefined,j=>j.review?reviewComparison.graph:mapGraph);
  const {active,dispatchView}=journeys;
  const graph = active.present.review && reviewComparison.graph ? reviewComparison.graph : mapGraph;
  const {view:viewState,scope,kind,tab,search,source,mobilePane,navWidth}=active.present;
  const setScope=(v:ScopeSelection)=>journeys.set('scope',v);
  const setKind=(v:string)=>journeys.set('kind',v);
  const setTab=(v:string)=>journeys.set('tab',v);
  const setSearch=(v:string)=>journeys.set('search',v);
  const setSource=(v:typeof source)=>journeys.set('source',v);
  const setMobilePane=(v:string)=>journeys.set('mobilePane',v);
  const setNavWidth=(v:SetStateAction<number|null>)=>journeys.set('navWidth',v);
  const leaveFullscreen=useRef(()=>{});
  leaveFullscreen.current=()=>journeys.setTransient('fullscreen',false);
  // The browser owns fullscreen on the document root. Keep that lifecycle above the keyed
  // exploration pane so tab remounts do not detach the native fullscreen owner.
  useEffect(()=>{
    if(!active.present.fullscreen)return;
    const root=document.documentElement;
    if(!document.fullscreenElement&&root.requestFullscreen)root.requestFullscreen().catch(()=>{});
    const change=()=>{if(!document.fullscreenElement)leaveFullscreen.current();};
    document.addEventListener('fullscreenchange',change);
    return()=>{document.removeEventListener('fullscreenchange',change);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});};
  },[active.present.fullscreen]);
  const BATCH_SIZE=REVIEW_BATCH_SIZE;
  const level=viewState.activeLevel;
  const [settings,setSettings]=useState(params.get('settings')==='true');
  const [queue,setQueue]=useState<any>(null),[revision,setRevision]=useState(0),[profile,setProfile]=useState<any>(null);
  const [showOpen,setShowOpen]=useState(false);
  const navRef=useRef<HTMLElement>(null);
  // Read inside a pointer-drag's long-lived closure instead of the `navWidth` captured when the drag
  // started: a keyboard resize (Arrow/Home) mid-drag would otherwise be silently discarded by a
  // cancel reverting to the pre-drag value rather than the latest one.
  const navWidthRef=useRef(navWidth);
  navWidthRef.current=navWidth;
  // The single clamp both the pointer and the keyboard path resize through, so the two can never
  // disagree about the panel's bounds (and both stay in step with .navigation's CSS min/max-width).
  const NAV_MIN=180,navMax=()=>window.innerWidth*0.7;
  const clampNavWidth=(w:number)=>Math.round(Math.min(navMax(),Math.max(NAV_MIN,w)));
  // Where a resize starts from. `navWidth` is null until the user first resizes (the CSS default is
  // responsive), so the rendered width is the only truthful starting point -- both paths must use it,
  // or the first arrow key press would jump the panel to a hardcoded 238.
  const currentNavWidth=()=>navRef.current?.getBoundingClientRect().width||navWidth||238;
  const persistNavWidth=()=>setNavWidth(w=>{try{if(w!=null)localStorage.setItem('navWidth',String(w));}catch{}return w;});
  const resetNavWidth=()=>{setNavWidth(null);try{localStorage.removeItem('navWidth');}catch{}};
  // Sticky for a short window after a real drag: the browser can still deliver a native `dblclick`
  // right after a quick click-drag-release-click sequence (two `pointerup`s close enough together),
  // which would otherwise call resetNavWidth() and silently discard the drag the user just made.
  const justDraggedNavRef=useRef(false);
  function startNavResize(e:React.PointerEvent<HTMLDivElement>){
    e.preventDefault();
    const handle=e.currentTarget,startX=e.clientX,startWidth=currentNavWidth();
    handle.setPointerCapture(e.pointerId);
    let width=startWidth,moved=false;
    const onMove=(ev:PointerEvent)=>{
      if(Math.abs(ev.clientX-startX)>3)moved=true;
      width=clampNavWidth(startWidth+(ev.clientX-startX));
      navRef.current?.style.setProperty('--nav-width',`${width}px`);
      // React state (and the aria-valuenow it drives) does not update mid-drag -- keep the announced
      // value live rather than frozen at the pre-drag width for the whole gesture (WCAG 2.1 SC 4.1.2).
      handle.setAttribute('aria-valuenow',String(Math.round(width)));
    };
    const finish=(cancel:boolean)=>{
      if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove',onMove);
      handle.removeEventListener('pointerup',onUp);
      handle.removeEventListener('pointercancel',onCancel);
      if(cancel){
        const latest=navWidthRef.current,reverted=latest??currentNavWidth();
        if(latest===null)navRef.current?.style.removeProperty('--nav-width');else navRef.current?.style.setProperty('--nav-width',`${latest}px`);
        handle.setAttribute('aria-valuenow',String(Math.round(reverted)));
      } else{setNavWidth(width);persistNavWidth();}
      if(moved){justDraggedNavRef.current=true;setTimeout(()=>{justDraggedNavRef.current=false;},400);}
    };
    const onUp=()=>finish(false),onCancel=()=>finish(true);
    handle.addEventListener('pointercancel',onCancel);
    handle.addEventListener('pointermove',onMove);
    handle.addEventListener('pointerup',onUp);
  }
  // Keyboard operation of the separator (WCAG 2.1 SC 2.1.1): Arrow keys step, Shift+Arrow steps
  // further, Home/Enter reset to the responsive default -- the same reset double-click performs.
  // Every branch resizes through clampNavWidth and persists like the pointer path's pointerup does.
  function navResizeKeyDown(e:React.KeyboardEvent<HTMLDivElement>){
    const step=e.shiftKey?40:10;
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      e.preventDefault();
      setNavWidth(clampNavWidth(currentNavWidth()+(e.key==='ArrowRight'?step:-step)));
      persistNavWidth();
    } else if(e.key==='Home'||e.key==='Enter'){
      e.preventDefault();
      resetNavWidth();
    }
  }
  const name=workspace?.path?.split('/').filter(Boolean).pop()||'Your workspace';
  const levelOf=(n:AtlasNode):Level=>n.kind==='PACKAGE'?'PACKAGE':isType(n)?'CLASS':'METHOD';
  const eligibleFor=(targetLevel:Level,targetScope:ScopeSelection=scope):string[]=>graph?rankEligibleIds(graph,targetLevel,getEligibleIds(graph,targetLevel,targetScope)):[];
  // Actual card dimensions (nodeCard.ts owns them) for a set of eligible IDs, so the reducer can
  // place a newly admitted batch below the current bounding box (Step 3, Appendix A3) without
  // itself importing nodeCard or duplicating its dimension logic. Always covers survivors too
  // (dimensions are needed to compute their exact bottom/left edge, not just their center).
  // An expanded survivor reports its real box (and center), so additions land below what is on screen.
  const placementFor=(ids:string[],targetScope:ScopeSelection=scope):Record<string,PlacementDims>|undefined=>{
    if(!graph)return undefined;
    // The current journey keeps cards from the hidden presentation parked in the same geometry.
    // They are absent from `graph`, but still occupy the map and may enlarge a shared expanded
    // card. This is deliberately symmetric: ordinary-only cards stay parked while Changes is on,
    // just as review-only cards do while it is off.
    const parkedGraph=active.present.review?mapGraph||undefined:reviewComparison.graph||undefined;
    return placementForGraphs(graph,viewState,targetScope,kind,ids,parkedGraph);
  };
  const node=graph&&viewState.inspectedKind==='NODE'&&viewState.inspectedSubjectId?graph.nodes.find(n=>n.id===viewState.inspectedSubjectId)||null:null;
  // In review mode, a card/route carries only its display ID (keyed on the comparison, not the
  // database -- see reviewModel.ts). Source and evidence endpoints need the real symbol/relationship
  // ID and its pinned base/head snapshot, which sourceIdentityMaps resolves.
  function openSource(subject: SourceSubject | AtlasNode, type='symbol') {
    if(!subject?.id)return;
    const identityMaps=active.present.review?reviewComparison.identityMaps:null;
    if(identityMaps){
      if(type==='symbol'){
        const item=subject as AtlasNode;
        const identity=identityMaps.symbols[item.id];
        if(!identity)return;
        setSource({node:{id:identity.id,simpleName:item.simpleName},type,snapshotId:identity.snapshotId,label:identity.side==='base'?'base snapshot':'after-change snapshot'});
      }else{
        const requested=(subject as SourceSubject).ids;
        const candidates=requested?.length?requested:[subject.id];
        const identities=candidates.map(id=>identityMaps.relationships[id]).filter(Boolean);
        const identity=identities[0]||identityMaps.relationships[subject.id];
        if(!identity)return;
        const ids=identities.length?identities.map(item=>item.id):requested;
        setSource({node:{id:identity.id,ids,simpleName:subject.simpleName},type,snapshotId:identity.snapshotId,label:identity.side==='base'?'base snapshot':'after-change snapshot'});
      }
      return;
    }
    setSource({node:subject,type});
  }
  const displayedIds=viewState.levelViews[level].displayedIds;
  const levelGeometry=viewState.levelViews[level];
  const expansions=levelGeometry.expansions,sizes=levelGeometry.sizes;
  // The one source of card dimensions for placement, arrangement, expansion and rendering alike.
  const cardSizeOf=(n:AtlasNode):CardSize=>sizes[n.id]||defaultCardSize(n);
  const containerSizes=useMemo(()=>{const out:Record<string,CardSize>={};for(const [id,e] of Object.entries(expansions))if(e.minSize)out[id]=e.minSize;return out;},[expansions]);
  function handleCameraChange(camera:Camera,initial=false,transient=false){
    const action={type:'SET_CAMERA' as const,level,camera,generation:viewState.generation};
    if(transient)journeys.setTransientCamera(action);else dispatchView(action,initial);
  }
  function handleNodeMoved(id:string,position:Point,containerId:string|null){dispatchView({type:'NODE_MOVED',level,id,position,containerId,generation:viewState.generation});}
  function handleNodesMoved(moves:{id:string;position:Point;containerId:string|null}[]){dispatchView({type:'NODES_MOVED',level,moves,generation:viewState.generation});}
  const expansionInput=useMemo(()=>({expansions:Object.entries(expansions).map(([id,e])=>({id,ownerId:e.ownerId,hidden:e.hidden})),scope}),[expansions,scope]);
  const projected=useMemo(()=>graph?projectDisplayed(graph,level,displayedIds,kind,expansionInput):{nodes:[] as AtlasNode[],edges:[] as AtlasEdge[]},[graph,level,displayedIds,kind,expansionInput]);
  // The relation stack (outgoing, or incoming over reversed facts): a walk over the tab's parser facts
  // (`graph`, ordinary or Changes) at the root's granularity, mapped onto the drawn cards and routes and
  // recomputed whenever they, the filter or the expansions change (docs/OUTGOING_STACK.md). GraphCanvas
  // only applies it.
  const relationStack=active.present.relationStack;
  const stackRootId=relationStack?.rootId??null, stackDirection=relationStack?.direction??'out';
  const stack=useMemo(()=>stackRootId&&graph?outgoingStack({graph,cards:projected.nodes,routes:projected.edges,rootId:stackRootId,kind,direction:stackDirection}):null,[graph,projected,stackRootId,stackDirection,kind]);
  // A pinned pointer like selection: changing it never occupies undo history (ADR 0009 classification).
  // The card button cycles off -> outgoing -> incoming -> off on the root; on any other card it starts
  // at outgoing. The menu items set one direction directly, or end it when it is already shown.
  function cycleStack(id:string){journeys.update(j=>({...j,relationStack:cycleRelationStack(j.relationStack,id)}));}
  function toggleStack(id:string,direction:StackDirection){journeys.update(j=>({...j,relationStack:toggleRelationStack(j.relationStack,id,direction)}));}
  // Model positions for every visible card (children of expanded cards included) and the derived box
  // of every expanded card. A child with no stored position yet (it entered scope while its container
  // was open) is placed below its placed siblings, deterministically, until it is first moved.
  // Keep the live canvas and asynchronous review admissions on the same geometry path. In
  // particular, an expanded card is placed using its derived compound box (including a user
  // minimum size), rather than its stale ordinary card dimensions.
  const geometry=useMemo(()=>{
    if(!graph)return {positions:{} as Record<string,Point>,boxes:{} as Record<string,Box>};
    const derived=geometryForJourney(graph,viewState,scope,kind,projected);
    return {positions:derived.positions,boxes:derived.boxes};
  },[graph,level,displayedIds,projected,levelGeometry.positions,expansions,sizes,scope,kind]);
  // An inspected aggregate edge must survive a relationship-filter change that excludes its kind
  // (Step 4, Appendix F3): its identity is resolved independently of the currently filtered
  // `projected.edges` by also checking an unfiltered ('ALL') projection of the same displayed page.
  // aggregateEdges() keys its aggregate ID solely on the ordered (source, target) endpoints --
  // `aggregate:[source,target]`, with neither kind nor resolution in the key -- so a filter change
  // only thins or removes a line, and the same relationship keeps the same ID in both projections.
  // Only pay for the second aggregation when it can actually matter: an edge is currently
  // inspected AND the plain filtered projection above did not already contain it. This runs on
  // every filter/inspection change rather than unconditionally on every graph/level/displayedIds
  // change (which the explanation poller retriggers on each `graph` replacement, doubling
  // `decorate()` over every displayed node for no reason most of the time).
  const allKinds=useMemo(()=>{
    const none={edges:[] as AtlasEdge[],viaUnexpanded:false};
    if(!graph||viewState.inspectedKind!=='EDGE'||!viewState.inspectedSubjectId)return none;
    if(projected.edges.some(e=>e.id===viewState.inspectedSubjectId))return none;
    const unfiltered=projectDisplayed(graph,level,displayedIds,'ALL',expansionInput).edges;
    if(unfiltered.some(e=>e.id===viewState.inspectedSubjectId))return {edges:unfiltered,viaUnexpanded:false};
    // Expanding an endpoint container re-resolves its relationships onto the deeper cards, so the
    // aggregate route between the two containers stops existing in every current-expansion
    // projection. Without this last fallback `edge` became null and the inspector dropped to its
    // idle screen mid-read, while inspectedSubjectId still pointed at the route -- collapsing the
    // container made it silently reappear. The un-expanded projection still knows the relationship,
    // so the panel keeps its content and says the line is not currently drawn (see
    // edgeHiddenByExpansion). Only reached when an edge is inspected and neither projection above
    // contains it, so the ordinary case still pays for at most one extra aggregation.
    return {edges:projectDisplayed(graph,level,displayedIds,'ALL',{expansions:[],scope}).edges,viaUnexpanded:true};
  },[graph,level,displayedIds,expansionInput,scope,viewState.inspectedKind,viewState.inspectedSubjectId,projected.edges]);
  const allKindsEdges=allKinds.edges;
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
  // The inspected route is real but not currently drawn because an endpoint container is expanded,
  // so its relationships resolve onto the deeper cards instead. Checked against an all-kinds
  // projection at the *current* expansions, so it cannot be confused with the filter case below.
  const edgeHiddenByExpansion=!!edge&&!unresolvedEdge&&allKinds.viaUnexpanded;
  // True only when the inspected edge is real but the current relationship filter hides its
  // drawing -- distinct from "unresolved" (never drawn regardless of filter, no notice needed) and
  // from the expansion case above, which has its own reason and must not be blamed on the filter.
  const edgeFilteredOut=!!edge&&!unresolvedEdge&&!edgeHiddenByExpansion&&!projected.edges.some(e=>e.id===edge.id);
  const eligibleIds=useMemo(()=>graph?getEligibleIds(graph,level,scope):[],[graph,level,scope]);
  const scopedCount=eligibleIds.length,visibleCount=projected.nodes.length,omittedCount=Math.max(0,scopedCount-visibleCount);
  // A node can only actually be a rendered card when its own natural level (Package/Class/Method)
  // IS the currently active graph level: a cached page from a level the user isn't looking at
  // right now is not "displayed" on the map they're looking at, even if that other level's page
  // happens to still contain this ID from an earlier visit.
  // A card inside an expanded card is displayed too, whatever its own natural level.
  // Files the parser could not read: every type they declare is missing from the map, so say so.
  const unanalyzedFiles:string[]=(graph?.metadata as any)?.unanalyzedFiles||[];
  const mapStatus=node&&graph?(!isNodeInScope(node,scope,graph)?'OUT_OF_SCOPE':expansions[node.id]?.hidden?'UNGROUPED':(level===levelOf(node)&&displayedIds.includes(node.id))||projected.nodes.some(n=>n.id===node.id)?'DISPLAYED':'IN_SCOPE_NOT_DISPLAYED'):null;
  async function loadSnapshot(id:string, ws?:any) {
    const [data,entryPoints]=await Promise.all([apiClient.getGraph(id),apiClient.getSpringRoutes(id)]);
    if(!ws&&!data?.metadata?.workspaceId)throw new Error('Snapshot response is missing workspace metadata; try re-opening the project.');
    const owner=ws||await apiClient.getWorkspace(data.metadata.workspaceId);
    setWorkspace(owner);setPath(owner.path);setSnapshot(id);setMapGraph(data);setRoutes(entryPoints);setQueue(null);setStatus('Source analysis ready');setShowOpen(false);reviewComparison.reset();
    const placementIn=(g:AtlasGraph,ids:string[]):Record<string,PlacementDims>=>{const all=new Map(g.nodes.map(n=>[n.id,n]));const out:Record<string,PlacementDims>={};for(const id of ids){const n=all.get(id);if(n){const c=nodeCard(n);out[id]={width:c.width,height:c.height,name:n.qualifiedName||n.simpleName};}}return out;};
    const initialPackageIds=rankEligibleIds(data,'PACKAGE',getEligibleIds(data,'PACKAGE',wholeSystemScope()));
    let initialView=explorerViewReducer(initExplorerViewState(),{type:'RESET',level:'PACKAGE',eligibleIds:initialPackageIds,batchSize:Infinity,placement:placementIn(data,initialPackageIds)});
    const selected=params.get('selectedSymbol');
    if(selected){
      const n=data.nodes.find((n:AtlasNode)=>n.id===selected||n.simpleName===selected);
      if(n){
        // A deep-linked class/method is not a top-level PACKAGE-level card: expand its package, then
        // (for a method) its type, in place (as the ⊞ button would) so the target is actually displayed,
        // rather than jumping the whole map to a class/method level (that level view is gone).
        const all=new Map<string,AtlasNode>(data.nodes.map((x:AtlasNode)=>[x.id,x]));
        const chain=revealContainers(n,all);
        for(const [i,ancestor] of chain.entries()){
          // A type sits in its package's box, so its position is stored with that expansion.
          const lg=initialView.levelViews.PACKAGE,owner=chain[i-1]??null;
          const pos=owner?lg.expansions[owner.id]?.childPositions[ancestor.id]:lg.positions[ancestor.id];
          if(!pos)break;
          const size=lg.sizes[ancestor.id]||defaultCardSize(ancestor);
          const before=boxOfCard({id:ancestor.id,...size,...pos});
          const kids=childrenOf(data,ancestor,wholeSystemScope(),all);
          if(!kids.length)break;
          const childPositions=layoutChildren({x:before.x1,y:before.y1},kids.map(c=>({id:c.id,...nodeCard(c)})));
          initialView=explorerViewReducer(initialView,{type:'EXPAND_RESOURCE',level:'PACKAGE',id:ancestor.id,ownerId:owner?.id??null,childPositions,generation:initialView.generation});
        }
        initialView=explorerViewReducer(initialView,{type:'INSPECT_NODE',id:n.id});
      }
    }
    journeys.reset(initialView);
    historyReplace(id);
  }
  function historyReplace(id:string){const url=new URL(location.href);url.search='';url.searchParams.set('snapshotId',id);window.history.replaceState(null,'',url);}
  async function analyze(input=path) {
    if(!input.trim()){setError('Enter a repository path accessible to the local server.');return;}
    setBusy(true);setError('');try{setStatus('Registering project…');const ws=await apiClient.createWorkspace(input.trim());setStatus('Analyzing Java source…');let job=await apiClient.triggerAnalysis(ws.id);while(!['COMPLETED','FAILED','CANCELLED'].includes(job.status)){await new Promise(r=>setTimeout(r,500));job=await apiClient.getJob(job.id);}if(job.status!=='COMPLETED')throw new Error(job.errorMessage||`Analysis ${job.status.toLowerCase()}`);const current=await apiClient.getWorkspace(ws.id);if(!current.activeSnapshotId)throw new Error('Analysis did not publish a snapshot');await loadSnapshot(current.activeSnapshotId,current);setRecent(await apiClient.listWorkspaces());}catch(e:any){setError(e.message);setStatus('Analysis could not finish');}finally{setBusy(false);}
  }
  useEffect(()=>{
    apiClient.listWorkspaces().then(setRecent).catch(e=>setError(e.message));
    if(params.get('snapshotId')){setBusy(true);loadSnapshot(params.get('snapshotId')!).catch(e=>setError(e.message)).finally(()=>setBusy(false));}
    else if(params.get('autoPath'))analyze(params.get('autoPath')!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
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
    apiClient.getGraph(snapshot).then(data=>{if(alive)setMapGraph(previous=>JSON.stringify(previous)===JSON.stringify(data)?previous:data);}).catch(()=>{});
    return()=>{alive=false;};
  },[snapshot,revision,queue?.completed,queue?.failed,queue?.synthesisStatus]);
  // A failed Changes/Recompare capture (P3.2) otherwise only shows inside the closed review-options
  // popover, which looks like nothing happened. Surface it through the app's existing dismissable
  // error banner too, without touching the popover's own display of the same message. load() always
  // clears reviewComparison.error to '' before a new attempt, so a second failure with the identical
  // message still transitions '' -> message and re-fires this effect.
  useEffect(()=>{
    if(reviewComparison.error)setError(reviewComparison.error);
  },[reviewComparison.error]);
  // One update, so the whole gesture is a selection change and stays outside undo history (ADR 0009).
  // With nothing selected it is a no-op: a pane-only switch would be recorded as an undo entry, and
  // the canvas that invites the empty tap is visible only in the map pane on narrow layouts (desktop
  // ignores mobilePane).
  function clearSelection(){
    cancelReclick();
    journeys.update(j=>{
      if(!j.view.inspectedSubjectId&&!j.multiIds.length)return j;
      const view=explorerViewReducer(j.view,{type:'CLEAR_INSPECTION'});
      return {...j,view,multiIds:j.multiIds.length?[]:j.multiIds,mobilePane:'map'};
    });
  }
  // Undo/redo prune selection against the graph each restored journey actually renders.
  function undoRedo(type:'UNDO'|'REDO'){
    expandQueueRef.current=null;
    // A Changes journey without its comparison graph falls back to the view's own displayed record.
    journeys.command({type,graphFor:j=>j.review?reviewComparison.graph:mapGraph});
  }
  // Latest ref so the listener effect below can mount its window listeners exactly once (they used
  // to rebind on every render) while still reading current values.
  const latest=useRef({settings,source,active,journeys,clearSelection,undoRedo,setSearch,tab});
  latest.current={settings,source,active,journeys,clearSelection,undoRedo,setSearch,tab};
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      const {settings,source,active,journeys,clearSelection,undoRedo,setSearch}=latest.current;
      // e.target is occasionally `document` itself (no element focused when the key was dispatched,
      // seen from synthetic/CDP-driven keydown events), which has no `.closest` -- guard defensively
      // rather than assume every keydown target is a real Element.
      const target=e.target as Element|null;
      const editing=!!target?.closest?.('input,textarea,select,[contenteditable="true"]');
      if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();document.getElementById(searchId)?.focus();return;}
      if(settings||(!source&&document.querySelector('dialog[open]')))return;
      if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){
        if(editing)return; // native text-field undo/redo owns the field
        e.preventDefault();undoRedo(e.key.toLowerCase()==='y'||e.shiftKey?'REDO':'UNDO');
      }else if(e.key==='Escape'&&!source){
        // Escape is layered: an active relation stack (either direction) ends first; the next Escape clears selection.
        if(active.present.relationStack){journeys.update(j=>({...j,relationStack:null}));return;}
        if(active.present.fullscreen&&!active.present.view.inspectedSubjectId&&!active.present.multiIds.length)journeys.setTransient('fullscreen',false);
        clearSelection();setSearch('');
      }
    };
    window.addEventListener('keydown',key);
    // Save a settled camera before any subsequent click, tab switch or level change.
    window.addEventListener('pointerdown',flushExplorerCamera,true);
    window.addEventListener('keydown',flushExplorerCamera,true);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('pointerdown',flushExplorerCamera,true);window.removeEventListener('keydown',flushExplorerCamera,true);};
  },[searchId]);
  // `open` with every package folder down to `n` opened; `open` itself when nothing changes.
  function revealedTree(open:Record<string,boolean>,n:AtlasNode){
    const pkg=graph&&ownerAt(n,'PACKAGE',new Map(graph.nodes.map(n=>[n.id,n])));
    if(!pkg)return open;
    const parts=(pkg.qualifiedName||pkg.simpleName).split('.'),keys=parts.map((_,i)=>parts.slice(0,i+1).join('.'));
    return keys.every(k=>open[k])?open:{...open,...Object.fromEntries(keys.map(k=>[k,true]))};
  }
  // A click on an already-inspected node deselects -- but Cytoscape fires this same `tap` handler
  // for the second click of a double-click too, immediately before `dbltap`. Deselecting immediately
  // would flash the map away and back and reset mobilePane. Delay the deselect briefly so
  // `onArrangeAroundResource` below can cancel it when a double-click is actually in progress.
  const reclickTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  // Any other selection gesture or a tab switch supersedes a pending re-click deselect, which would
  // otherwise clear whatever is selected 250 ms later.
  function cancelReclick(){if(reclickTimer.current){clearTimeout(reclickTimer.current);reclickTimer.current=null;}}
  useEffect(()=>cancelReclick,[active.id]);
  // Inspecting, with its tree reveal, search reset and details pane, is one selection update and so
  // never an undo step (ADR 0009). Whatever real edit the same UI action makes is recorded on its own.
  function select(n:AtlasNode){
    if(viewState.inspectedKind==='NODE'&&viewState.inspectedSubjectId===n.id){
      cancelReclick();
      reclickTimer.current=setTimeout(()=>{reclickTimer.current=null;clearSelection();},250);
      return;
    }
    inspectNode(n,'details');
  }
  function inspectNode(n:AtlasNode,pane:string,group?:number){
    cancelReclick();
    journeys.update(j=>({...j,view:explorerViewReducer(j.view,{type:'INSPECT_NODE',id:n.id}),treeOpen:revealedTree(j.treeOpen,n),search:'',mobilePane:pane}),group);
  }
  function inspectEdge(e:AtlasEdge){
    cancelReclick();
    if(viewState.inspectedKind==='EDGE'&&viewState.inspectedSubjectId===e.id){clearSelection();return;}
    journeys.update(j=>({...j,view:explorerViewReducer(j.view,{type:'INSPECT_EDGE',id:e.id}),mobilePane:'details'}));
  }
  // "View classes"/"View methods" (the tree's ⌖ button, the inspector's buttons) used to switch
  // the whole map to a different abstraction level (Step 4, Story 6/H3). Class/Method level view
  // is gone; digging in now always happens by expanding the card itself in place, so these ensure
  // the target is expanded (never collapse an already-expanded one, hidden included: the queue skips
  // any card already in `expansions`) and select it. A target inside collapsed cards opens its
  // containers first (graphModel.revealContainers: the package, then a member's own type -- never a
  // nested type's outer class), through the expand queue; the tab switch and every expansion are one
  // undo step.
  function revealChildren(n:AtlasNode){
    if(!graph)return;
    const chain=[...revealContainers(n,new Map(graph.nodes.map(item=>[item.id,item]))).map(c=>c.id),n.id];
    const group=journeys.beginGroup();
    // Same toggle as a click when nothing opens: an already-inspected card deselects (clearSelection shows the map pane).
    if(chain.every(id=>expansions[id])&&viewState.inspectedKind==='NODE'&&viewState.inspectedSubjectId===n.id)select(n);else inspectNode(n,'map',group);
    journeys.update(j=>j.tab==='map'?j:{...j,tab:'map'},group);
    startExpandQueue({pending:chain,action:'expand',strict:true},group);
  }
  function viewClasses(n:AtlasNode){revealChildren(n);}
  function viewMethods(n:AtlasNode){revealChildren(n);}
  // Several expansions cannot be dispatched in one handler: toggleExpand's box math reads the current
  // `expansions`/`geometry`, which are still stale mid-handler. The queue therefore drives one card per
  // render -- dispatch, wait for the expansion to land (the effect below), dispatch the next -- and
  // joins every dispatch to one explicit history group, so the whole queue is a single undo step.
  // `strict` (a reveal) drops the queue when a card cannot be toggled (not drawn, nothing in scope, or
  // the reducer would reject it: toggleExpand checks), so a reveal ends instead of hanging; otherwise
  // that card is skipped.
  // A dropped queue never resumes: `inFlight` must reach its target state on the very next change.
  interface ExpandQueue{pending:string[];inFlight:string|null;action:'expand'|'collapse';strict:boolean;group:number;then?:(group:number)=>void;onDrop?:()=>void}
  const expandQueueRef=useRef<ExpandQueue|null>(null);
  function startExpandQueue(q:Omit<ExpandQueue,'inFlight'|'group'>,group=journeys.beginGroup()){
    const queue={...q,inFlight:null,group};
    expandQueueRef.current=queue;
    advanceExpandQueue(queue);
  }
  function advanceExpandQueue(q:ExpandQueue){
    if(!graph){expandQueueRef.current=null;return;}
    const all=new Map(graph.nodes.map(item=>[item.id,item]));
    while(q.pending.length){
      const [id,...rest]=q.pending;q.pending=rest;
      const n=all.get(id);
      if(n&&!!expansions[id]===(q.action==='expand'))continue;
      if(n&&toggleExpand(n,q.group)){q.inFlight=id;return;}
      if(q.strict){expandQueueRef.current=null;q.onDrop?.();return;}
    }
    expandQueueRef.current=null;
    q.then?.(q.group);
  }
  useEffect(()=>{
    const q=expandQueueRef.current;
    if(!q||!q.inFlight)return;
    if(!!expansions[q.inFlight]!==(q.action==='expand')){expandQueueRef.current=null;if(q.strict)q.onDrop?.();return;}
    q.inFlight=null;
    advanceExpandQueue(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[expansions]);
  // Another tab, journey, snapshot or history step invalidates whatever the queue was working toward.
  useEffect(()=>{expandQueueRef.current=null;},[active.id,graph]);
  useEffect(()=>{if(tab!=='map')expandQueueRef.current=null;},[tab]);
  // Reveal a node buried under expand-in-place containers (an HTTP route handler) by expanding each of
  // them in turn (revealContainers), then inspecting the target -- and, for an entry point, rooting
  // an outgoing relation stack on it (explicitly 'out', whatever stack was shown). Inspecting, never
  // `select`: re-selecting the inspected card deselects.
  // An ancestor that cannot open (not drawn, e.g. beyond the displayed page) still inspects the target.
  function expandToReveal(n:AtlasNode,opts:{stack?:boolean}={}){
    if(!graph)return;
    const chain=revealContainers(n,new Map(graph.nodes.map(item=>[item.id,item]))).map(c=>c.id);
    // The switch to the map joins the queue's group: undoing the reveal also returns to where it began.
    const group=journeys.beginGroup();
    journeys.update(j=>j.tab==='map'&&j.mobilePane==='map'?j:{...j,tab:'map',mobilePane:'map'},group);
    startExpandQueue({pending:chain,action:'expand',strict:true,then:group=>{
      inspectNode(n,'details',group);
      if(opts.stack)journeys.update(j=>j.relationStack?.rootId===n.id&&j.relationStack.direction==='out'?j:{...j,relationStack:{rootId:n.id,direction:'out'}},group);
    },onDrop:()=>inspectNode(n,'details')},group);
  }
  // Step 5 (Appendix B): the dedicated focused-arrangement command, wired to canvas double-click
  // (GraphCanvas's dbltap handler) and the inspector's keyboard/touch-accessible "Arrange around
  // this resource" action -- never to a single click, level navigation, or inspection. Uses exactly
  // the current displayed page (`projected`) and current filter, never the full backend graph, and
  // anchors the focus at its existing stored coordinate so an unchanged camera keeps its screen
  // position fixed (no fit is performed). A no-op when `id` is absent from the currently displayed
  // graph -- matching the inspector button's own disabled condition (H3).
  function arrangeAround(id:string){
    if(!graph)return;
    // Arrangement moves the map's own cards, looking through ungrouped boxes (focusedArrangement.
    // arrangeDisplayed): a visible expanded card takes part as its whole box and carries everything
    // inside it; a freed card arranges on its own.
    const cards:DisplayedCard[]=projected.nodes.map(n=>({id:n.id,containerId:n.containerId??null,expanded:n.expanded,hidden:n.hiddenBox,qualifiedName:n.qualifiedName||n.simpleName,box:boxOf(n),position:geometry.positions[n.id]}));
    const edges:ArrangeEdge[]=projected.edges.filter(e=>e.targetId).map(e=>({sourceId:e.sourceId,targetId:e.targetId!}));
    const moves=arrangeDisplayed(cards,edges,id);
    if(!moves)return;
    dispatchView({type:'ARRANGE_AROUND_RESOURCE',level,positions:moves.positions,childPositions:moves.childPositions,generation:viewState.generation});
  }
  const boxOf=(k:AtlasNode):Box=>geometry.boxes[k.id]||boxOfCard({id:k.id,...cardSizeOf(k),...(geometry.positions[k.id]||{x:0,y:0})});
  // When card `n`'s box changes from `before` to `after` (expand, collapse, resize), cards to its right
  // or below make room (expansionLayout.roomMoves, which looks through an ungrouped box). When it sits inside a container, that container's
  // resulting change makes room around it in turn, up to the map itself. Returns the moves to dispatch
  // together with the change, so one action updates everything at once.
  function makeRoom(n:AtlasNode,before:Box,after:Box):CardMoves{
    const cards:RoomCard[]=projected.nodes.map(k=>({id:k.id,containerId:k.containerId??null,expanded:k.expanded,hidden:k.hiddenBox,box:boxOf(k),position:geometry.positions[k.id],minSize:expansions[k.id]?.minSize??null}));
    return roomMoves(cards,n.id,before,after);
  }
  // Details: expand a package/type card in place into a box of its children laid out from the card's
  // top-left corner, or collapse an expanded one back to a card at the box's top-left corner. Several
  // cards (and cards inside expanded cards) can be expanded at once; neighbors make room either way.
  // The card is resolved as drawn: the tree, inspector and reveal chain pass a graph node, which has
  // no `containerId`. A card that is not drawn is left alone. Returns whether the change lands
  // (checked with the pure reducer, so a queue never waits on a dispatch that changes nothing).
  // `group` joins the dispatch to a sequential expand queue's single undo step.
  function toggleExpand(target:AtlasNode,group?:number):boolean{
    const n=projected.nodes.find(k=>k.id===target.id);
    if(!graph||!n)return false;
    const size=cardSizeOf(n);
    if(expansions[n.id]){
      const before=boxOf(n),after={x1:before.x1,y1:before.y1,x2:before.x1+size.width,y2:before.y1+size.height};
      const action:Extract<ExplorerAction,{type:'COLLAPSE_RESOURCE'}>={type:'COLLAPSE_RESOURCE',level,id:n.id,position:{x:before.x1+size.width/2,y:before.y1+size.height/2},moves:makeRoom(n,before,after),generation:viewState.generation};
      if(explorerViewReducer(viewState,action)===viewState)return false;
      collapse(action,group);
      return true;
    }
    const before=boxOf(n),children=childrenOf(graph,n,scope).map(c=>({id:c.id,...cardSizeOf(c)}));
    // Nothing in scope to show: an empty box would only hide the card.
    if(!children.length)return false;
    const childPositions=layoutChildren({x:before.x1,y:before.y1},children);
    const after=containerBox(children.map(c=>boxOfCard({...c,...childPositions[c.id]})),null)||before;
    const action:ExplorerAction={type:'EXPAND_RESOURCE',level,id:n.id,ownerId:n.containerId??null,childPositions,moves:makeRoom(n,before,after),generation:viewState.generation};
    // The same state the dispatch applies to, so a reveal chain learns now whether to wait for it.
    if(explorerViewReducer(viewState,action)===viewState)return false;
    dispatchView(action,false,group);
    return true;
  }
  // Collapsing takes the cards drawn inside the card off the map, so they leave the multi-selection
  // in the same update (collapseInJourney): one undo entry. Every collapse goes through here: the ⊟
  // square, the card menu's Collapse (through the expand queue, with its group) and Collapse into.
  function collapse(action:Extract<ExplorerAction,{type:'COLLAPSE_RESOURCE'}>,group?:number){journeys.update(j=>collapseInJourney(j,action,projected.nodes),group);}
  // Ungroup (ADR 0011): the box is hidden and its children stay where they are as free cards, one undo
  // entry. The hidden card is no longer on the map, so it leaves the selection in the same update (a
  // stack rooted at it is ended by the journey's own display check).
  function ungroup(n:AtlasNode){
    journeys.update(j=>{
      let view=explorerViewReducer(j.view,{type:'UNGROUP_RESOURCE',level,id:n.id,generation:j.view.generation});
      if(view===j.view)return j;
      if(view.inspectedKind==='NODE'&&view.inspectedSubjectId===n.id)view=explorerViewReducer(view,{type:'CLEAR_INSPECTION'});
      return {...j,view,multiIds:j.multiIds.includes(n.id)?j.multiIds.filter(id=>id!==n.id):j.multiIds};
    });
  }
  // Asked only when a card menu opens, so the container map is built then rather than on every render.
  function hiddenAncestorOf(n:AtlasNode):AtlasNode|null{
    const containerOf=Object.fromEntries(projected.nodes.map(k=>[k.id,k.containerId??null]));
    const id=nearestHiddenAncestor(expansions,containerOf,n.id);
    return id?projected.nodes.find(k=>k.id===id)||null:null;
  }
  // Collapse into X: X comes back as a collapsed card centered on where its children are now. Nothing
  // else moves: the freed cards were placed by the user, so there is no room to make or give back.
  function collapseInto(x:AtlasNode){
    const b=boxOf(x);
    collapse({type:'COLLAPSE_RESOURCE',level,id:x.id,position:{x:(b.x1+b.x2)/2,y:(b.y1+b.y2)/2},generation:viewState.generation});
  }
  // Right-click Expand/Collapse on one card or a whole selection: one queued undo step. Cards already
  // in the requested state are skipped; collapsing drops a target drawn inside another target, since
  // that target's collapse already takes it off the map (collapseTargets: drawn containment, so a
  // nested type beside its outer class in the package box is still collapsed).
  function toggleExpandMany(targets:AtlasNode[],action:'expand'|'collapse'){
    if(!graph)return;
    const ids=targets.map(t=>t.id);
    const queued=action==='collapse'?collapseTargets(ids,Object.fromEntries(projected.nodes.map(k=>[k.id,k.containerId??null]))):ids;
    startExpandQueue({pending:queued,action,strict:false});
  }
  // A finished resize keeps the card's top-left corner and, like expanding, makes room around it.
  function resizeNode(id:string,size:CardSize,position:Point,containerId:string|null){
    const n=projected.nodes.find(k=>k.id===id);
    if(!n)return;
    const after={x1:position.x-size.width/2,y1:position.y-size.height/2,x2:position.x+size.width/2,y2:position.y+size.height/2};
    dispatchView({type:'RESIZE_RESOURCE',level,id,size,position,containerId,moves:makeRoom(n,boxOf(n),after),generation:viewState.generation});
  }
  function resizeContainer(id:string,minSize:CardSize){
    const n=projected.nodes.find(k=>k.id===id);
    if(!n)return;
    const after=containerBox(projected.nodes.filter(k=>k.containerId===id).map(boxOf),minSize);
    dispatchView({type:'RESIZE_CONTAINER',level,id,minSize,moves:after?makeRoom(n,boxOf(n),after):undefined,generation:viewState.generation});
  }
  // Story 6: "Code map" returns to the last map view -- whatever level, scope, and inspection the
  // user had -- rather than resetting to Packages or clearing selection. viewState already
  // preserves all of that regardless of which tab is showing, so this is just a tab switch.
  function openCodeMap(){setTab('map');setMobilePane('map');}
  function handleScopeChange(next:ScopeSelection,explicitClassAddId?:string){
    setScope(next);
    if(graph)journeys.set('multiIds',ids=>ids.filter(id=>{const n=graph.nodes.find(n=>n.id===id);return n&&isNodeInScope(n,next,graph);}));
    if(!graph)return;
    const ids=eligibleFor(level,next);
    // Appendix F3: a scope edit changes eligibility for every level at once, not just the one
    // currently on screen. The two inactive levels must drop now-ineligible survivors immediately
    // too, or a later reconciliation cannot tell "still eligible, never left" apart from "removed
    // then re-added" (Step 4 point 8). Only set membership is needed here, so use the unranked
    // eligible-ID set rather than paying for a rank nobody reads.
    const otherLevels:Partial<Record<Level,string[]>>={};
    for(const lvl of (['PACKAGE','CLASS','METHOD'] as Level[])) if(lvl!==level) otherLevels[lvl]=getEligibleIds(graph,lvl,next);
    // Every expanded card, on any level, learns which of its children are still in scope.
    const all=new Map(graph.nodes.map(n=>[n.id,n]));
    // Scope reconciliation retains eligible cards from the hidden graph in either direction.
    const parkedGraph=active.present.review?mapGraph:reviewComparison.graph;
    const parkedAll=parkedGraph&&new Map(parkedGraph.nodes.map(n=>[n.id,n]));
    const expansionChildren:Record<string,string[]>={};
    for(const lvl of (['PACKAGE','CLASS','METHOD'] as Level[]))for(const id of Object.keys(viewState.levelViews[lvl].expansions)){
      const n=all.get(id),parked=parkedAll?.get(id);
      expansionChildren[id]=[...new Set([...(n?childrenOf(graph,n,next,all).map(c=>c.id):[]),...(parked&&parkedAll?childrenOf(parkedGraph!,parked,next,parkedAll).map(c=>c.id):[])])];
    }
    const parkedByLevel:Partial<Record<Level,string[]>>={};
    if(parkedGraph) for(const lvl of (['PACKAGE','CLASS','METHOD'] as Level[])) parkedByLevel[lvl]=eligibleByLevel(parkedGraph,next,lvl);
    const reviewOnlyByLevel:Partial<Record<Level,string[]>>={};
    if(!active.present.review&&reviewComparison.graph) for(const lvl of (['PACKAGE','CLASS','METHOD'] as Level[])) reviewOnlyByLevel[lvl]=reviewOnly(parkedByLevel[lvl]||[]);
    dispatchView({type:'SCOPE_UPDATED',eligibleIds:ids,explicitClassAddId,batchSize:level==='PACKAGE'?Infinity:BATCH_SIZE,placement:placementFor(ids,next),otherLevels,expansionChildren,preserveReviewOnly:!active.present.review,reviewOnlyIds:reviewOnlyByLevel[level],otherReviewOnlyIds:reviewOnlyByLevel,parkedIds:parkedByLevel[level],otherParkedIds:parkedByLevel});
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
  const levelWord='Packages';
  const scopeCrumb=scope.mode==='ALL'?'Whole system':scopeUnitLabel();
  const scopeEmpty=scope.mode==='CUSTOM'&&scope.selectedPackageIds.size===0&&scope.selectedClassIds.size===0;
  const synthesisElapsed=queue?.synthesisStageStartedAt
    ? Math.max(0,Math.floor((Date.now()-Date.parse(queue.synthesisStageStartedAt))/1000))
    : 0;
  async function explainAll(){if(!workspace||!snapshot)return;try{if(queue?.activeJobId){await apiClient.cancelJob(queue.activeJobId);setStatus('Pending explanation work cancelled');}else{await apiClient.startExplainAll(workspace.id,snapshot,1);setStatus('Synthesizing architecture, then explaining classes and methods');}setQueue(await apiClient.getQueueStatus(workspace.id));}catch(e:any){setError(e.message);}}
  // Building blocks for the Git-review overlay living directly on the Code map (no separate page):
  // a per-tab Changes toggle, a small popover for the base ref/Recompare, and a fresh journey for a
  // new tab that starts in whichever mode the tab it was opened from is currently showing.
  function initialViewFor(review:boolean):ExplorerViewState{
    const source=review?reviewComparison.graph:mapGraph;
    return source?initialViewForGraph(source):initExplorerViewState();
  }
  function buildFreshJourney(review:boolean):Journey{
    return {...newJourney(initialViewFor(review)),review,reviewKey:review?reviewComparison.reviewKey:null,reviewTouched:review};
  }
  const reviewOnly = (ids:string[]) => ids.filter(id=>id.startsWith('review-node:'));
  const eligibleByLevel = (g:AtlasGraph,scope:ScopeSelection,lvl:Level) => rankEligibleIds(g,lvl,getEligibleIds(g,lvl,scope));
  /** Scope-filtered cards from the hidden graph stay parked while the active tab shows the other
   * graph. This includes ordinary IDs that have no comparison row, which are the cards whose
   * geometry would otherwise be pruned on entry to Changes. */
  const parkedIdsFor = (lvl:Level,s:ScopeSelection=scope) => {
    const hidden=active.present.review?mapGraph:reviewComparison.graph;
    return hidden ? eligibleByLevel(hidden,s,lvl) : undefined;
  };

  /** Build placement records from the same derived boxes used by the live canvas. An expanded
   * card's record therefore carries its actual compound dimensions and center, including a stored
   * minimum size, so a newly admitted review card is appended below what the user can see. */
  function placementForJourney(g:AtlasGraph,j:Journey,ids:string[],parkedGraph?:AtlasGraph):Record<string,PlacementDims> {
    return placementForGraphs(g,j.view,j.scope,j.kind,ids,parkedGraph);
  }

  /** Scope-aware expansion children for every cached level. Unknown review containers receive an
   * empty list so recapture/mode changes prune their stale child positions and minimum boxes. */
  function expansionChildrenFor(g:AtlasGraph,j:Journey,parkedGraph?:AtlasGraph):Record<string,string[]> {
    const all=new Map(g.nodes.map(n=>[n.id,n])),parkedAll=parkedGraph&&new Map(parkedGraph.nodes.map(n=>[n.id,n])),out:Record<string,string[]>={};
    for(const lvl of (['PACKAGE','CLASS','METHOD'] as Level[])) for(const id of Object.keys(j.view.levelViews[lvl].expansions)){
      const n=all.get(id),parked=parkedAll?.get(id);
      out[id]=[...new Set([...(n?childrenOf(g,n,j.scope,all).map(c=>c.id):[]),...(parked&&parkedAll?childrenOf(parkedGraph!,parked,j.scope,parkedAll).map(c=>c.id):[])])];
    }
    return out;
  }

  /** Reconcile one journey against the graph it is about to render without replacing its saved
   * geometry. Existing eligible IDs retain their order/positions; only newly admitted IDs are
   * placed by the reducer. In map mode review-only IDs are parked only while they remain eligible
   * in the current comparison, so an ordinary scope edit cannot resurrect an excluded resource. */
  function reconcileJourneyGraph(j:Journey,targetGraph:AtlasGraph,targetIsReview:boolean,reviewGraph?:AtlasGraph):Journey {
    const levels=(['PACKAGE','CLASS','METHOD'] as Level[]);
    const eligible=Object.fromEntries(levels.map(l=>[l,eligibleByLevel(targetGraph,j.scope,l)])) as Record<Level,string[]>;
    const parkedGraph=targetIsReview?mapGraph||undefined:reviewGraph;
    const parkedByLevel:Partial<Record<Level,string[]>>={};
    if(parkedGraph) for(const l of levels) parkedByLevel[l]=eligibleByLevel(parkedGraph,j.scope,l);
    const reviewOnlyByLevel:Partial<Record<Level,string[]>>={};
    if(!targetIsReview&&reviewGraph) for(const l of levels) reviewOnlyByLevel[l]=reviewOnly(parkedByLevel[l]||[]);
    const activeLevel=j.view.activeLevel;
    const view=explorerViewReducer(j.view,{type:'SCOPE_UPDATED',eligibleIds:eligible[activeLevel],batchSize:activeLevel==='PACKAGE'?Infinity:REVIEW_BATCH_SIZE,placement:placementForJourney(targetGraph,j,eligible[activeLevel],parkedGraph),otherLevels:Object.fromEntries(levels.filter(l=>l!==activeLevel).map(l=>[l,eligible[l]])) as Partial<Record<Level,string[]>>,expansionChildren:expansionChildrenFor(targetGraph,j,parkedGraph),preserveReviewOnly:!targetIsReview,reviewOnlyIds:reviewOnlyByLevel[activeLevel],otherReviewOnlyIds:reviewOnlyByLevel,parkedIds:parkedByLevel[activeLevel],otherParkedIds:parkedByLevel});
    return revalidateJourney({ ...j, view },targetGraph,targetIsReview);
  }

  /** Comparison-aware identity cleanup; ordinary recapture keeps ordinary edge/source state. */
  function revalidateJourney(j:Journey,targetGraph:AtlasGraph,targetIsReview:boolean):Journey {
    return revalidateJourneyState(j,targetGraph,targetIsReview);
  }

  function prepareReviewToggle(j:Journey,on:boolean,reviewKey:string|null,reviewGraph?:AtlasGraph):Journey {
    const target=on?reviewGraph:mapGraph;
    const comparison=reviewGraph||reviewComparison.graph||undefined;
    if(!target)return toggleJourneyReview(j,on,reviewKey);
    const next=reconcileJourneyGraph(j,target,on,comparison);
    return toggleJourneyReview(next,on,reviewKey);
  }
  function toggleChanges(){
    const tabId=active.id;
    if(active.present.review){
      // Camera/layout state belongs to the journey, not to the presentation mode. Flush the latest
      // Cytoscape camera before the mode-only update so the round trip cannot lose a pan or zoom that
      // happened after the last React state commit.
      flushExplorerCamera();
      journeys.updateTab(tabId,j=>prepareReviewToggle(j,false,null));
      return;
    }
    if(reviewComparison.graph&&reviewComparison.reviewKey){
      flushExplorerCamera();
      journeys.updateTab(tabId,j=>prepareReviewToggle(j,true,reviewComparison.reviewKey!,reviewComparison.graph!));
      return;
    }
    // No comparison captured yet: load one, then apply the toggle to whichever tab asked for it (it
    // may no longer be the active tab, or may have closed, by the time this resolves).
    reviewComparison.load().then(result=>{
      if(result){
        // The comparison request is asynchronous. Capture the camera immediately before applying
        // the mode flag, rather than relying on the camera value from when the user clicked Changes.
        flushExplorerCamera();
        // The render-time graph lookup has no comparison yet: prune the stack root against this one.
        journeys.updateTab(tabId,j=>prepareReviewToggle(j,true,result.reviewKey,result.graph),j=>j.review?result.graph:mapGraph);
      }
    });
  }
  function recompare(){
    reviewComparison.load().then(result=>{
      if(result){
        // Reconciliation is part of the recapture command itself. The reducer applies it to every
        // open and recently closed tab that ever touched review, so a closed review tab cannot
        // reopen with the old comparison's scope, selection or parked resources.
        const reviewIds=result.graph.nodes.filter(n=>n.id.startsWith('review-node:')).map(n=>n.id);
        journeys.command({type:'REVIEW_RECAPTURED',reviewKey:result.reviewKey,reviewIds,graphFor:j=>j.review?result.graph:mapGraph,reconcile:j=>{
          const target=j.review?result.graph:mapGraph;
          return target?reconcileJourneyGraph(j,target,j.review,result.graph):j;
        }});
      }
    });
  }
  const reviewFilesByPath=useMemo(()=>Object.fromEntries((reviewComparison.review?.files||[]).map((f:any)=>[f.path,{status:f.status,hunks:f.hunks||[],lineCountsAvailable:f.lineCountsAvailable}])),[reviewComparison.review]);
  // SourceDialog's data-loading effect depends on this object by reference (P1.3): App re-renders on
  // every 2s queue poll, journey update, etc., so an inline object literal at the call site below
  // would refetch source and reset the dialog's scroll position on every one of those. Keyed on the
  // review's identity (base/head snapshot IDs) and reviewFilesByPath, not the whole `review` object,
  // so an unrelated review field changing (e.g. loading/error) cannot invalidate this either.
  const reviewDiff=useMemo(()=>{
    if(!active.present.review||!reviewComparison.review)return undefined;
    return {baseSnapshotId:reviewComparison.review.base.snapshotId,headSnapshotId:reviewComparison.review.head.snapshotId,filesByPath:reviewFilesByPath};
  },[active.present.review,reviewComparison.review?.base.snapshotId,reviewComparison.review?.head.snapshotId,reviewFilesByPath]);
  // Map-heading collapse ("swipe up" for more graph room): a per-viewer convenience, not exploration
  // state, so it lives in localStorage rather than journey history.
  const [headingCollapsed,setHeadingCollapsedState]=useState(()=>{try{return localStorage.getItem('mapHeadingCollapsed')==='true';}catch{return false;}});
  const setHeadingCollapsed=(next:boolean)=>{setHeadingCollapsedState(next);try{localStorage.setItem('mapHeadingCollapsed',String(next));}catch{}};
  const justDraggedHeadingRef=useRef(false);
  // Pointer drag on the grip: >24px up collapses, >24px down expands. A drag that never crosses that
  // threshold is treated as a click by toggleHeadingCollapsed below, matching the nav-resize handle's
  // established click-vs-drag pattern (startNavResize/justDraggedNavRef).
  function startHeadingDrag(e:React.PointerEvent<HTMLButtonElement>){
    const handle=e.currentTarget,startY=e.clientY;
    handle.setPointerCapture(e.pointerId);
    let moved=false;
    const onMove=(ev:PointerEvent)=>{
      const dy=ev.clientY-startY;
      if(Math.abs(dy)<24)return;
      moved=true;justDraggedHeadingRef.current=true;
      setHeadingCollapsed(dy<0);
    };
    const finish=()=>{
      if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove',onMove);
      handle.removeEventListener('pointerup',onUp);
      handle.removeEventListener('pointercancel',onUp);
      if(moved)setTimeout(()=>{justDraggedHeadingRef.current=false;},400);
    };
    const onUp=()=>finish();
    handle.addEventListener('pointermove',onMove);
    handle.addEventListener('pointerup',onUp);
    handle.addEventListener('pointercancel',onUp);
  }
  function toggleHeadingCollapsed(){
    if(justDraggedHeadingRef.current){justDraggedHeadingRef.current=false;return;}
    setHeadingCollapsed(!headingCollapsed);
  }
  // Trackpad/wheel swipe over the heading area also collapses/expands, with a short cooldown so one
  // physical gesture (many wheel events) does not flip the state repeatedly.
  const headingWheelCooldown=useRef(0);
  function onHeadingWheel(e:React.WheelEvent){
    // A wheel/trackpad gesture over a form control or the review-options popover inside the heading
    // (base-ref input, relationship select, the popover's own scrollable content) must scroll/adjust
    // that control, not collapse the whole heading out from under it (P3.1).
    if((e.target as Element).closest?.('input,select,textarea,.review-options'))return;
    const now=Date.now();
    if(now-headingWheelCooldown.current<400)return;
    if(e.deltaY>12&&!headingCollapsed){headingWheelCooldown.current=now;setHeadingCollapsed(true);}
    else if(e.deltaY<-12&&headingCollapsed){headingWheelCooldown.current=now;setHeadingCollapsed(false);}
  }
  return <div className="app-container">
    <header className="app-header"><button className="brand" onClick={openCodeMap}><span className="brand-mark">◈</span>Code Atlas</button><button className="workspace-switch" onClick={()=>setShowOpen(!showOpen)}>{workspace?name:'Open project'} <span>⌄</span></button>
      <div className="global-search"><span>⌕</span><input id={searchId} aria-label="Search codebase" placeholder="Find a class, method, or package…" value={search} onChange={e=>setSearch(e.target.value)} disabled={!graph}/><kbd>Ctrl K</kbd>{search&&<div className="search-results">{results.length?results.map(n=><button key={n.id} onClick={()=>{select(n);setTab('map');}}><span>{n.simpleName}<small>{n.qualifiedName}</small></span><span className="tag">{n.kind.toLowerCase()}</span></button>):<p>No matching symbols</p>}</div>}</div>
      <button className="model-status" onClick={()=>setSettings(true)}><span className={`status-dot ${profile?.baseUrl?'configured':''}`}/>{profile?.baseUrl?'Model configured':'Set up model'}</button><button className="icon-button" aria-label="Model settings" onClick={()=>setSettings(true)}>⚙</button>
    </header>
    {queue?.errorMessage&&<div className="error-banner" role="alert"><span>{queue.errorMessage}</span></div>}
    {error&&<div className="error-banner" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error">✕</button></div>}
    {(showOpen||!graph)&&<section className={graph?'open-project-bar':'welcome'}><div><span className="welcome-icon">◈</span><h1>{graph?'Open a project':'Find your way through the code.'}</h1><p>Explore the structure. Follow a dependency. Understand why it exists.</p></div><form onSubmit={e=>{e.preventDefault();analyze();}}><label>Local repository path<input value={path} onChange={e=>setPath(e.target.value)} placeholder="/path/to/your/java-project" disabled={busy}/></label><button className="primary" disabled={busy}>{busy?'Analyzing…':'Analyze project'}</button></form><p className="muted">Source-only analysis. Your repository is read-only; no Gradle builds or application code are executed.</p>{recent.length>0&&<div className="recent-projects"><h3>Recent projects</h3>{recent.map(ws=><button key={ws.id} disabled={busy} onClick={()=>{if(ws.activeSnapshotId){setBusy(true);loadSnapshot(ws.activeSnapshotId,ws).catch(e=>setError(e.message)).finally(()=>setBusy(false));}else{setPath(ws.path);analyze(ws.path);}}}><span>▱ {ws.path.split('/').pop()}<small>{ws.path}</small></span><span>Open ↗</span></button>)}</div>}</section>}
    {graph&&<><div className="journey-bar">
      <div className="journey-tabs" role="tablist" aria-label="Exploration tabs">{journeys.state.tabs.map(t=><div className={`journey-tab ${t.id===active.id?'active':''}`} key={t.id}>
        <button role="tab" id={journeyTabId(t.id)} aria-controls={panelId} aria-selected={t.id===active.id} tabIndex={t.id===active.id?0:-1} onKeyDown={e=>{
          const tabs=journeys.state.tabs,index=tabs.findIndex(x=>x.id===t.id);
          const next=e.key==='ArrowRight'?tabs[(index+1)%tabs.length]:e.key==='ArrowLeft'?tabs[(index+tabs.length-1)%tabs.length]:e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:null;
          if(next){e.preventDefault();journeys.command({type:'SWITCH',id:next.id});document.getElementById(journeyTabId(next.id))?.focus();}
        }} onClick={()=>journeys.command({type:'SWITCH',id:t.id})}>{t.title}{t.present.review&&<span className="tag journey-review-tag">changes</span>}</button>
        <button className="journey-close" aria-label={`Close ${t.title}`} tabIndex={t.id===active.id?0:-1} disabled={journeys.state.tabs.length===1} onClick={()=>{
          const tabs=journeys.state.tabs,index=tabs.findIndex(x=>x.id===t.id);
          const remaining=tabs.filter(x=>x.id!==t.id);
          const focusId=t.id===active.id?remaining[Math.min(index,remaining.length-1)].id:active.id;
          journeys.command({type:'CLOSE',id:t.id});
          document.getElementById(journeyTabId(focusId))?.focus();
        }}>×</button>
      </div>)}</div>
      <div className="journey-actions"><button onClick={()=>journeys.command({type:'NEW',present:buildFreshJourney(active.present.review)})}>+ New tab</button><button onClick={()=>journeys.command({type:'CLONE'})} title="Copy this tab and its undo/redo history">Clone tab</button><button disabled={journeys.state.closed.length===0} onClick={()=>journeys.command({type:'REOPEN'})}>Reopen closed tab</button></div>
      <div className="journey-history" aria-label="Tab history"><button disabled={!viewState.inspectedSubjectId&&!active.present.multiIds.length} onClick={clearSelection} title="Clear inspection and selected cards (Escape)">Clear selection</button><button disabled={!active.past.length} title="Undo last exploration action (Ctrl/Cmd Z). Up to 200 actions per tab." onClick={()=>undoRedo('UNDO')}>↶ Undo</button><button disabled={!active.future.length} title="Redo (Ctrl/Cmd Shift Z or Ctrl Y)" onClick={()=>undoRedo('REDO')}>↷ Redo</button></div>
    </div><nav className="mobile-tabs">{['explorer','map','details'].map(p=><button className={mobilePane===p?'active':''} key={p} onClick={()=>setMobilePane(p)}>{p}</button>)}</nav><main id={panelId} role="tabpanel" aria-labelledby={journeyTabId(active.id)} key={active.id} className={`app-main pane-${mobilePane}`}>
      <aside className="navigation" ref={navRef} style={navWidth!=null?{['--nav-width' as any]:`${navWidth}px`}:undefined}><nav className="workspace-nav"><button className={tab==='map'?'active':''} onClick={openCodeMap}>▦ <span>Code map</span></button><button className={tab==='routes'?'active':''} onClick={()=>{setTab('routes');setMobilePane('map');}}>▷ <span>Entry points</span><small>{routes.length}</small></button><button className={tab==='context'?'active':''} onClick={()=>{setTab('context');setMobilePane('map');}}>▤ <span>Project context</span></button></nav>
        <NavigationPane treeOpen={active.present.treeOpen} onTreeChange={update=>journeys.set('treeOpen',update)} graph={graph} scope={scope} selectedNode={node} search={search} onScopeChange={handleScopeChange} onSelect={select} onViewClasses={viewClasses} onViewMethods={viewMethods}/>
        {recentHistory.length>0&&<div className="recent-symbols"><h3>Recently viewed</h3>{recentHistory.map(h=>{const n=graph.nodes.find(x=>x.id===h.subjectId);return n?<button key={h.subjectId} onClick={()=>select(n)}>◷ {n.simpleName}</button>:null;})}</div>}
        <div className="workspace-summary"><strong>{name}</strong><span>{active.present.review?'Base + changes overlay':`${typeCount} types across ${packages.length} packages`}</span><button className="text-button" disabled={busy} onClick={()=>analyze()}>↻ Re-analyze source</button></div>
      </aside>
      <div className="nav-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize navigation panel. Use arrow keys, hold Shift for larger steps, Home to reset." tabIndex={0} aria-valuenow={Math.round(navWidth??currentNavWidth())} aria-valuemin={NAV_MIN} aria-valuemax={Math.round(navMax())} onPointerDown={startNavResize} onKeyDown={navResizeKeyDown} onDoubleClick={()=>{if(justDraggedNavRef.current){justDraggedNavRef.current=false;return;}resetNavWidth();}} />
      <section className="workspace-content">
        {tab==='context'&&workspace?<ProjectDocuments key={workspace.id} workspaceId={workspace.id} onChanged={()=>setRevision(r=>r+1)}/>:tab==='routes'?<section className="entry-view"><div className="page-heading"><div><h1>Start with a request</h1><p>Follow an HTTP entry point into its handler and dependencies.</p></div></div>{routes.length?routes.map(r=>{const handler=graph.nodes.find(n=>n.id===r.symbol_version_id);
          // Explore reveals the handler on the Code map and roots its outgoing stack there. A handler
          // outside the current scope has no card to reveal, so the row says so instead.
          const outside=!!handler&&!isNodeInScope(handler,scope,graph);
          return <button className="route-card" key={r.id} disabled={!handler||outside} title={outside?'Handler is outside the current scope':!handler?'Handler not found in this snapshot':'Show the handler and its outgoing stack on the Code map'} onClick={()=>{if(handler)handler.kind==='PACKAGE'?viewClasses(handler):expandToReveal(handler,{stack:true});}}><span className="tag">{r.http_method}</span><strong>{r.path}</strong><span>{handler?.simpleName||r.handler_qualified}</span><span>{!handler?'Handler not found':outside?'Outside scope':'Explore ↗'}</span></button>;}):<div className="empty-state"><h2>No HTTP routes found</h2><p>Explore packages and classes to find this application's entry points.</p><button onClick={openCodeMap}>Open code map</button></div>}</section>:<>
          <div className={`map-heading${headingCollapsed?' collapsed':''}`} onWheel={onHeadingWheel}>
          <div className="map-heading-collapsible" inert={headingCollapsed} aria-hidden={headingCollapsed}><div className="breadcrumbs"><button onClick={openCodeMap}>{scopeCrumb}</button><span>/</span><span className="breadcrumb-level">{levelWord}</span>{node&&<><span>/</span><button onClick={()=>inspectNode(node,'details')}>{node.simpleName}</button></>}</div><div className="page-heading"><div><h1>{node?node.simpleName:'Understand the whole system'}</h1><p>{node?'Follow the relationships around this part of the codebase.':`${typeCount} types across ${packages.length} packages. Choose a starting point.`}</p></div><button onClick={()=>{const entry=viewState.history[viewState.history.length-1];if(entry)dispatchView({type:'NAVIGATE_BACK',eligibleIds:eligibleFor(entry.level),preserveReviewOnly:!active.present.review,reviewOnlyIds:active.present.review?undefined:reviewOnly(parkedIdsFor(entry.level)||[]),parkedIds:parkedIdsFor(entry.level)});}} disabled={!viewState.history.length}>← Back</button></div></div>
          <div className="graph-toolbar"><select aria-label="Relationship kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">All dependencies</option>{[...new Set(graph.edges.map(e=>e.kind))].sort().map(k=><option key={k} value={k}>{k.toLowerCase().replaceAll('_',' ')}</option>)}</select>
            {workspace&&<div className="review-controls"><button className={`review-toggle${active.present.review?' active':''}`} aria-pressed={active.present.review} disabled={reviewComparison.loading} onClick={toggleChanges} title="Show Base + changes: amber changed cards, green added routes, red removed routes">{reviewComparison.loading?'Comparing…':active.present.review?'✓ Changes':'Changes'}</button><details className="review-options"><summary aria-label="Review comparison options">▾</summary><div><label>Base revision<input value={reviewComparison.baseRef} onChange={e=>reviewComparison.setBaseRef(e.target.value)} placeholder="Default merge base, or origin/main"/></label><button className="primary full-width" type="button" disabled={reviewComparison.loading} onClick={recompare}>{reviewComparison.loading?'Comparing…':'Recompare'}</button>{reviewComparison.review&&<p className="muted">Comparing against <code>{reviewComparison.review.base.resolvedRef||reviewComparison.review.base.requestedRef||'merge base'}</code></p>}{reviewComparison.review?.base.warning&&<p className="notice">{reviewComparison.review.base.warning}</p>}{reviewComparison.error&&<p className="notice" role="alert">{reviewComparison.error}</p>}</div></details></div>}
          </div>
          <div className="map-heading-collapsible" inert={headingCollapsed} aria-hidden={headingCollapsed}><div className="scope-banner"><span className="scope-banner-icon" aria-hidden="true">{scope.mode==='ALL'?'◈':'⌖'}</span><div className="scope-banner-text"><strong>{graph?scopeToLabel(graph,scope):''}</strong><span>Showing {levelWord.toLowerCase()} · {scopedCount} {levelWord.toLowerCase()}{scope.mode!=='ALL'?` in ${scopeUnitLabel()}`:''}</span></div><div className="scope-banner-actions">{node&&<span className="tag inspecting-chip">Inspecting {node.simpleName}</span>}{edge&&!node&&<span className="tag inspecting-chip">Inspecting a relationship</span>}{viewState.newlyAddedIds.length>0&&displayedIds.length>viewState.newlyAddedIds.length&&<span className="tag added-below-chip">{viewState.newlyAddedIds.length} added below</span>}{omittedCount>0&&<button className="show-more" onClick={()=>{const ids=eligibleFor(level);dispatchView({type:'SHOW_MORE',eligibleIds:ids,batchSize:BATCH_SIZE,placement:placementFor(ids),preserveReviewOnly:!active.present.review,reviewOnlyIds:active.present.review?undefined:reviewOnly(parkedIdsFor(level)||[]),parkedIds:parkedIdsFor(level)});}}>Showing {visibleCount} of {scopedCount} in scope · show {Math.min(BATCH_SIZE,omittedCount)} more</button>}{scope.mode==='CUSTOM'&&<button className="text-button" onClick={resetScope}>Reset to whole system</button>}</div></div></div>
          <button className="map-heading-grip" type="button" aria-expanded={!headingCollapsed} aria-label={headingCollapsed?'Expand map heading':'Collapse map heading'} onPointerDown={startHeadingDrag} onClick={toggleHeadingCollapsed}/>
          </div>
          {scopeEmpty
            ? <div className="scope-empty-state"><h2>No packages or classes selected</h2><p>Check packages or classes in the left tree to define what the graph shows.</p><button className="primary" onClick={resetScope}>Select all</button></div>
            : <GraphCanvas multiIds={active.present.multiIds} onMultiIdsChange={v=>journeys.set('multiIds',v)} mapOpen={active.present.mapOpen} onMapOpenChange={v=>journeys.setTransient('mapOpen',v)} fullscreen={active.present.fullscreen} onFullscreenChange={v=>journeys.setTransient('fullscreen',v)} onClearSelection={clearSelection} nodes={projected.nodes} edges={projected.edges} positions={geometry.positions} sizes={sizes} containerSizes={containerSizes} onToggleExpand={toggleExpand} onToggleExpandMany={toggleExpandMany} onUngroup={ungroup} hiddenAncestorOf={hiddenAncestorOf} onCollapseInto={collapseInto} outgoingStack={stack} stackRoot={stack&&relationStack?relationStack:null} onCycleStack={cycleStack} onToggleStack={toggleStack} onResizeNode={resizeNode} onResizeContainer={resizeContainer} camera={levelGeometry.camera} selectedId={node?.id||edge?.id} onNodeSelect={select} onEdgeSelect={inspectEdge} canRemoveFromScope={n=>isNodeInScope(n,scope,graph)} onRemoveFromScope={removeFromScope} scopeRemovalTargets={nodes=>planScopeRemoval(nodes).removed} onCameraChange={handleCameraChange} onNodeMoved={handleNodeMoved} onNodesMoved={handleNodesMoved} onArrangeAroundResource={id=>{
              cancelReclick();
              arrangeAround(id);
              setMobilePane('details');
            }} onViewCode={n=>openSource(n,'symbol')} restoreVersion={active.restoreVersion}/>}
          {!active.present.review&&<div className="graph-legend"><span><i className="line-sample"/>Static dependency</span><span>Hover a line for its kinds and resolution</span></div>}
        </>}
      </section>
      {tab!=='context'&&<InspectorPanel selectedNode={node} selectedEdge={edge} mapStatus={mapStatus} edgeFilteredOut={edgeFilteredOut} edgeHiddenByExpansion={edgeHiddenByExpansion} selectedOccurrenceId={viewState.inspectedOccurrenceId} onSelectOccurrence={id=>dispatchView({type:'SELECT_OCCURRENCE',occurrenceId:id})} workspaceId={workspace?.id||null} snapshotId={snapshot} graph={graph} routes={routes} revision={revision} onExplanationReady={()=>setRevision(r=>r+1)} onInspectEdge={inspectEdge} onSelect={select} onViewClasses={viewClasses} onViewMethods={viewMethods} onArrangeAroundResource={n=>arrangeAround(n.id)} onSource={(n,type='symbol')=>openSource(n,type)} onClose={clearSelection} outgoingStackSummary={stack&&node&&node.id===stackRootId?stackSummary(stack,stackDirection):null} stackDirection={stackDirection}/>}
    </main></>}
    <footer className="app-footer">{graph?.metadata?.diagnostics?.warnings?.length>0&&<details className="analysis-warnings"><summary>{graph?.metadata?.diagnostics?.warnings.length} analysis warning(s)</summary><div>{graph?.metadata?.diagnostics?.warnings.map((w:string,i:number)=><p key={i}>{w}</p>)}</div></details>}<span><i className={`status-dot ${graph?'configured':''}`}/>{status}</span>{graph&&<span>{graph.metadata?.unresolvedCount||0} unresolved external targets</span>}{unanalyzedFiles.length>0&&<span className="unanalyzed-files" title={`These files could not be parsed, so the types they declare are missing from the map:\n${unanalyzedFiles.join('\n')}`}>{unanalyzedFiles.length} file(s) not analyzed</span>}<div className="queue-summary">{queue?.activeJobId&&queue.synthesisStatus!=='READY'&&<span className="synthesis-progress"><i aria-hidden="true"/>{queue.synthesisStage || 'Preparing architecture'} · {synthesisElapsed}s · {queue.synthesisCompleted || 0} validated</span>}{!queue?.activeJobId&&queue?.jobStatus==='CANCELLED'&&<span>Explain all cancelled</span>}{queue&&<span>{queue.completed} explained · {queue.pending+queue.inProgress} queued · {queue.failed} failed</span>}{snapshot&&<button className={queue?.activeJobId?'':'primary'} onClick={explainAll}>{queue?.activeJobId?'Stop explain all':'✧ Explain all'}</button>}</div></footer>
    <SettingsScreen isOpen={settings} onClose={()=>setSettings(false)}/>
    {source&&(source.snapshotId||snapshot)&&<SourceDialog snapshot={source.snapshotId||snapshot!} subject={source.node} type={source.type} snapshotLabel={source.label||'analyzed snapshot'} historical={!!source.snapshotId} reviewDiff={reviewDiff} onClose={()=>setSource(null)}/>}
  </div>;
}
