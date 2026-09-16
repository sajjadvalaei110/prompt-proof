import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import { AtlasNode, AtlasEdge, kindSummary } from './graphModel';
import { nodeCard, cornerButtons, CODE_BUTTON, MIN_CARD_SIZE, CornerAction, CardSize } from './nodeCard';
import { CONTAINER_BUTTON, CONTAINER_PADDING } from './expansionLayout';
import CodeButton from '../../components/CodeButton';

/** Below this rendered size the corner buttons are hidden and the corner is part of the card. */
const MIN_CODE_BUTTON_PX = 14;
/** Below this rendered card width the resize grip is hidden. */
const MIN_RESIZE_CARD_PX = 60;
/** The expand/collapse control a card or container shows in its corner. */
type CornerHit = CornerAction | 'collapse';
interface MinimapState { nodes: { id: string; x: number; y: number; w: number; h: number; parent: boolean }[]; box: { x1: number; y1: number; w: number; h: number }; viewport: { x1: number; y1: number; w: number; h: number }; zoom: number }
/** Cheap field-by-field comparison so a pan/zoom frame that changed nothing real skips its
 * setState (review remediation F-04); an actual camera move still differs on `viewport`/`zoom`. */
function sameMinimap(a: MinimapState, b: MinimapState): boolean {
  if (a.zoom !== b.zoom || a.nodes.length !== b.nodes.length) return false;
  const v = a.viewport, w = b.viewport;
  if (v.x1 !== w.x1 || v.y1 !== w.y1 || v.w !== w.w || v.h !== w.h) return false;
  const bx = a.box, by = b.box;
  if (bx.x1 !== by.x1 || bx.y1 !== by.y1 || bx.w !== by.w || bx.h !== by.h) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    const p = a.nodes[i], q = b.nodes[i];
    if (p.id !== q.id || p.x !== q.x || p.y !== q.y || p.w !== q.w || p.h !== q.h || p.parent !== q.parent) return false;
  }
  return true;
}
import GeminiBadge from '../../components/GeminiBadge';

export interface Point { x: number; y: number }

/**
 * Inspection flow palette: route colors plus the lighter halo drawn around related resources.
 * The three route colors each clear WCAG 2.1 SC 1.4.11 (3:1) against the #f8fafc canvas -- out
 * 3.39:1, in 3.88:1, both 4.33:1. The halo tints are deliberately far lighter and do not: they are
 * a glow *around* a border already painted in the conforming route color, never the sole carrier of
 * the relationship, which is also encoded by border-style (see the .rel-* rules below).
 */
const FLOW = { out: '#1d90cc', outHalo: '#a9dcf7', in: '#e0474c', inHalo: '#f6b3b3', both: '#8f5bd6', bothHalo: '#cfb2f2' };
/** Style properties the animation loop writes as bypasses; always cleared together. */
const ANIMATED_STYLES = 'line-dash-offset underlay-opacity outline-opacity outline-width';

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
  /** A manual drag completed for exactly one card (no group selection, and not an expanded card
   * carrying others). `containerId` is the expanded card it is in. */
  onNodeMoved: (id: string, position: Point, containerId: string | null) => void;
  /** A manual drag completed for several cards at once: a dragged expanded card reports every card
   * inside it (leaf and nested-expanded alike), and a group drag reports every selected card --
   * combined into one call so state updates once instead of once per card (review remediation F-05). */
  onNodesMoved: (moves: { id: string; position: Point; containerId: string | null }[]) => void;
  /** User-resized card sizes by ID; absent means nodeCard's default size. */
  sizes: Record<string, CardSize>;
  /** User-resized minimum boxes of expanded cards by ID. */
  containerSizes: Record<string, CardSize>;
  /** The details button on a package/type card (expand), or the collapse button on an expanded one. */
  onToggleExpand: (node: AtlasNode) => void;
  /** A resize-grip drag completed on a card; `position` keeps its top-left corner in place. */
  onResizeNode: (id: string, size: CardSize, position: Point, containerId: string | null) => void;
  /** A resize-grip drag completed on an expanded card's box; the size excludes the box's padding. */
  onResizeContainer: (id: string, size: CardSize) => void;
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
export default function GraphCanvas({ nodes, edges, positions, camera, selectedId, onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, scopeRemovalTargets, onNodeMoved, onNodesMoved, onCameraChange, onArrangeAroundResource, onViewCode, sizes, containerSizes, onToggleExpand, onResizeNode, onResizeContainer }: Props) {
  const container = useRef<HTMLDivElement>(null), cyRef = useRef<cytoscape.Core | null>(null), menuRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onNodesMoved, onCameraChange, onArrangeAroundResource, onViewCode, onToggleExpand, onResizeNode, onResizeContainer });
  callbacks.current = { onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onNodesMoved, onCameraChange, onArrangeAroundResource, onViewCode, onToggleExpand, onResizeNode, onResizeContainer };
  const [mini, setMini] = useState<MinimapState | null>(null);
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
  // Screen boxes (stage pixels) for the on-card corner buttons and resize grips, recomputed with the minimap.
  const [cornerOverlays,setCornerOverlays]=useState<{id:string;action:CornerHit;left:number;top:number;size:number}[]>([]);
  const [resizeGrips,setResizeGrips]=useState<{id:string;left:number;top:number;size:number}[]>([]);
  // The card corner square the pointer is over (the canvas owns the pointer; see cornerHit).
  const [hotCorner,setHotCorner]=useState<string|null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const model = useMemo(() => ({nodes, edges}), [nodes, edges]);
  const currentModel=useRef(model); currentModel.current=model;
  const updateMapRef = useRef<() => void>(() => {});
  const nodesKey=useMemo(()=>JSON.stringify(nodes.map(n=>n.id)),[nodes]);
  // One merged route carries several kinds, so the label is the kind breakdown (top 2, "+n" tail)
  // rather than a single kind plus a site count; the ✦ still marks a ready explanation.
  const edgeLabel=(e:AtlasEdge)=>(e.explanationStatus==='READY'?'✦ ':'')+kindSummary(e,2);
  const childCounts=useMemo(()=>{const m=new Map<string,number>();for(const n of nodes)if(n.containerId)m.set(n.containerId,(m.get(n.containerId)||0)+1);return m;},[nodes]);
  // `parent` is left out on purpose: Cytoscape sets a node's parent only on add or move(), never through data().
  const nodeStyleData=(n:AtlasNode)=>{
    const {containerId:_containerId,...rest}=n;
    const card=nodeCard(n,sizes[n.id]),min=containerSizes[n.id];
    const childWord=n.kind==='PACKAGE'?'types':'methods';
    return {...rest,expanded:!!n.expanded,card:card.image,cardWidth:card.width,cardHeight:card.height,minW:min?.width||0,minH:min?.height||0,
      containerLabel:`${n.kind==='PACKAGE'?n.qualifiedName||n.simpleName:n.simpleName}  ·  ${childCounts.get(n.id)||0} ${childWord}`,
      label:n.simpleName+'\n'+(n.roles?.[0]?.toLowerCase().replaceAll('_',' ')||n.kind.toLowerCase()),color:n.kind==='PACKAGE'?'#6c79b6':n.roles?.includes('SERVICE')?'#16888a':n.roles?.includes('REPOSITORY')?'#6287c8':'#8293a8'};
  };

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
        // An expanded card is a container around its children: no card image, a header label, and a
        // user-resizable minimum box that grows to the right and down from its top-left corner.
        { selector: 'node[?expanded]', style: { 'background-image': 'none', 'background-color': '#f5f8fc', 'border-width': 2, 'border-style': 'dashed', label: 'data(containerLabel)', 'text-valign': 'top', 'text-halign': 'center', 'text-margin-y': CONTAINER_PADDING - 10, 'font-size': 18, 'font-weight': 600, color: '#19334f', 'text-max-width': '2000px', 'text-wrap': 'none', padding: `${CONTAINER_PADDING}px`, 'compound-sizing-wrt-labels': 'exclude', 'min-width': 'data(minW)', 'min-height': 'data(minH)', 'min-width-bias-left': '0%', 'min-width-bias-right': '100%', 'min-height-bias-top': '0%', 'min-height-bias-bottom': '100%' } as any },
        { selector: 'node.inspected', style: { 'background-color': '#e0f4f3', 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'node.neighbor', style: { 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'edge', style: { width: 'data(strengthWidth)', 'line-color': '#a0aebd', 'target-arrow-color': '#8395a9', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 11, color: '#5b6d83', 'text-opacity': .85, 'text-background-color': '#f7f9fc', 'text-background-opacity': 1, 'text-background-padding': '3px', 'text-rotation': 'autorotate', 'text-margin-y': -11, 'arrow-scale': .8 } },
        { selector: 'edge[resolution != "RESOLVED"]', style: { 'line-color': '#ba862d', 'target-arrow-color': '#ba862d', 'line-style': 'dashed' } },
        { selector: 'edge[explanationStatus = "READY"]', style: { color: '#7955b7', 'text-background-color': '#f3eeff', 'text-opacity': 1 } },
        // Strength lives in data(strengthWidth); emphasis below changes color/glow only, never a fixed
        // width that would thin a strong route. These rules sit after the resolution rule on purpose:
        // Cytoscape resolves conflicts by array order, not selector specificity.
        { selector: 'edge.inspected', style: { 'line-color': '#07888c', 'target-arrow-color': '#07888c', color: '#08777b', 'underlay-color': '#07888c', 'underlay-opacity': .16, 'underlay-padding': 4 } },
        { selector: '.muted', style: { opacity: .6 } },
        // Inspection of a resource (Change-edges requirement 2): outgoing routes sky blue, incoming red,
        // animated dashes flowing source -> target with a pulsing glow (see the animation effect).
        { selector: 'edge.flow-out, edge.flow-in', style: { 'line-style': 'dashed', 'line-dash-pattern': [14, 7], 'underlay-padding': 5, 'underlay-opacity': .22, 'z-index': 20, 'text-opacity': 1 } },
        { selector: 'edge.flow-out', style: { 'line-color': FLOW.out, 'target-arrow-color': FLOW.out, 'underlay-color': FLOW.out, color: '#1778a8' } },
        { selector: 'edge.flow-in', style: { 'line-color': FLOW.in, 'target-arrow-color': FLOW.in, 'underlay-color': FLOW.in, color: '#b4262b' } },
        { selector: 'edge.flow-uncertain', style: { 'line-dash-pattern': [5, 6] } },
        // Direction is carried by border-style as well as hue (WCAG 2.1 SC 1.4.1): output-only keeps
        // a plain solid border, input-only is dashed, and mutual is a double border -- so a viewer
        // with a colour-vision deficiency can still tell a caller from a bidirectional collaborator.
        { selector: 'node.rel-out, node.rel-in, node.rel-both', style: { 'outline-width': 6, 'outline-offset': 2, 'outline-opacity': .85, 'border-width': 2.5 } },
        { selector: 'node.rel-out', style: { 'outline-color': FLOW.outHalo, 'border-color': FLOW.out, 'border-style': 'solid' } },
        { selector: 'node.rel-in', style: { 'outline-color': FLOW.inHalo, 'border-color': FLOW.in, 'border-style': 'dashed' } },
        { selector: 'node.rel-both', style: { 'outline-color': FLOW.bothHalo, 'border-color': FLOW.both, 'border-style': 'double', 'border-width': 5 } },
        // Multi-select and marquee sit last so their purple outline wins over flow emphasis.
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
      // An expanded card gets a collapse square in its own top-right corner instead, and every card or
      // container gets a resize grip in its bottom-right corner.
      const zoomNow = cy.zoom(), w = cy.width(), h = cy.height();
      const onScreen = (b: { left: number; top: number; size: number }) => b.left > -b.size && b.top > -b.size && b.left < w && b.top < h;
      const corners: { id: string; action: CornerHit; left: number; top: number; size: number }[] = [], grips: { id: string; left: number; top: number; size: number }[] = [];
      const gripSize = Math.max(12, Math.min(22, 18 * zoomNow));
      cy.nodes().forEach(n => {
        const bb = n.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        if (n.data('expanded')) {
          const size = CONTAINER_BUTTON.size * zoomNow;
          if (size >= MIN_CODE_BUTTON_PX) corners.push({ id: n.id(), action: 'collapse', left: bb.x2 - (CONTAINER_BUTTON.inset * zoomNow + size), top: bb.y1 + CONTAINER_BUTTON.inset * zoomNow, size });
        } else if (CODE_BUTTON.size * zoomNow >= MIN_CODE_BUTTON_PX) {
          const p = n.renderedPosition(), rw = n.renderedWidth(), rh = n.renderedHeight();
          for (const c of cornerButtons(n.data())) corners.push({ id: n.id(), action: c.action, left: p.x + rw / 2 - (c.right + c.size) * zoomNow, top: p.y - rh / 2 + c.top * zoomNow, size: c.size * zoomNow });
        }
        if (bb.w >= MIN_RESIZE_CARD_PX) grips.push({ id: n.id(), left: bb.x2 - gripSize - 2, top: bb.y2 - gripSize - 2, size: gripSize });
      });
      const visibleCorners = corners.filter(onScreen), visibleGrips = grips.filter(onScreen);
      setCornerOverlays(prev => prev.length || visibleCorners.length ? visibleCorners : prev);
      setResizeGrips(prev => prev.length || visibleGrips.length ? visibleGrips : prev);
      if (!cy.nodes().length) return;
      const b = cy.elements().boundingBox(); const v = cy.extent();
      const next = {nodes: cy.nodes().map(n => { const nb = n.boundingBox({ includeLabels: false, includeOverlays: false }); return { id: n.id(), x: (nb.x1 + nb.x2) / 2, y: (nb.y1 + nb.y2) / 2, w: nb.w, h: nb.h, parent: !!n.data('expanded') }; }), box: {x1: b.x1 - 30, y1: b.y1 - 30, w: Math.max(280, b.w + 60), h: Math.max(160, b.h + 60)}, viewport: v, zoom: cy.zoom()};
      // Same rule as the overlay arrays above: skip the state update (and its re-render) when nothing
      // actually moved, rather than setting a fresh object on every rAF regardless (review remediation
      // F-04). During real panning/zooming the viewport genuinely differs every frame and still updates.
      setMini(prev => prev && sameMinimap(prev, next) ? prev : next);
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
    const cornerHit = (n: cytoscape.NodeSingular, p: Point | undefined): CornerHit | null => {
      if (!p) return null;
      const inSquare = (right: number, top: number, size: number) => p.x >= right - size && p.x <= right && p.y >= top && p.y <= top + size;
      if (n.data('expanded')) {
        if (CONTAINER_BUTTON.size * cy.zoom() < MIN_CODE_BUTTON_PX) return null;
        const bb = n.boundingBox({ includeLabels: false, includeOverlays: false });
        return inSquare(bb.x2 - CONTAINER_BUTTON.inset, bb.y1 + CONTAINER_BUTTON.inset, CONTAINER_BUTTON.size) ? 'collapse' : null;
      }
      if (CODE_BUTTON.size * cy.zoom() < MIN_CODE_BUTTON_PX) return null;
      const c = n.position();
      return cornerButtons(n.data()).find(b => inSquare(c.x + n.width() / 2 - b.right, c.y - n.height() / 2 + b.top, b.size))?.action ?? null;
    };
    cy.on('mousemove', 'node', e => { const action = cornerHit(e.target, e.position); const key = action ? `${e.target.id()}:${action}` : null; setHotCorner(prev => prev === key ? prev : key); });
    cy.on('mouseout', 'node', () => setHotCorner(null));
    // Ctrl/Cmd/Shift+click toggles a card in the multi-selection without inspecting it; a plain click inspects.
    const multiKey = (e: cytoscape.EventObject) => { const o = e.originalEvent as MouseEvent | undefined; return !!o && (o.ctrlKey || o.metaKey || o.shiftKey); };
    cy.on('tap', 'node', e => {
      if (multiKey(e)) { const id = e.target.id(); setHover(null); setMultiIds(ids => ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]); return; }
      // The model can briefly lag Cytoscape during reconciliation; a card that is gone has nothing to open.
      const node = currentModel.current.nodes.find(n => n.id === e.target.id());
      if (!node) return;
      const corner = cornerHit(e.target, e.position);
      if (corner === 'code') { setContextMenu(null); callbacks.current.onViewCode(node); return; }
      if (corner) { setContextMenu(null); callbacks.current.onToggleExpand(node); return; }
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
    // An expanded card's own drawn box is derived from its children, so its "position" for storage
    // purposes is not d.position() (Cytoscape's box centroid) but the same anchor collapse expects:
    // the box's top-left corner plus half its own (collapsed) card size (nodeCard.ts owns that size,
    // already carried on the element as cardWidth/cardHeight regardless of expansion). Using the
    // centroid here would silently disagree with where a later collapse puts the card.
    const cardMove = (d: cytoscape.NodeSingular) => {
      const containerId = d.parent().length ? d.parent().first().id() : null;
      if (d.data('expanded')) {
        const bb = d.boundingBox({ includeLabels: false, includeOverlays: false });
        const w = d.data('cardWidth') as number, h = d.data('cardHeight') as number;
        return { id: d.id(), position: { x: bb.x1 + w / 2, y: bb.y1 + h / 2 }, containerId };
      }
      const q = d.position();
      return { id: d.id(), position: { x: q.x, y: q.y }, containerId };
    };
    // Dragging an expanded card moves its whole subtree in Cytoscape: report every card inside it,
    // leaf and nested-expanded alike (review remediation F-02 -- a nested expanded card used to be
    // dropped here, leaving its stored anchor stale after the container that held it moved), plus the
    // dragged card's own new anchor (also previously dropped, stale for any top-level expanded card).
    const movesFor = (n: cytoscape.NodeSingular) => (n.data('expanded') ? [n, ...(n.descendants().toArray() as cytoscape.NodeSingular[])] : [n]).map(cardMove);
    cy.on('dragfree', 'node', e => {
      const moves = movesFor(e.target);
      if (groupDrag && groupDrag.id === e.target.id()) {
        for (const o of groupDrag.others) if (o.node.inside()) moves.push(...movesFor(o.node));
      }
      groupDrag = null;
      if (!moves.length) return;
      // One dispatch for the whole gesture instead of one per card (review remediation F-05).
      if (moves.length === 1) callbacks.current.onNodeMoved(moves[0].id, moves[0].position, moves[0].containerId);
      else callbacks.current.onNodesMoved(moves);
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
      const resolutions=(edge.resolutions||[edge.resolution]).map(r=>r.toLowerCase()).join(' + ');
      setHover({ready:edge.explanationStatus==='READY',title:`${a?.simpleName} → ${b?.simpleName}`,description:`${kindSummary(edge)} · ${edge.occurrenceCount||1} source occurrence(s) · ${resolutions}. Click to inspect evidence.`,x:Math.max(12,Math.min(position.x,cy.width()-280)),y:Math.max(12,position.y-100)});
    });
    cy.on('mouseout pan zoom tap',()=>setHover(null));
    cy.on('pan zoom tap',()=>setContextMenu(null));
    // An expanded box's interior is not hit-tested like a card image, so a route drawn across its
    // collapse square wins the tap over the box. A tap there collapses instead. Ordinary card corners
    // already win over routes through the node tap above, so a route crossing them still inspects.
    cy.on('tap', 'edge', e => {
      const p = e.position;
      const box = p && cy.nodes('[?expanded]').filter(n => cornerHit(n, p) === 'collapse').first();
      const node = box && box.length ? currentModel.current.nodes.find(m => m.id === box.id()) : undefined;
      if (node) { setContextMenu(null); callbacks.current.onToggleExpand(node); return; }
      const edge = currentModel.current.edges.find(n => n.id === e.target.id()); if (edge) callbacks.current.onEdgeSelect(edge);
    });
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
  // changes are unreachable for an aggregate edge: its ID is `aggregate:[source,target]`
  // (graphModel.ts), so a different endpoint is necessarily a different ID -- handled
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
      const edgeIds = new Set(edges.map(e => e.id));
      cy.edges().forEach(e => { if (!edgeIds.has(e.id())) e.remove(); });
      // Expanded cards contain their children (compound nodes). A card that is absent, or whose
      // container changed (a class is a package's child on Packages but a top-level card on Classes),
      // is removed first -- Cytoscape sets a parent only on add, and its move() inside a batch does not
      // take a new position -- so it is added again below with its new parent, position and edges.
      // Removal stays ahead of every add: Cytoscape removes by swapping with the last element, so
      // removing after adding would reorder the survivors. Removing a parent also removes its children;
      // any of them still shown are simply added again. Containers are added before their children.
      const byId = new Map(nodes.map(n => [n.id, n]));
      cy.nodes().forEach(n => {
        if (!n.inside()) return;
        const want = byId.get(n.id());
        if (!want || (n.parent().first()?.id() ?? null) !== (want.containerId ?? null)) n.remove();
      });
      const depth = (n: AtlasNode) => { let d = 0; for (let c = n.containerId; c && d < nodes.length; c = byId.get(c)?.containerId) d++; return d; };
      const ordered = nodes.some(n => n.containerId) ? nodes.map((n, i) => ({ n, i, d: depth(n) })).sort((a, b) => a.d - b.d || a.i - b.i).map(x => x.n) : nodes;
      for (const n of ordered) {
        const data = nodeStyleData(n);
        const pos = positions[n.id] || { x: 0, y: 0 };
        const existing = cy.getElementById(n.id);
        if (existing.length) {
          existing.data(data);
          // A container's position is its children's bounds; writing it would drag every child along.
          if (!n.expanded || !existing.isParent()) {
            const cur = existing.position();
            if (cur.x !== pos.x || cur.y !== pos.y) { existing.position(pos); arranged = true; }
          }
        } else {
          cy.add({ data: { ...data, ...(n.containerId ? { parent: n.containerId } : {}) }, position: pos });
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
  }, [nodes, edges, positions, sizes, containerSizes]);

  // Multi-selection outline. Declared after reconciliation so a card added in the same commit already exists.
  useEffect(()=>{
    const cy=cyRef.current; if(!cy)return;
    cy.batch(()=>{cy.nodes('.multi-selected').removeClass('multi-selected');for(const id of multiIds)cy.getElementById(id).addClass('multi-selected');});
  },[multiIds,nodes]);

  // Selection/inspection emphasis only: never a layout or fit call. Everything outside the selected
  // element's closed neighborhood is gently dimmed (.muted). Hidden edges contribute no neighbors
  // because they were never added to cy in the first place (filtered out by the caller).
  // - An inspected resource: outgoing routes .flow-out (sky blue), incoming .flow-in (red); related
  //   resources get a halo by direction -- .rel-out light blue, .rel-in light red, .rel-both purple.
  //   A METHOD-level self-call is both directions on itself and gets no halo (it is the selection).
  // - An inspected edge: the edge itself (.inspected) and its endpoints (.neighbor), as before.
  // The flow classes replace the former fixed-width `.incident` emphasis: a route's width now carries
  // its occurrence strength (data(strengthWidth)), so emphasis may only change colour and glow.
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('inspected muted neighbor flow-out flow-in flow-uncertain rel-out rel-in rel-both').removeStyle(ANIMATED_STYLES);
      const selected = selectedId ? cy.getElementById(selectedId) : cy.collection();
      if (!selected.length) return;
      selected.addClass('inspected');
      // closedNeighborhood() iterates the collection's *nodes*, so for an edge it yields only the
      // edge itself -- its endpoints would land in the difference below and get dimmed instead of
      // emphasized. connectedNodes() supplies them explicitly (verified against Cytoscape 3.34.3).
      // Containers of anything emphasized stay unmuted too: a dimmed parent would dim the cards
      // drawn inside it. Ancestors are kept out of `direct` so they never receive a relationship
      // halo -- containing a related card is not itself a relationship.
      const direct = selected.closedNeighborhood().union(selected.connectedNodes());
      const neighborhood = direct.union(direct.nodes().ancestors());
      cy.elements().difference(neighborhood).addClass('muted');
      if (selected.isEdge()) { direct.nodes().addClass('neighbor'); return; }
      const outgoing = new Set<string>(), incoming = new Set<string>();
      (selected as cytoscape.NodeSingular).connectedEdges().forEach(edge => {
        const source = edge.source().id(), target = edge.target().id();
        if (source === selectedId) { edge.addClass('flow-out'); outgoing.add(target); }
        else { edge.addClass('flow-in'); incoming.add(source); }
        if (edge.data('resolution') !== 'RESOLVED') edge.addClass('flow-uncertain');
      });
      direct.nodes().difference(selected).forEach(node => {
        const id = node.id();
        node.addClass(outgoing.has(id) && incoming.has(id) ? 'rel-both' : outgoing.has(id) ? 'rel-out' : 'rel-in');
      });
    });
  }, [selectedId, nodes, edges]);

  // The moving glow: one requestAnimationFrame loop, only while a displayed resource is inspected and
  // has related routes. Dashes flow from source to target (a decreasing line-dash-offset moves the
  // pattern forward along the path); route glow and related-resource halos pulse together. The phase
  // lives in a ref so a re-run caused by a graph poll replacing `edges` does not visibly restart it.
  // Animated values are element style bypasses, removed on every re-run and on unmount so none leak
  // into the next selection. Reduced-motion users keep the static colors without movement.
  const animationPhase = useRef(0);
  useEffect(() => {
    const cy = cyRef.current; if (!cy || !selectedId) return;
    const flowEdges = cy.edges('.flow-out, .flow-in'), halos = cy.nodes('.rel-out, .rel-in, .rel-both');
    if (!flowEdges.length) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0, last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 33) return; // ~30 fps is smooth for dashes and keeps redraws cheap
      const elapsed = last ? Math.min(now - last, 100) : 33; last = now;
      animationPhase.current = (animationPhase.current + elapsed * .045) % 23100; // a whole multiple of both dash periods (21px and 11px), so wrapping never jumps
      const pulse = (Math.sin(now / 420) + 1) / 2;
      cy.batch(() => {
        flowEdges.style({ 'line-dash-offset': -animationPhase.current, 'underlay-opacity': .12 + .26 * pulse });
        halos.style({ 'outline-opacity': .5 + .45 * pulse, 'outline-width': 5 + 4 * pulse });
      });
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); if (!cy.destroyed()) cy.batch(() => { flowEdges.removeStyle(ANIMATED_STYLES); halos.removeStyle(ANIMATED_STYLES); }); };
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

  // Resize grip drag: the card (or container box) follows the pointer live in Cytoscape, and the final
  // size is reported once on release. A card keeps its top-left corner; a container grows right and down.
  // Interrupted or cancelled (Escape, pointercancel) reverts the live visual and dispatches nothing --
  // a resize that never happened, not whatever partial size the pointer last reached (review
  // remediation F-07). Zoom is read live on every move rather than captured once at pointerdown, so a
  // wheel zoom mid-drag cannot desync the dragged edge from the cursor.
  function startResize(event: React.PointerEvent<HTMLElement>, id: string) {
    const cy = cyRef.current, node = nodes.find(n => n.id === id);
    if (!cy || !node || event.button !== 0) return;
    const el = cy.getElementById(id);
    if (!el.length) return;
    event.preventDefault(); event.stopPropagation();
    setContextMenu(null); setHover(null);
    const handle = event.currentTarget, pointerId = event.pointerId, startX = event.clientX, startY = event.clientY;
    handle.setPointerCapture(pointerId);
    const expanded = !!node.expanded;
    const bb = el.boundingBox({ includeLabels: false, includeOverlays: false });
    const start = expanded ? { width: bb.w, height: bb.h } : { width: el.width(), height: el.height() };
    const topLeft = { x: el.position('x') - start.width / 2, y: el.position('y') - start.height / 2 };
    const startData = expanded ? { minW: el.data('minW'), minH: el.data('minH') } : { card: el.data('card'), cardWidth: el.data('cardWidth'), cardHeight: el.data('cardHeight') };
    const startPosition = { x: el.position('x'), y: el.position('y') };
    // A container box's min-width/min-height exclude its padding (Cytoscape adds it outside).
    const inner = (v: number) => Math.max(0, Math.round(v - 2 * CONTAINER_PADDING));
    let size = start;
    const onMove = (ev: PointerEvent) => {
      const zoomNow = cy.zoom();
      size = { width: Math.round(Math.max(MIN_CARD_SIZE.width, start.width + (ev.clientX - startX) / zoomNow)), height: Math.round(Math.max(MIN_CARD_SIZE.height, start.height + (ev.clientY - startY) / zoomNow)) };
      if (expanded) el.data({ minW: inner(size.width), minH: inner(size.height) });
      else { const card = nodeCard(node, size); el.data({ card: card.image, cardWidth: size.width, cardHeight: size.height }); el.position({ x: topLeft.x + size.width / 2, y: topLeft.y + size.height / 2 }); }
      updateMapRef.current();
    };
    const detach = () => {
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); handle.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onEscape, true);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    const onCancel = () => { detach(); el.data(startData); if (!expanded) el.position(startPosition); updateMapRef.current(); };
    const onEscape = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); onCancel(); } };
    const onUp = () => {
      detach();
      if (size === start) return;
      if (expanded) callbacks.current.onResizeContainer(id, { width: inner(size.width), height: inner(size.height) });
      else callbacks.current.onResizeNode(id, size, { x: topLeft.x + size.width / 2, y: topLeft.y + size.height / 2 }, node.containerId ?? null);
    };
    handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', onUp); handle.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onEscape, true);
  }

  // Keyboard resize (review remediation F-06): the grip is a real <button>, so it is already
  // reachable and operable by Tab/Enter/Space; arrow keys step the size by the same rules a pointer
  // drag commits on release -- one step, one dispatch, top-left corner kept for a card, min-width/
  // min-height kept padding-free for a container -- so there is no separate "confirm" step to forget.
  function resizeByKeys(id: string, dx: number, dy: number) {
    const cy = cyRef.current, node = nodes.find(n => n.id === id);
    if (!cy || !node) return;
    const el = cy.getElementById(id);
    if (!el.length) return;
    const expanded = !!node.expanded;
    const bb = el.boundingBox({ includeLabels: false, includeOverlays: false });
    const start = expanded ? { width: bb.w, height: bb.h } : { width: el.width(), height: el.height() };
    const size = { width: Math.max(MIN_CARD_SIZE.width, Math.round(start.width + dx)), height: Math.max(MIN_CARD_SIZE.height, Math.round(start.height + dy)) };
    if (expanded) { const inner = (v: number) => Math.max(0, Math.round(v - 2 * CONTAINER_PADDING)); callbacks.current.onResizeContainer(id, { width: inner(size.width), height: inner(size.height) }); return; }
    const topLeft = { x: el.position('x') - start.width / 2, y: el.position('y') - start.height / 2 };
    callbacks.current.onResizeNode(id, size, { x: topLeft.x + size.width / 2, y: topLeft.y + size.height / 2 }, node.containerId ?? null);
  }
  const gripKeyStep = 10, gripKeyStepFast = 40;
  function gripKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, id: string) {
    const step = event.shiftKey ? gripKeyStepFast : gripKeyStep;
    const delta: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault(); event.stopPropagation();
    resizeByKeys(id, d[0], d[1]);
  }

  function zoom(factor: number) { const cy = cyRef.current; if (cy) cy.zoom({level: cy.zoom() * factor, renderedPosition: {x: cy.width()/2, y: cy.height()/2}}); }
  function fit() { const cy = cyRef.current; if (cy && nodes.length) { cy.fit(undefined, 55); if (cy.zoom() > 1) { cy.zoom(1); cy.center(); } } }
  const menuNode=contextMenu?.node||null;
  const menuSelected=menuNode?selectedNodes.some(n=>n.id===menuNode.id):false;
  const menuTitle=selectedNodes.length>1?`${selectedNodes.length} resources selected`:(menuNode||selectedNodes[0])?.simpleName||'Selection';
  return <div className={`graph-stage${fullscreen?' fullscreen':''}`}>
    <div ref={container} className="graph-canvas" aria-label="Dependency graph" />
    {cornerOverlays.map(b=>{
      const n=nodes.find(item=>item.id===b.id);if(!n)return null;
      const hot=hotCorner===`${b.id}:${b.action}`?' hot':'',style={left:b.left,top:b.top,width:b.size,height:b.size,fontSize:Math.max(10,b.size*.5)};
      if(b.action==='code')return <CodeButton key={`${b.id}:code`} name={n.simpleName} kind={n.kind} className={`map-code-button${hot}`} style={style} onClick={()=>{setContextMenu(null);onViewCode(n);}}/>;
      const collapse=b.action==='collapse',what=n.kind==='PACKAGE'?'types':'methods';
      return <button key={`${b.id}:${b.action}`} type="button" className={`code-button map-code-button map-details-button${hot}`} style={style} aria-expanded={collapse} aria-label={collapse?`Collapse ${n.simpleName}`:`Show ${what} inside ${n.simpleName}`} title={collapse?'Collapse':`Show ${what} and their relationships`} onClick={event=>{event.stopPropagation();setContextMenu(null);onToggleExpand(n);}}><DetailsIcon expanded={collapse}/></button>;
    })}
    {resizeGrips.map(g=>{const n=nodes.find(item=>item.id===g.id);return n?<button key={g.id} type="button" className="map-resize-grip" title={`Resize ${n.simpleName}`} aria-label={`Resize ${n.simpleName}. Use arrow keys, hold Shift for larger steps.`} style={{left:g.left,top:g.top,width:g.size,height:g.size}} onPointerDown={e=>startResize(e,g.id)} onKeyDown={e=>gripKeyDown(e,g.id)}/>:null;})}
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
        {mini.nodes.map(n => <rect key={n.id} x={n.x-n.w/2} y={n.y-n.h/2} width={n.w} height={n.h} rx="10" fill={n.id===selectedId?'#0b9193':n.parent?'#dde6ef':'#a4b8cd'}/>)}
        <rect x={mini.viewport.x1} y={mini.viewport.y1} width={mini.viewport.w} height={mini.viewport.h} fill="#07888c0c" stroke="#07888c" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      </svg>}
    </div>
  </div>;
}

/** Expand (a grid inside a box) or collapse (a box with a minus) glyph for the details button. */
function DetailsIcon({ expanded }: { expanded: boolean }) {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3"/>
    {expanded ? <path d="M8 12h8"/> : <path d="M7.5 7.5h3v3h-3zM13.5 7.5h3v3h-3zM7.5 13.5h3v3h-3zM13.5 13.5h3v3h-3z"/>}
  </svg>;
}
