import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { AtlasNode, AtlasEdge } from './graphModel';
import { nodeCard } from './nodeCard';
import GeminiBadge from '../../components/GeminiBadge';

export interface Point { x: number; y: number }
export interface Camera { zoom: number; pan: Point }

interface Props {
  nodes: AtlasNode[]; edges: AtlasEdge[];
  /** Card-center model coordinates for the currently displayed set, owned by explorerViewState. A
   * missing entry (should not normally happen once App always supplies `placement`) falls back to
   * the origin rather than crashing. */
  positions: Record<string, Point>;
  /** The active level's saved camera, or null before its first capture. Reference-identity change
   * is the signal to restore (non-null) or perform the one-time initial fit (null); an in-place
   * addition/filter/inspection change never replaces this object, so it never fires spuriously. */
  camera: Camera | null;
  selectedId?: string; onNodeSelect: (node: AtlasNode) => void; onEdgeSelect: (edge: AtlasEdge) => void;
  canRemoveFromScope: (node: AtlasNode) => boolean; onRemoveFromScope: (node: AtlasNode) => void;
  /** A manual drag completed for this card. */
  onNodeMoved: (id: string, position: Point) => void;
  /** The canvas settled on a new pan/zoom (debounced real movement, or the one-time initial fit). */
  onCameraChange: (camera: Camera) => void;
  /** Step 5 (Appendix B): the dedicated focused-arrangement command, distinct from inspection and
   * level navigation. Invoked only by a real double-click (`dbltap`, below) -- never by single tap. */
  onArrangeAroundResource: (id: string) => void;
}

/**
 * Step 3: the canvas is created exactly once per mount and never destroyed/recreated on a
 * membership, filter, selection, or resize change (it previously recreated on every `topology`
 * change -- see docs/STABLE_GRAPH_IMPLEMENTATION.md Step 1). Elements are reconciled by stable ID
 * in one batch each render: remove absent edges, remove absent nodes, add new nodes at their given
 * position, add new edges, refresh survivor display data. Survivor positions are never rewritten
 * by this reconciliation -- only `cy.add()` for a brand-new element sets a position, and a manual
 * drag (`dragfree`) is the only other writer, via `onNodeMoved`. `cy.layout()` is never called;
 * `cy.fit()` is called only once per level (when `camera` is null) and by the explicit Fit map
 * button -- both are real camera changes the product allows.
 */
export default function GraphCanvas({ nodes, edges, positions, camera, selectedId, onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onCameraChange, onArrangeAroundResource }: Props) {
  const container = useRef<HTMLDivElement>(null), cyRef = useRef<cytoscape.Core | null>(null), menuRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onCameraChange, onArrangeAroundResource });
  callbacks.current = { onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onCameraChange, onArrangeAroundResource };
  const [mini, setMini] = useState<{ nodes: { id: string; x: number; y: number }[]; box: { x1: number; y1: number; w: number; h: number }; viewport: { x1: number; y1: number; w: number; h: number }; zoom: number } | null>(null);
  const [hover,setHover]=useState<{title:string;description:string;x:number;y:number;ready:boolean}|null>(null);
  const [contextMenu,setContextMenu]=useState<{node:AtlasNode;x:number;y:number}|null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const model = useMemo(() => ({nodes, edges}), [nodes, edges]);
  const currentModel=useRef(model); currentModel.current=model;
  const updateMapRef = useRef<() => void>(() => {});
  const elementsKey=useMemo(()=>JSON.stringify([nodes.map(n=>n.id),edges.map(e=>e.id)]),[nodes,edges]);
  const edgeLabel=(e:AtlasEdge)=>(e.explanationStatus==='READY'?'✦ ':'')+e.kind.toLowerCase().replaceAll('_',' ')+(e.occurrenceCount!>1?` · ${e.occurrenceCount} sites`:'');
  const nodeStyleData=(n:AtlasNode)=>{const card=nodeCard(n);return {...n,card:card.image,cardWidth:card.width,cardHeight:card.height,label:n.simpleName+'\n'+(n.roles?.[0]?.toLowerCase().replaceAll('_',' ')||n.kind.toLowerCase()),color:n.kind==='PACKAGE'?'#6c79b6':n.roles?.includes('SERVICE')?'#16888a':n.roles?.includes('REPOSITORY')?'#6287c8':'#8293a8'};};

  // Create the Cytoscape core exactly once. No elements, no layout: elements and geometry arrive
  // through the reconciliation effect below, using positions this component never invents itself.
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({ container: container.current, minZoom: .12, maxZoom: 2, wheelSensitivity: .2,
      elements: [],
      style: [
        { selector: 'node', style: { shape: 'round-rectangle', width: 'data(cardWidth)', height: 'data(cardHeight)', 'background-image': 'data(card)', 'background-fit': 'contain', 'background-color': '#ffffff', 'border-width': 1.4, 'border-color': 'data(color)', label: '', color: '#1b304b', 'font-family': 'Segoe UI, sans-serif', 'font-size': 14, 'font-weight': 500, 'text-wrap': 'wrap', 'text-max-width': '198px', 'text-valign': 'center', 'text-halign': 'center', 'line-height': 1.7, 'overlay-opacity': 0 } },
        { selector: 'node[kind = "PACKAGE"]', style: { 'background-color': '#ffffff', 'font-size': 14 } },
        { selector: 'node:selected', style: { 'background-color': '#e0f4f3', 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'node.neighbor', style: { 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'edge', style: { width: 1.4, 'line-color': '#a0aebd', 'target-arrow-color': '#8395a9', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 11, color: '#5b6d83', 'text-opacity': .85, 'text-background-color': '#f7f9fc', 'text-background-opacity': 1, 'text-background-padding': '4px', 'text-rotation': 'autorotate', 'arrow-scale': .8 } },
        { selector: 'edge[resolution != "RESOLVED"]', style: { 'line-color': '#ba862d', 'target-arrow-color': '#ba862d', 'line-style': 'dashed' } },
        { selector: 'edge[explanationStatus = "READY"]', style: { color: '#7955b7', 'text-background-color': '#f3eeff', 'text-opacity': 1 } },
        { selector: 'edge:selected', style: { width: 2.5, 'line-color': '#07888c', 'target-arrow-color': '#07888c', color: '#08777b' } },
        { selector: 'edge.incident', style: { width: 2.5 } },
        { selector: '.muted', style: { opacity: .6 } },
      ] });
    cyRef.current = cy;
    // A truly empty core has no boundingBox (would feed Infinity into the SVG viewBox), so the
    // minimap stays unset (mini === null, already guarded at render) until the reconciliation
    // effect below adds the first elements and calls this via updateMapRef.
    const updateMap = () => {
      if (!cy.nodes().length) return;
      const b = cy.elements().boundingBox(); const v = cy.extent();
      setMini({nodes: cy.nodes().map(n => ({ id: n.id(), x: n.position('x'), y: n.position('y') })), box: {x1: b.x1 - 30, y1: b.y1 - 30, w: Math.max(280, b.w + 60), h: Math.max(160, b.h + 60)}, viewport: v, zoom: cy.zoom()});
    };
    updateMapRef.current = updateMap;
    // Real user camera movement (pan, zoom, drag) is captured, debounced, and reported once it
    // settles. `programmatic` suppresses capture while this component itself writes pan/zoom
    // (restoring a saved camera, or the one-time initial fit) so a restore round trip can never
    // be mistaken for a fresh user gesture.
    let programmatic = false;
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    cy.on('pan zoom position', updateMap);
    cy.on('pan zoom', () => {
      if (programmatic) return;
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        debounceHandle = null;
        callbacks.current.onCameraChange({ zoom: cy.zoom(), pan: { x: cy.pan().x, y: cy.pan().y } });
      }, 180);
    });
    (cy as any).__setProgrammaticCamera = (fn: () => void) => { programmatic = true; try { fn(); } finally { setTimeout(() => { programmatic = false; }, 0); } };
    cy.on('tap', 'node', e => callbacks.current.onNodeSelect(currentModel.current.nodes.find(n => n.id === e.target.id())!));
    // Step 4 disconnected double-click from level navigation (that was explore(), a leftover from
    // before View methods/View classes existed as named commands). Step 5 (Appendix B) gives it its
    // own dedicated ARRANGE_AROUND_RESOURCE command via Cytoscape's own `dbltap` gesture recognition
    // (H4): the first tap still reaches `onNodeSelect` above (inspection is idempotent, so a repeat
    // inspect of the same subject is a no-op) and cannot itself move or unmount anything; `dbltap`
    // fires in addition, once, on the second tap.
    cy.on('dbltap', 'node', e => callbacks.current.onArrangeAroundResource(e.target.id()));
    cy.on('dragfree', 'node', e => { const p = e.target.position(); callbacks.current.onNodeMoved(e.target.id(), { x: p.x, y: p.y }); });
    cy.on('cxttap', 'node', e => {
      (e.originalEvent as Event | undefined)?.preventDefault();
      const node=currentModel.current.nodes.find(n=>n.id===e.target.id());
      if(!node||!callbacks.current.canRemoveFromScope(node)){setContextMenu(null);return;}
      const position=e.renderedPosition || e.target.renderedPosition();
      setHover(null);
      setContextMenu({node,x:Math.max(8,Math.min(position.x,cy.width()-178)),y:Math.max(8,Math.min(position.y,cy.height()-54))});
    });
    cy.on('mouseover', 'edge', e => {
      const edge = currentModel.current.edges.find(n=>n.id===e.target.id()); if(!edge)return;
      const a=currentModel.current.nodes.find(n=>n.id===edge.sourceId),b=currentModel.current.nodes.find(n=>n.id===edge.targetId);
      const position=e.renderedPosition || e.target.renderedMidpoint();
      setHover({ready:edge.explanationStatus==='READY',title:`${a?.simpleName} → ${b?.simpleName}`,description:`${edge.kind.toLowerCase().replaceAll('_',' ')} · ${edge.occurrenceCount||1} source occurrence(s) · ${edge.resolution.toLowerCase()}. Click to inspect evidence.`,x:Math.max(12,Math.min(position.x,cy.width()-280)),y:Math.max(12,position.y-100)});
    });
    cy.on('mouseout pan zoom tap',()=>setHover(null));
    cy.on('pan zoom tap',()=>setContextMenu(null));
    cy.on('tap', 'edge', e => callbacks.current.onEdgeSelect(currentModel.current.edges.find(n => n.id === e.target.id())!));
    const canvas=container.current;
    const preventContextMenu=(event:MouseEvent)=>event.preventDefault();
    canvas.addEventListener('contextmenu',preventContextMenu);
    // Resize keeps the renderer's own dimensions in sync but never re-fits: a pane resize (narrow
    // screen swap, sidebar toggle) must not move the camera the user set. Skip on a transient
    // zero-size container so cy.resize() cannot corrupt pan/zoom.
    const observer = new ResizeObserver(() => { if (!container.current?.clientWidth || !container.current?.clientHeight) return; cy.resize(); updateMap(); }); observer.observe(canvas);
    return () => { canvas.removeEventListener('contextmenu',preventContextMenu); observer.disconnect(); if (debounceHandle) clearTimeout(debounceHandle); cy.destroy(); cyRef.current = null; };
  }, []);

  useEffect(()=>{setContextMenu(null);},[elementsKey]);
  useEffect(()=>{
    if(!contextMenu)return;
    const dismiss=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setContextMenu(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setContextMenu(null);};
    window.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',escape);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>{window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',escape);};
  },[contextMenu]);

  // Incremental reconciliation: remove absent edges, remove absent nodes, add new nodes at their
  // given position, add new edges, refresh every current element's display data. A survivor's
  // position is never touched here -- only cy.add() for a brand-new element sets one. Endpoint
  // changes are unreachable for an aggregate edge: its ID is `aggregate:[source,target,kind,
  // resolution]` (graphModel.ts), so a different endpoint is necessarily a different ID -- handled
  // by ordinary remove+add, never a "move" path.
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    // A survivor's stored position only ever changes via a manual drag (already reflected live in
    // Cytoscape by the drag itself, so `cur` already equals `pos` here -- no-op) or a Step 5
    // ARRANGE_AROUND_RESOURCE dispatch (which does NOT touch Cytoscape directly, so `cur` genuinely
    // differs from `pos` until this reconciliation applies it). This is therefore the one place an
    // already-added element's position is ever rewritten -- ordinary membership admission still
    // only sets a position via `cy.add()` for a brand-new element, exactly as before Step 5.
    let arranged = false;
    cy.batch(() => {
      const nodeIds = new Set(nodes.map(n => n.id));
      const edgeIds = new Set(edges.map(e => e.id));
      cy.edges().forEach(e => { if (!edgeIds.has(e.id())) e.remove(); });
      cy.nodes().forEach(n => { if (!nodeIds.has(n.id())) n.remove(); });
      for (const n of nodes) {
        const data = nodeStyleData(n);
        const pos = positions[n.id] || { x: 0, y: 0 };
        const existing = cy.getElementById(n.id);
        if (existing.length) {
          existing.data(data);
          const cur = existing.position();
          if (cur.x !== pos.x || cur.y !== pos.y) { existing.position(pos); arranged = true; }
        } else {
          cy.add({ data, position: pos });
        }
      }
      for (const e of edges) {
        const data = { ...e, source: e.sourceId, target: e.targetId!, label: edgeLabel(e) };
        const existing = cy.getElementById(e.id);
        if (existing.length) existing.data(data);
        else cy.add({ data });
      }
    });
    // A custom Cytoscape event (not a debug object -- ordinary use of the library's own pub/sub,
    // the same mechanism 'pan'/'zoom'/'dbltap' already use) so a test can observe that exactly one
    // arrangement was actually applied to the canvas, distinct from a drag or an ordinary admission.
    if (arranged) cy.emit('arranged');
    // cy.add() does not emit 'position', so a membership change (Show more, a package add/remove)
    // would otherwise leave the minimap showing a stale bounding box until the user's next pan/zoom.
    updateMapRef.current();
  }, [nodes, edges, positions]);

  // Selection/inspection emphasis only: never a layout or fit call. Selected card gets a stronger
  // outline (node:selected style); its visible incident edges get thicker strokes (.incident) and
  // direct neighbors get stronger outlines (.neighbor); everything else outside the closed
  // neighborhood is gently dimmed (.muted). Hidden edges contribute no neighbors because they were
  // never added to cy in the first place (filtered out by the caller before this component sees them).
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.elements().unselect().removeClass('muted neighbor incident');
    if (selectedId) {
      const selected = cy.getElementById(selectedId);
      if (selected.length) {
        selected.select();
        const neighborhood = selected.closedNeighborhood();
        cy.elements().difference(neighborhood).addClass('muted');
        neighborhood.nodes().difference(selected).addClass('neighbor');
        neighborhood.edges().addClass('incident');
      }
    }
  }, [selectedId, nodes, edges]);

  // Camera: restore a saved camera, or perform the one-time initial fit when a level has never had
  // one. Reference-identity change on `camera` is the only trigger -- an in-place membership/filter
  // change never replaces this object (explorerViewState preserves it verbatim), so this effect is
  // silent for every ordinary interaction, matching the interaction contract's camera-preserved rows.
  // hasNodes is a required trigger, not a cosmetic addition (Step 5 review remediation A3): a level
  // first visited with zero eligible nodes gets camera === null and stays null (nothing in
  // reconcileLevelView sets it when there is nothing to place); if scope is later widened so that
  // level's node count goes 0 -> >0, `camera` itself never changes reference (still the same null),
  // so without `hasNodes` this effect would never re-run and the newly admitted card would never get
  // its initial fit. `hasNodes` makes that 0 -> >0 transition itself a trigger.
  const hasNodes = nodes.length > 0;
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    const setProgrammatic = (cy as any).__setProgrammaticCamera as ((fn: () => void) => void) | undefined;
    if (camera) {
      setProgrammatic?.(() => { cy.viewport({ zoom: camera.zoom, pan: camera.pan }); });
    } else if (hasNodes) {
      setProgrammatic?.(() => {
        cy.fit(undefined, 45);
        if (cy.zoom() > 1) { cy.zoom(1); cy.center(); }
      });
      callbacks.current.onCameraChange({ zoom: cy.zoom(), pan: { x: cy.pan().x, y: cy.pan().y } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, hasNodes]);

  function zoom(factor: number) { const cy = cyRef.current; if (cy) cy.zoom({level: cy.zoom() * factor, renderedPosition: {x: cy.width()/2, y: cy.height()/2}}); }
  function fit() { const cy = cyRef.current; if (cy && nodes.length) { cy.fit(undefined, 55); if (cy.zoom() > 1) { cy.zoom(1); cy.center(); } } }
  return <div className="graph-stage">
    <div ref={container} className="graph-canvas" aria-label="Dependency graph" />
    {!nodes.length && <div className="canvas-empty">No symbols in this view. Choose another level or clear the filter.</div>}
    {hover&&<div className="edge-hover" style={{left:hover.x,top:hover.y}}><strong>{hover.ready&&<GeminiBadge/>} {hover.title}</strong><p>{hover.description}</p></div>}
    {contextMenu&&<div ref={menuRef} className="graph-context-menu" role="menu" aria-label={`Scope actions for ${contextMenu.node.simpleName}`} style={{left:contextMenu.x,top:contextMenu.y}}><button role="menuitem" onClick={()=>{callbacks.current.onRemoveFromScope(contextMenu.node);setContextMenu(null);}}><span aria-hidden="true">−</span> Remove from scope</button></div>}
    <div className="canvas-hint">Arrows point from caller to dependency</div>
    <div className="zoom-controls"><button onClick={() => zoom(1.2)} aria-label="Zoom in">+</button><span>{Math.round((mini?.zoom || 1)*100)}%</span><button onClick={() => zoom(1/1.2)} aria-label="Zoom out">−</button><button onClick={fit}>Fit map</button></div>
    <div className={`minimap ${mapOpen ? '' : 'collapsed'}`}>
      <button className="minimap-title" onClick={() => setMapOpen(!mapOpen)} aria-expanded={mapOpen}>Map overview <span>{mapOpen ? '−' : '+'}</span></button>
      {mapOpen && mini && <svg role="img" aria-label="Map overview with current viewport" viewBox={`${mini.box.x1} ${mini.box.y1} ${mini.box.w} ${mini.box.h}`} preserveAspectRatio="xMidYMid meet" onClick={e => {
        const svg = e.currentTarget, point = svg.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
        const transform = svg.getScreenCTM(); const cy = cyRef.current;
        if (transform && cy) { const p = point.matrixTransform(transform.inverse()); cy.pan({x: cy.width()/2 - p.x*cy.zoom(), y: cy.height()/2 - p.y*cy.zoom()}); }
      }}>
        {edges.map(e => { const a=mini.nodes.find(n=>n.id===e.sourceId),b=mini.nodes.find(n=>n.id===e.targetId); return a&&b?<line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c5d0dd" strokeWidth="4"/>:null; })}
        {mini.nodes.map(n => <rect key={n.id} x={n.x-65} y={n.y-25} width="130" height="50" rx="10" fill={n.id===selectedId?'#0b9193':'#a4b8cd'}/>)}
        <rect x={mini.viewport.x1} y={mini.viewport.y1} width={mini.viewport.w} height={mini.viewport.h} fill="#07888c0c" stroke="#07888c" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      </svg>}
    </div>
  </div>;
}
