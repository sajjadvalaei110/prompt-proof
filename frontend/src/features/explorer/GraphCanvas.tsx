import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { AtlasNode, AtlasEdge } from './graphModel';
import { nodeCard, hasCodeButton, CODE_BUTTON } from './nodeCard';
import CodeButton from '../../components/CodeButton';

/** Below this rendered size the quick-code buttons are hidden and the corner is part of the card. */
const MIN_CODE_BUTTON_PX = 14;
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
  canRemoveFromScope: (node: AtlasNode) => boolean;
  /** Removes every given card from scope as one scope edit (a right-click multi-selection or a single card). */
  onRemoveFromScope: (nodes: AtlasNode[]) => void;
  /** What removing these cards takes out of scope. Scope holds packages and classes only, so a method card
   * resolves to its class; the menu names that instead of implying the method alone is removed. */
  scopeRemovalTargets: (nodes: AtlasNode[]) => AtlasNode[];
  /** A manual drag completed for this card. A group drag reports one call per moved card. */
  onNodeMoved: (id: string, position: Point) => void;
  /** The canvas settled on a new pan/zoom (debounced real movement, or the one-time initial fit). */
  onCameraChange: (camera: Camera) => void;
  /** Step 5 (Appendix B): the dedicated focused-arrangement command, distinct from inspection and
   * level navigation. Invoked only by a real double-click (`dbltap`, below) -- never by single tap. */
  onArrangeAroundResource: (id: string) => void;
  /** Quick code: opens the source dialog for a class/method card from its on-card </> button. */
  onViewCode: (node: AtlasNode) => void;
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
export default function GraphCanvas({ nodes, edges, positions, camera, selectedId, onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, scopeRemovalTargets, onNodeMoved, onCameraChange, onArrangeAroundResource, onViewCode }: Props) {
  const container = useRef<HTMLDivElement>(null), cyRef = useRef<cytoscape.Core | null>(null), menuRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onCameraChange, onArrangeAroundResource, onViewCode });
  callbacks.current = { onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onCameraChange, onArrangeAroundResource, onViewCode };
  const [mini, setMini] = useState<{ nodes: { id: string; x: number; y: number; w: number; h: number }[]; box: { x1: number; y1: number; w: number; h: number }; viewport: { x1: number; y1: number; w: number; h: number }; zoom: number } | null>(null);
  const [hover,setHover]=useState<{title:string;description:string;x:number;y:number;ready:boolean}|null>(null);
  // `node` is the card that was right-clicked; null when the menu opened from a marquee.
  const [contextMenu,setContextMenu]=useState<{node:AtlasNode|null;x:number;y:number}|null>(null);
  // The one multi-selection every bulk action works on. Right-click, right-drag marquee,
  // Ctrl/Cmd/Shift+click and Ctrl/Cmd/Shift+drag box selection all feed it. Cytoscape's native
  // selection is disabled (`autounselectify`) so there is never a second, action-less selection;
  // inspection emphasis uses the `.inspected` class instead.
  const [multiIds,setMultiIds]=useState<string[]>([]);
  const multiRef=useRef(multiIds); multiRef.current=multiIds;
  const [fullscreen,setFullscreen]=useState(false);
  // Right-button marquee in rendered (stage) pixels while a right-drag is in progress.
  const [marquee,setMarquee]=useState<{x1:number;y1:number;x2:number;y2:number}|null>(null);
  const cancelMarqueeRef=useRef<()=>void>(()=>{});
  // Screen boxes (stage pixels) for the on-card quick-code buttons, recomputed with the minimap.
  const [codeButtons,setCodeButtons]=useState<{id:string;left:number;top:number;size:number}[]>([]);
  // The card whose quick-code square the pointer is over (the canvas owns the pointer; see codeButtonHit).
  const [hotCodeId,setHotCodeId]=useState<string|null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const model = useMemo(() => ({nodes, edges}), [nodes, edges]);
  const currentModel=useRef(model); currentModel.current=model;
  const updateMapRef = useRef<() => void>(() => {});
  const nodesKey=useMemo(()=>JSON.stringify(nodes.map(n=>n.id)),[nodes]);
  const edgeLabel=(e:AtlasEdge)=>(e.explanationStatus==='READY'?'✦ ':'')+e.kind.toLowerCase().replaceAll('_',' ')+(e.occurrenceCount!>1?` · ${e.occurrenceCount} sites`:'');
  const nodeStyleData=(n:AtlasNode)=>{const card=nodeCard(n);return {...n,card:card.image,cardWidth:card.width,cardHeight:card.height,label:n.simpleName+'\n'+(n.roles?.[0]?.toLowerCase().replaceAll('_',' ')||n.kind.toLowerCase()),color:n.kind==='PACKAGE'?'#6c79b6':n.roles?.includes('SERVICE')?'#16888a':n.roles?.includes('REPOSITORY')?'#6287c8':'#8293a8'};};

  // Create the Cytoscape core exactly once. No elements, no layout: elements and geometry arrive
  // through the reconciliation effect below, using positions this component never invents itself.
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({ container: container.current, minZoom: .12, maxZoom: 2, wheelSensitivity: .2, autounselectify: true,
      elements: [],
      style: [
        // 'box-selection: overlap' makes Cytoscape's Ctrl/Shift+drag box pick any card it touches, the same rule as the right-drag marquee.
        { selector: 'node', style: { 'box-selection': 'overlap', shape: 'round-rectangle', width: 'data(cardWidth)', height: 'data(cardHeight)', 'background-image': 'data(card)', 'background-fit': 'contain', 'background-color': '#ffffff', 'border-width': 1.4, 'border-color': 'data(color)', label: '', color: '#1b304b', 'font-family': 'Segoe UI, sans-serif', 'font-size': 14, 'font-weight': 500, 'text-wrap': 'wrap', 'text-max-width': '198px', 'text-valign': 'center', 'text-halign': 'center', 'line-height': 1.7, 'overlay-opacity': 0 } },
        { selector: 'node[kind = "PACKAGE"]', style: { 'background-color': '#ffffff', 'font-size': 14 } },
        { selector: 'node.inspected', style: { 'background-color': '#e0f4f3', 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'node.neighbor', style: { 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'edge', style: { width: 1.4, 'line-color': '#a0aebd', 'target-arrow-color': '#8395a9', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 11, color: '#5b6d83', 'text-opacity': .85, 'text-background-color': '#f7f9fc', 'text-background-opacity': 1, 'text-background-padding': '4px', 'text-rotation': 'autorotate', 'arrow-scale': .8 } },
        { selector: 'edge[resolution != "RESOLVED"]', style: { 'line-color': '#ba862d', 'target-arrow-color': '#ba862d', 'line-style': 'dashed' } },
        { selector: 'edge[explanationStatus = "READY"]', style: { color: '#7955b7', 'text-background-color': '#f3eeff', 'text-opacity': 1 } },
        { selector: 'edge.inspected', style: { width: 2.5, 'line-color': '#07888c', 'target-arrow-color': '#07888c', color: '#08777b' } },
        { selector: 'edge.incident', style: { width: 2.5 } },
        { selector: '.muted', style: { opacity: .6 } },
        { selector: 'node.multi-selected', style: { 'border-color': '#7955b7', 'border-width': 4, 'overlay-color': '#7955b7', 'overlay-opacity': .1, 'overlay-padding': 8 } },
        { selector: 'node.marquee-candidate', style: { 'border-color': '#7955b7', 'border-width': 3, 'border-style': 'dashed' } },
      ] });
    cyRef.current = cy;
    // A truly empty core has no boundingBox (would feed Infinity into the SVG viewBox), so the
    // minimap stays unset (mini === null, already guarded at render) until the reconciliation
    // effect below adds the first elements and calls this via updateMapRef.
    const updateMap = () => {
      // Each class/method card gets a DOM </> button drawn over the corner nodeCard reserves for it,
      // scaled with the zoom. Hidden while cards are too small to hit, and skipped when off screen.
      // Below that size the previous (already empty) array is kept so pan/zoom frames do not re-render.
      const zoomNow = cy.zoom(), size = CODE_BUTTON.size * zoomNow, w = cy.width(), h = cy.height();
      if (size < MIN_CODE_BUTTON_PX) setCodeButtons(prev => prev.length ? [] : prev);
      else setCodeButtons(cy.nodes().map(n => {
        const p = n.renderedPosition(), rw = n.renderedWidth(), rh = n.renderedHeight();
        return { id: n.id(), show: hasCodeButton(n.data()), left: p.x + rw / 2 - (CODE_BUTTON.right * zoomNow + size), top: p.y - rh / 2 + CODE_BUTTON.top * zoomNow, size };
      }).filter(b => b.show && b.left > -b.size && b.top > -b.size && b.left < w && b.top < h).map(({ show: _show, ...b }) => b));
      if (!cy.nodes().length) return;
      const b = cy.elements().boundingBox(); const v = cy.extent();
      setMini({nodes: cy.nodes().map(n => ({ id: n.id(), x: n.position('x'), y: n.position('y'), w: n.width(), h: n.height() })), box: {x1: b.x1 - 30, y1: b.y1 - 30, w: Math.max(280, b.w + 60), h: Math.max(160, b.h + 60)}, viewport: v, zoom: cy.zoom()});
    };
    updateMapRef.current = updateMap;
    // Real user camera movement (pan, zoom, drag) is captured, debounced, and reported once it
    // settles. `programmatic` suppresses capture while this component itself writes pan/zoom
    // (restoring a saved camera, or the one-time initial fit) so a restore round trip can never
    // be mistaken for a fresh user gesture.
    let programmatic = false;
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    let mapFrame = 0;
    cy.on('pan zoom position', () => { if (!mapFrame) mapFrame = requestAnimationFrame(() => { mapFrame = 0; updateMap(); }); });
    cy.on('pan zoom', () => {
      if (programmatic) return;
      if (debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        debounceHandle = null;
        callbacks.current.onCameraChange({ zoom: cy.zoom(), pan: { x: cy.pan().x, y: cy.pan().y } });
      }, 180);
    });
    (cy as any).__setProgrammaticCamera = (fn: () => void) => { programmatic = true; try { fn(); } finally { setTimeout(() => { programmatic = false; }, 0); } };
    // The quick-code buttons are drawn over the cards but take no pointer events (CSS), so a drag,
    // right-click, double-click or marquee that starts on that corner behaves exactly like the rest of
    // the card. A plain click is hit-tested here instead: inside the square it opens the code.
    // A programmatic tap (`node.emit('tap')`) carries no position and is never on the square.
    const codeButtonHit = (n: cytoscape.NodeSingular, p: Point | undefined) => {
      if (!p || !hasCodeButton(n.data()) || CODE_BUTTON.size * cy.zoom() < MIN_CODE_BUTTON_PX) return false;
      const c = n.position(), right = c.x + n.width() / 2 - CODE_BUTTON.right, top = c.y - n.height() / 2 + CODE_BUTTON.top;
      return p.x >= right - CODE_BUTTON.size && p.x <= right && p.y >= top && p.y <= top + CODE_BUTTON.size;
    };
    cy.on('mousemove', 'node', e => { const id = codeButtonHit(e.target, e.position) ? e.target.id() : null; setHotCodeId(prev => prev === id ? prev : id); });
    cy.on('mouseout', 'node', () => setHotCodeId(null));
    // Ctrl/Cmd/Shift+click toggles a card in the multi-selection without inspecting it; a plain click inspects.
    const multiKey = (e: cytoscape.EventObject) => { const o = e.originalEvent as MouseEvent | undefined; return !!o && (o.ctrlKey || o.metaKey || o.shiftKey); };
    cy.on('tap', 'node', e => {
      if (multiKey(e)) { const id = e.target.id(); setHover(null); setMultiIds(ids => ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]); return; }
      // The model can briefly lag Cytoscape during reconciliation; a card that is gone has nothing to open.
      const node = currentModel.current.nodes.find(n => n.id === e.target.id());
      if (!node) return;
      if (codeButtonHit(e.target, e.position)) { setContextMenu(null); callbacks.current.onViewCode(node); return; }
      callbacks.current.onNodeSelect(node);
    });
    // Step 4 disconnected double-click from level navigation (that was explore(), a leftover from
    // before View methods/View classes existed as named commands). Step 5 (Appendix B) gives it its
    // own dedicated ARRANGE_AROUND_RESOURCE command via Cytoscape's own `dbltap` gesture recognition
    // (H4): the first tap still reaches `onNodeSelect` above (inspection is idempotent, so a repeat
    // inspect of the same subject is a no-op) and cannot itself move or unmount anything; `dbltap`
    // fires in addition, once, on the second tap.
    cy.on('dbltap', 'node', e => { if (!multiKey(e)) callbacks.current.onArrangeAroundResource(e.target.id()); });
    // Group drag: grabbing a card that belongs to a multi-selection of two or more carries the other
    // selected cards by the same delta. Their start positions are captured at grab time so the
    // group keeps its exact shape, and every moved card is reported once on release.
    let groupDrag: { id: string; start: Point; others: { node: cytoscape.NodeSingular; start: Point }[] } | null = null;
    cy.on('grab', 'node', e => {
      const id = e.target.id(), ids = multiRef.current;
      if (ids.length < 2 || !ids.includes(id)) { groupDrag = null; return; }
      const others = ids.filter(other => other !== id).map(other => cy.getElementById(other)).filter(n => n.length > 0).map(n => n as unknown as cytoscape.NodeSingular);
      groupDrag = { id, start: { ...e.target.position() }, others: others.map(node => ({ node, start: { ...node.position() } })) };
    });
    cy.on('drag', 'node', e => {
      if (!groupDrag || e.target.id() !== groupDrag.id) return;
      const p = e.target.position(), dx = p.x - groupDrag.start.x, dy = p.y - groupDrag.start.y;
      cy.batch(() => { for (const o of groupDrag!.others) if (o.node.inside()) o.node.position({ x: o.start.x + dx, y: o.start.y + dy }); });
    });
    cy.on('dragfree', 'node', e => {
      const p = e.target.position(); callbacks.current.onNodeMoved(e.target.id(), { x: p.x, y: p.y });
      if (groupDrag && groupDrag.id === e.target.id()) {
        for (const o of groupDrag.others) if (o.node.inside()) { const q = o.node.position(); callbacks.current.onNodeMoved(o.node.id(), { x: q.x, y: q.y }); }
      }
      groupDrag = null;
    });
    // Right-click adds the card to the multi-selection (never removes it -- use the menu's Deselect)
    // and opens the actions menu for the whole selection.
    cy.on('cxttap', 'node', e => {
      (e.originalEvent as Event | undefined)?.preventDefault();
      const node=currentModel.current.nodes.find(n=>n.id===e.target.id());
      if(!node){setContextMenu(null);return;}
      setMultiIds(ids=>ids.includes(node.id)?ids:[...ids,node.id]);
      const position=e.renderedPosition || e.target.renderedPosition();
      setHover(null);
      setContextMenu({node,x:Math.max(8,Math.min(position.x,cy.width()-238)),y:Math.max(8,Math.min(position.y,cy.height()-150))});
    });
    // A plain click on empty canvas clears the multi-selection, like most canvas editors.
    cy.on('tap', e => { if (e.target === cy && !multiKey(e)) setMultiIds(ids => ids.length ? [] : ids); });

    // Ctrl/Cmd/Shift + left-drag on empty canvas: Cytoscape's own box gesture. With native selection
    // disabled it still reports every node in the box ('box', emitted synchronously right after
    // 'boxend'), so those ids are collected and added to the multi-selection once the gesture ends.
    const boxed = new Set<string>();
    cy.on('boxstart', () => boxed.clear());
    cy.on('box', 'node', e => { boxed.add(e.target.id()); });
    cy.on('boxend', () => queueMicrotask(() => {
      if (!boxed.size) return;
      const add = [...boxed]; boxed.clear();
      setMultiIds(ids => { const merged = [...ids]; for (const id of add) if (!merged.includes(id)) merged.push(id); return merged; });
    }));

    // Right-button marquee. Cytoscape never pans on a right-drag: it emits cxttapstart, then cxtdrag
    // once the pointer passes its drag threshold, then cxttapend -- and it emits cxttap only when the
    // pointer did NOT drag, so a plain right-click keeps its own handler above. The anchor is kept in
    // model coordinates; every card whose box intersects the band joins the multi-selection (never
    // removes, like right-click) and the actions menu opens at the release point.
    let anchor: Point | null = null, dragging = false, candidates: string[] = [];
    const bandFor = (a: Point, b: Point) => ({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) });
    const toRendered = (p: Point) => ({ x: p.x * cy.zoom() + cy.pan().x, y: p.y * cy.zoom() + cy.pan().y });
    const hits = (band: { x1: number; y1: number; x2: number; y2: number }) => cy.nodes().filter(n => {
      const bb = n.boundingBox({ includeLabels: false, includeOverlays: false });
      return bb.x1 <= band.x2 && bb.x2 >= band.x1 && bb.y1 <= band.y2 && bb.y2 >= band.y1;
    }).map(n => n.id());
    const markCandidates = (ids: string[]) => cy.batch(() => { cy.nodes('.marquee-candidate').removeClass('marquee-candidate'); for (const id of ids) cy.getElementById(id).addClass('marquee-candidate'); });
    const endMarquee = () => { anchor = null; dragging = false; candidates = []; markCandidates([]); setMarquee(null); };
    cancelMarqueeRef.current = endMarquee;
    cy.on('cxttapstart', e => { anchor = { ...e.position }; dragging = false; candidates = []; });
    cy.on('cxtdrag', e => {
      if (!anchor) return;
      if (!dragging) { dragging = true; setHover(null); setContextMenu(null); }
      const band = bandFor(anchor, e.position), a = toRendered({ x: band.x1, y: band.y1 }), b = toRendered({ x: band.x2, y: band.y2 });
      candidates = hits(band);
      markCandidates(candidates);
      setMarquee({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
    cy.on('cxttapend', e => {
      if (!anchor || !dragging) { anchor = null; return; }
      const add = candidates, release = e.renderedPosition || toRendered(e.position);
      endMarquee();
      if (!add.length) return;
      setMultiIds(ids => { const merged = [...ids]; for (const id of add) if (!merged.includes(id)) merged.push(id); return merged; });
      setContextMenu({ node: null, x: Math.max(8, Math.min(release.x, cy.width() - 238)), y: Math.max(8, Math.min(release.y, cy.height() - 150)) });
    });
    cy.on('mouseover', 'edge', e => {
      const edge = currentModel.current.edges.find(n=>n.id===e.target.id()); if(!edge)return;
      const a=currentModel.current.nodes.find(n=>n.id===edge.sourceId),b=currentModel.current.nodes.find(n=>n.id===edge.targetId);
      const position=e.renderedPosition || e.target.renderedMidpoint();
      setHover({ready:edge.explanationStatus==='READY',title:`${a?.simpleName} → ${b?.simpleName}`,description:`${edge.kind.toLowerCase().replaceAll('_',' ')} · ${edge.occurrenceCount||1} source occurrence(s) · ${edge.resolution.toLowerCase()}. Click to inspect evidence.`,x:Math.max(12,Math.min(position.x,cy.width()-280)),y:Math.max(12,position.y-100)});
    });
    cy.on('mouseout pan zoom tap',()=>setHover(null));
    cy.on('pan zoom tap',()=>setContextMenu(null));
    cy.on('tap', 'edge', e => { const edge = currentModel.current.edges.find(n => n.id === e.target.id()); if (edge) callbacks.current.onEdgeSelect(edge); });
    const canvas=container.current;
    const preventContextMenu=(event:MouseEvent)=>event.preventDefault();
    canvas.addEventListener('contextmenu',preventContextMenu);
    // Resize keeps the renderer's own dimensions in sync but never re-fits: a pane resize (narrow
    // screen swap, sidebar toggle) must not move the camera the user set. Skip on a transient
    // zero-size container so cy.resize() cannot corrupt pan/zoom.
    const observer = new ResizeObserver(() => { if (!container.current?.clientWidth || !container.current?.clientHeight) return; cy.resize(); updateMap(); }); observer.observe(canvas);
    return () => { canvas.removeEventListener('contextmenu',preventContextMenu); observer.disconnect(); if (debounceHandle) clearTimeout(debounceHandle); if (mapFrame) cancelAnimationFrame(mapFrame); cy.destroy(); cyRef.current = null; };
  }, []);

  // A card membership change closes the menu and drops selected cards that are no longer displayed.
  // Keyed on card IDs only: an edge or relationship-filter change leaves the menu's cards untouched.
  useEffect(()=>{
    setContextMenu(null);
    const displayed=new Set(nodes.map(n=>n.id));
    setMultiIds(ids=>ids.every(id=>displayed.has(id))?ids:ids.filter(id=>displayed.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[nodesKey]);
  useEffect(()=>{
    if(!contextMenu)return;
    const dismiss=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setContextMenu(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();setContextMenu(null);}};
    window.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',escape,true);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return()=>{window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',escape,true);};
  },[contextMenu]);
  useEffect(()=>{
    if(!marquee)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();cancelMarqueeRef.current();}};
    window.addEventListener('keydown',escape,true);
    return()=>window.removeEventListener('keydown',escape,true);
  },[marquee!==null]);
  // Escape (with no menu open) clears the multi-selection, or else leaves the full-screen overlay. While
  // the browser itself is in full screen it handles Escape first and exits (the fullscreenchange listener
  // below then leaves the overlay too); pages cannot intercept that, so the selection is kept then.
  useEffect(()=>{
    if(!multiIds.length&&!fullscreen)return;
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
      if(multiRef.current.length)setMultiIds([]);else setFullscreen(false);
    };
    window.addEventListener('keydown',escape);
    return()=>window.removeEventListener('keydown',escape);
  },[multiIds.length>0,fullscreen]);
  // Full screen: the stage becomes a fixed overlay (CSS) and the browser is asked for real full
  // screen on the document root, so modal dialogs such as the source viewer still appear above it.
  // Leaving browser full screen (browser Esc, F11) also leaves the overlay. The existing
  // ResizeObserver resizes the renderer without re-fitting, so the camera is preserved.
  useEffect(()=>{
    if(!fullscreen)return;
    const root=document.documentElement;
    if(!document.fullscreenElement&&root.requestFullscreen)root.requestFullscreen().catch(()=>{});
    const change=()=>{if(!document.fullscreenElement)setFullscreen(false);};
    document.addEventListener('fullscreenchange',change);
    return()=>{document.removeEventListener('fullscreenchange',change);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});};
  },[fullscreen]);
  const selectedNodes=multiIds.map(id=>nodes.find(n=>n.id===id)).filter((n):n is AtlasNode=>Boolean(n));
  const removableNodes=selectedNodes.filter(n=>canRemoveFromScope(n));
  // Name what leaves scope when that differs from the selected cards (a method card removes its class).
  const removalTargets=removableNodes.length?scopeRemovalTargets(removableNodes):[];
  const removalIsSelection=removalTargets.length===removableNodes.length&&removableNodes.every(n=>removalTargets.some(t=>t.id===n.id));
  const removalNoun=removalTargets.every(t=>t.kind==='PACKAGE')?'packages':removalTargets.some(t=>t.kind==='PACKAGE')?'packages and classes':'classes';
  const removalLabel=removalIsSelection?(selectedNodes.length>1?`Remove ${removableNodes.length} from scope`:'Remove from scope')
    :removalTargets.length===1?`Remove ${removalTargets[0].kind==='PACKAGE'?'package':'class'} ${removalTargets[0].simpleName} from scope`:`Remove ${removalTargets.length} ${removalNoun} from scope`;
  const removalTitle=removalIsSelection?undefined:'Scope holds packages and classes, so a method leaves the map with its class.';
  function removeSelectedFromScope(){if(removableNodes.length)callbacks.current.onRemoveFromScope(removableNodes);setMultiIds([]);setContextMenu(null);}

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

  // Multi-selection outline. Declared after reconciliation so a card added in the same commit already exists.
  useEffect(()=>{
    const cy=cyRef.current; if(!cy)return;
    cy.batch(()=>{cy.nodes('.multi-selected').removeClass('multi-selected');for(const id of multiIds)cy.getElementById(id).addClass('multi-selected');});
  },[multiIds,nodes]);

  // Selection/inspection emphasis only: never a layout or fit call. Selected card gets a stronger
  // outline (node.inspected style); its visible incident edges get thicker strokes (.incident) and
  // direct neighbors get stronger outlines (.neighbor); everything else outside the closed
  // neighborhood is gently dimmed (.muted). Hidden edges contribute no neighbors because they were
  // never added to cy in the first place (filtered out by the caller before this component sees them).
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.elements().removeClass('inspected muted neighbor incident');
    if (selectedId) {
      const selected = cy.getElementById(selectedId);
      if (selected.length) {
        selected.addClass('inspected');
        // An edge's closedNeighborhood() is only the edge itself, so an inspected edge keeps its endpoints explicitly.
        const neighborhood = selected.closedNeighborhood().union(selected.connectedNodes());
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
  const menuNode=contextMenu?.node||null;
  const menuSelected=menuNode?selectedNodes.some(n=>n.id===menuNode.id):false;
  const menuTitle=selectedNodes.length>1?`${selectedNodes.length} resources selected`:(menuNode||selectedNodes[0])?.simpleName||'Selection';
  return <div className={`graph-stage${fullscreen?' fullscreen':''}`}>
    <div ref={container} className="graph-canvas" aria-label="Dependency graph" />
    {codeButtons.map(b=>{const n=nodes.find(item=>item.id===b.id);return n?<CodeButton key={b.id} name={n.simpleName} kind={n.kind} className={`map-code-button${hotCodeId===b.id?' hot':''}`} style={{left:b.left,top:b.top,width:b.size,height:b.size,fontSize:Math.max(10,b.size*.5)}} onClick={()=>{setContextMenu(null);onViewCode(n);}}/>:null;})}
    {!nodes.length && <div className="canvas-empty">No symbols in this view. Choose another level or clear the filter.</div>}
    {hover&&<div className="edge-hover" style={{left:hover.x,top:hover.y}}><strong>{hover.ready&&<GeminiBadge/>} {hover.title}</strong><p>{hover.description}</p></div>}
    {contextMenu&&<div ref={menuRef} className="graph-context-menu" role="menu" aria-label={selectedNodes.length>1?`Actions for ${selectedNodes.length} selected resources`:`Actions for ${menuTitle}`} style={{left:contextMenu.x,top:contextMenu.y}}>
      <div className="graph-context-menu-heading">{menuTitle}</div>
      <button role="menuitem" className="danger" disabled={!removableNodes.length} title={removalTitle} onClick={removeSelectedFromScope}><span aria-hidden="true">−</span> {removalLabel}</button>
      {menuNode&&menuSelected&&selectedNodes.length>1&&<button role="menuitem" onClick={()=>{setMultiIds(ids=>ids.filter(id=>id!==menuNode.id));setContextMenu(null);}}><span aria-hidden="true">○</span> Deselect {menuNode.simpleName}</button>}
      <button role="menuitem" onClick={()=>{setMultiIds([]);setContextMenu(null);}}><span aria-hidden="true">✕</span> {selectedNodes.length>1?'Clear selection':'Deselect'}</button>
      <p className="graph-context-menu-hint">Right-click or right-drag over more cards to add them. Drag any selected card to move the group.</p>
    </div>}
    {selectedNodes.length>0&&<div className="selection-bar" role="toolbar" aria-label="Selected resources"><strong>{selectedNodes.length} selected</strong><button className="danger" disabled={!removableNodes.length} title={removalTitle} onClick={removeSelectedFromScope}>{removalLabel}</button><button onClick={()=>setMultiIds([])}>Clear</button></div>}
    {marquee&&<div className="graph-marquee" aria-hidden="true" style={{left:marquee.x1,top:marquee.y1,width:marquee.x2-marquee.x1,height:marquee.y2-marquee.y1}}/>}
    <div className="canvas-hint">Arrows point from caller to dependency · right-drag or Ctrl+click to select several</div>
    <div className="zoom-controls"><button onClick={() => zoom(1.2)} aria-label="Zoom in">+</button><span>{Math.round((mini?.zoom || 1)*100)}%</span><button onClick={() => zoom(1/1.2)} aria-label="Zoom out">−</button><button onClick={fit} aria-label="Fit map" title="Fit map"><span aria-hidden="true" className="control-icon">⤧</span><span className="control-text">Fit map</span></button><button onClick={() => setFullscreen(f => !f)} aria-pressed={fullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen (Esc)' : 'Show the map full screen'}><span aria-hidden="true">{fullscreen ? '⤡' : '⤢'}</span><span className="control-text">{fullscreen ? ' Exit full screen' : ' Full screen'}</span></button></div>
    <div className={`minimap ${mapOpen ? '' : 'collapsed'}`}>
      <button className="minimap-title" onClick={() => setMapOpen(!mapOpen)} aria-expanded={mapOpen}>Map overview <span>{mapOpen ? '−' : '+'}</span></button>
      {mapOpen && mini && <svg role="img" aria-label="Map overview with current viewport" viewBox={`${mini.box.x1} ${mini.box.y1} ${mini.box.w} ${mini.box.h}`} preserveAspectRatio="xMidYMid meet" onClick={e => {
        const svg = e.currentTarget, point = svg.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
        const transform = svg.getScreenCTM(); const cy = cyRef.current;
        if (transform && cy) { const p = point.matrixTransform(transform.inverse()); cy.pan({x: cy.width()/2 - p.x*cy.zoom(), y: cy.height()/2 - p.y*cy.zoom()}); }
      }}>
        {edges.map(e => { const a=mini.nodes.find(n=>n.id===e.sourceId),b=mini.nodes.find(n=>n.id===e.targetId); return a&&b?<line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#c5d0dd" strokeWidth="4"/>:null; })}
        {mini.nodes.map(n => <rect key={n.id} x={n.x-n.w/2} y={n.y-n.h/2} width={n.w} height={n.h} rx="10" fill={n.id===selectedId?'#0b9193':'#a4b8cd'}/>)}
        <rect x={mini.viewport.x1} y={mini.viewport.y1} width={mini.viewport.w} height={mini.viewport.h} fill="#07888c0c" stroke="#07888c" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      </svg>}
    </div>
  </div>;
}
