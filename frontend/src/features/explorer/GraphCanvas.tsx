import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { AtlasNode, AtlasEdge } from './graphModel';
import { nodeCard } from './nodeCard';
import GeminiBadge from '../../components/GeminiBadge';
import { graphLayout } from './graphLayout';
interface Props { nodes: AtlasNode[]; edges: AtlasEdge[]; selectedId?: string; onNodeSelect: (node: AtlasNode) => void; onEdgeSelect: (edge: AtlasEdge) => void; onExplore: (node: AtlasNode) => void; canRemoveFromScope: (node: AtlasNode) => boolean; onRemoveFromScope: (node: AtlasNode) => void }
export default function GraphCanvas({ nodes, edges, selectedId, onNodeSelect, onEdgeSelect, onExplore, canRemoveFromScope, onRemoveFromScope }: Props) {
  const container = useRef<HTMLDivElement>(null), cyRef = useRef<cytoscape.Core | null>(null), menuRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNodeSelect, onEdgeSelect, onExplore, canRemoveFromScope, onRemoveFromScope }); callbacks.current = { onNodeSelect, onEdgeSelect, onExplore, canRemoveFromScope, onRemoveFromScope };
  const [mini, setMini] = useState<{ nodes: { id: string; x: number; y: number }[]; box: { x1: number; y1: number; w: number; h: number }; viewport: { x1: number; y1: number; w: number; h: number }; zoom: number } | null>(null);
  const [hover,setHover]=useState<{title:string;description:string;x:number;y:number;ready:boolean}|null>(null);
  const [contextMenu,setContextMenu]=useState<{node:AtlasNode;x:number;y:number}|null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const model = useMemo(() => ({nodes, edges}), [nodes, edges]);
  const currentModel=useRef(model); currentModel.current=model;
  const topology=JSON.stringify([nodes.map(n=>[n.id,n.kind]),edges.map(e=>[e.id,e.sourceId,e.targetId])]);
  const edgeLabel=(e:AtlasEdge)=>(e.explanationStatus==='READY'?'✦ ':'')+e.kind.toLowerCase().replaceAll('_',' ')+(e.occurrenceCount!>1?` · ${e.occurrenceCount} sites`:'');
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({ container: container.current, minZoom: .12, maxZoom: 2, wheelSensitivity: .2,
      elements: [...nodes.map(n => ({ data: { ...n, card: nodeCard(n).image, cardWidth: nodeCard(n).width, cardHeight: nodeCard(n).height, label: n.simpleName + '\n' + (n.roles?.[0]?.toLowerCase().replaceAll('_', ' ') || n.kind.toLowerCase()), color: n.kind === 'PACKAGE' ? '#6c79b6' : n.roles?.includes('SERVICE') ? '#16888a' : n.roles?.includes('REPOSITORY') ? '#6287c8' : '#8293a8' } })),
        ...edges.map(e => ({data: {...e, source: e.sourceId, target: e.targetId!, label: edgeLabel(e)}}))],
      style: [
        { selector: 'node', style: { shape: 'round-rectangle', width: 'data(cardWidth)', height: 'data(cardHeight)', 'background-image': 'data(card)', 'background-fit': 'contain', 'background-color': '#ffffff', 'border-width': 1.4, 'border-color': 'data(color)', label: '', color: '#1b304b', 'font-family': 'Segoe UI, sans-serif', 'font-size': 14, 'font-weight': 500, 'text-wrap': 'wrap', 'text-max-width': '198px', 'text-valign': 'center', 'text-halign': 'center', 'line-height': 1.7, 'overlay-opacity': 0 } },
        { selector: 'node[kind = "PACKAGE"]', style: { width: 280, height: 148, 'background-color': '#ffffff', 'font-size': 14 } },
        { selector: 'node:selected', style: { 'background-color': '#e0f4f3', 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'edge', style: { width: 1.4, 'line-color': '#a0aebd', 'target-arrow-color': '#8395a9', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 11, color: '#5b6d83', 'text-opacity': .85, 'text-background-color': '#f7f9fc', 'text-background-opacity': 1, 'text-background-padding': '4px', 'text-rotation': 'autorotate', 'arrow-scale': .8 } },
        { selector: 'edge[resolution != "RESOLVED"]', style: { 'line-color': '#ba862d', 'target-arrow-color': '#ba862d', 'line-style': 'dashed' } },
        { selector: 'edge[explanationStatus = "READY"]', style: { color: '#7955b7', 'text-background-color': '#f3eeff', 'text-opacity': 1 } },
        { selector: 'edge:selected', style: { width: 2.5, 'line-color': '#07888c', 'target-arrow-color': '#07888c', color: '#08777b' } },
        { selector: '.muted', style: { opacity: .6 } },
      ], layout: { name: 'preset', positions: graphLayout(nodes,edges,selectedId), padding: 45, fit: true } as any });
    cyRef.current = cy;
    // A singleton should remain a readable card, not fill the entire canvas.
    if (cy.zoom() > 1) { cy.zoom(1); cy.center(); }
    const updateMap = () => {
      const b = cy.elements().boundingBox(); const v = cy.extent();
      setMini({nodes: cy.nodes().map(n => ({ id: n.id(), x: n.position('x'), y: n.position('y') })), box: {x1: b.x1 - 30, y1: b.y1 - 30, w: Math.max(280, b.w + 60), h: Math.max(160, b.h + 60)}, viewport: v, zoom: cy.zoom()});
    };
    cy.on('pan zoom position', updateMap); updateMap();
    cy.on('tap', 'node', e => callbacks.current.onNodeSelect(currentModel.current.nodes.find(n => n.id === e.target.id())!));
    cy.on('dbltap', 'node', e => callbacks.current.onExplore(currentModel.current.nodes.find(n => n.id === e.target.id())!));
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
    const observer = new ResizeObserver(() => { if (!container.current?.clientWidth || !container.current?.clientHeight) return; cy.resize(); if(nodes.length) { cy.fit(undefined, 45); if(cy.zoom()>1){cy.zoom(1);cy.center();} } updateMap(); }); observer.observe(canvas);
    return () => { canvas.removeEventListener('contextmenu',preventContextMenu);observer.disconnect(); cy.destroy(); cyRef.current = null; };
  }, [topology]);
  useEffect(()=>{setContextMenu(null);},[topology]);
  useEffect(()=>{
    if(!contextMenu)return;
    const dismiss=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setContextMenu(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setContextMenu(null);};
    window.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',escape);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>{window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',escape);};
  },[contextMenu]);
  useEffect(()=>{
    const cy=cyRef.current;if(!cy)return;
    cy.batch(()=>{
      for(const n of nodes){const card=nodeCard(n);cy.getElementById(n.id).data({...n,card:card.image,cardWidth:card.width,cardHeight:card.height});}
      for(const e of edges)cy.getElementById(e.id).data({...e,label:edgeLabel(e)});
    });
  },[model]);
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.elements().unselect().removeClass('muted');
    if (selectedId) { const selected = cy.getElementById(selectedId); selected.select(); if (selected.length) cy.elements().difference(selected.closedNeighborhood()).addClass('muted'); }
    // Reposition (incoming-left/focus-center/outgoing-right) for whatever was just selected,
    // not only selections that happen to also change scope/level (packages, edges).
    cy.layout({ name: 'preset', positions: graphLayout(nodes, edges, selectedId), padding: 45, fit: true } as any).run();
    if (cy.zoom() > 1) { cy.zoom(1); cy.center(); }
  }, [selectedId, topology]);
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
