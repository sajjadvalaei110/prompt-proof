import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import cytoscape from 'cytoscape';
import { AtlasNode, AtlasEdge, kindSummary, reviewRouteSummary } from './graphModel';
import { nodeCard, DESIGN_TONE, cornerButtons, hasCodeButton, hasDetailsButton, CODE_BUTTON, MIN_CARD_SIZE, CornerAction, CardSize } from './nodeCard';
import { Box, CONTAINER_BUTTON, CONTAINER_PADDING } from './expansionLayout';
import CodeButton from '../../components/CodeButton';
import { REVIEW_CHANGE_PALETTE } from '../review/reviewPalette';

/** Below this rendered size the corner buttons are hidden and the corner is part of the card. */
const MIN_CODE_BUTTON_PX = 14;
/** Below this rendered card width the resize grip is hidden. */
const MIN_RESIZE_CARD_PX = 60;
/** The expand/collapse control a card or container shows in its corner, or the outgoing-stack toggle. */
type CornerHit = CornerAction | 'collapse' | 'ungroup' | 'stack' | 'add';
/** Layer badge height in model units; it never renders smaller than STACK_BADGE_MIN_PX. */
const STACK_BADGE_SIZE = 30, STACK_BADGE_MIN_PX = 20;
/** Card-local square of the outgoing-stack toggle: left of the leftmost corner button of a card, or
 * of the collapse square of an expanded card. Same units as CODE_BUTTON / CONTAINER_BUTTON. */
/** Card-local square of an expanded box's Ungroup button (ADR 0011): left of the stack toggle's slot,
 * so it never moves when the toggle appears on hover or selection. */
const UNGROUP_BUTTON = { right: CONTAINER_BUTTON.inset + 2 * (CONTAINER_BUTTON.size + 6), top: CONTAINER_BUTTON.inset, size: CONTAINER_BUTTON.size };
// `right` is the square's right edge from the box's right edge, as in stackButton: collapse at inset,
// the stack toggle one slot left, Ungroup two slots left.
function stackButton(data: any): { right: number; top: number; size: number } {
  if (data.expanded) return { right: CONTAINER_BUTTON.inset + CONTAINER_BUTTON.size + 6, top: CONTAINER_BUTTON.inset, size: CONTAINER_BUTTON.size };
  const corners = cornerButtons(data);
  return { right: corners.length ? Math.max(...corners.map(c => c.right + c.size)) + 8 : CODE_BUTTON.right, top: CODE_BUTTON.top, size: CODE_BUTTON.size };
}
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
import { OutgoingStack, StackDirection, stackSummary } from './outgoingStack';

export interface Point { x: number; y: number }

/** Selection direction is independent of review change state. Against the #f8fafc canvas,
 * WCAG 2.1 SC 1.4.11 contrast is 4.27:1 for indigo and 2.65:1 for cyan; border pattern and
 * terminal arrows also encode direction (ADR 0008 records the cyan contrast limit). */
const HALO = { in: '#6366F1', out: '#0EA5E9' };
/** Ordinary resolved lines are 10% lighter than #a0aebd; their terminal
 * arrowheads are 10% darker than the prior #8395a9 arrow color. */
const ORDINARY_ROUTE = { line: '#aab6c4', arrow: '#768698' };
/** Style properties the animation loop writes as bypasses; always cleared together. */
const ANIMATED_STYLES = 'line-dash-offset underlay-opacity outline-opacity outline-width';
const REVIEW_DATA_KEYS = ['reviewChange', 'reviewSnapshotId', 'reviewSide', 'reviewSourceId', 'reviewAddedLines', 'reviewRemovedLines'];

export interface Camera { zoom: number; pan: Point }

interface Props {
  multiIds: string[];
  onMultiIdsChange: (value: React.SetStateAction<string[]>) => void;
  mapOpen: boolean;
  onMapOpenChange: (open: boolean) => void;
  fullscreen: boolean;
  onFullscreenChange: (open: boolean) => void;
  onClearSelection: () => void;
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
  /** The context menu's Expand/Collapse: every target in one undo step (App queues them). */
  onToggleExpandMany: (nodes: AtlasNode[], action: 'expand' | 'collapse') => void;
  /** Ungroup (ADR 0011): hide an expanded card's box, leaving its children as free cards. */
  onUngroup: (node: AtlasNode) => void;
  /** The nearest ungrouped card this card sits inside, or null; the menu offers to collapse into it. */
  hiddenAncestorOf: (node: AtlasNode) => AtlasNode | null;
  /** Brings an ungrouped card back as a collapsed card. */
  onCollapseInto: (node: AtlasNode) => void;
  /** A resize-grip drag completed on a card; `position` keeps its top-left corner in place. */
  onResizeNode: (id: string, size: CardSize, position: Point, containerId: string | null) => void;
  /** A resize-grip drag completed on an expanded card's box; the size excludes the box's padding. */
  onResizeContainer: (id: string, size: CardSize) => void;
  /** The canvas settled on a new pan/zoom (debounced real movement, or the one-time initial fit). */
  onCameraChange: (camera: Camera, initial?: boolean, transient?: boolean) => void;
  /** Step 5 (Appendix B): the dedicated focused-arrangement command, distinct from inspection and
   * level navigation. Invoked only by a real double-click (`dbltap`, below) -- never by single tap. */
  onArrangeAroundResource: (id: string) => void;
  /** Quick code: opens the source dialog for a class/method card from its on-card </> button. */
  onViewCode: (node: AtlasNode) => void;
  /** Increments on every undo/redo (App no longer remounts the canvas for those). Used only to
   * dismiss transient pointer-interaction UI (context menu, edge hover) a restored state can't
   * otherwise account for -- never to reset model/camera state, which already resyncs from props. */
  restoreVersion: number;
  /** The relation stack to show (computed by the caller for exactly these nodes/edges), or null. */
  outgoingStack: OutgoingStack | null;
  /** The stack's pinned root and direction while a stack is shown. */
  stackRoot: { rootId: string; direction: StackDirection } | null;
  /** The on-card stack button: off -> outgoing -> incoming -> off on the root; outgoing on any other card. */
  onCycleStack: (id: string) => void;
  /** A context-menu item: root this direction on the card, or end it when it is the one shown. */
  onToggleStack: (id: string, direction: StackDirection) => void;
  /** Design mode (ADR 0014, 0015): direct-manipulation authoring. Absent while Design is off or Changes is shown. */
  design?: DesignCanvas;
}
/** A new card typed in place (ADR 0015), drawn as a DOM card over `box` (model coordinates) until committed. */
export interface DesignDraftCard { box: Box; kind: string; placeholder: string; error: string | null; busy: boolean }
/**
 * What design mode needs from the canvas. Geometry stays in the pure layer: App passes each expanded
 * package/type's add slot and the draft card's box in model coordinates; the canvas only draws them.
 * Client-coordinate anchors are where App opens its popover.
 */
export interface DesignCanvas {
  slots: Record<string, Box>;
  draft: DesignDraftCard | null;
  /** "+ class"/"+ method" in an expanded box's slot, or a card menu "Add …" item (`kind` set). */
  onAdd: (container: AtlasNode, kind?: string) => void;
  /** Empty-canvas "Add package" at a model point. */
  onAddPackageAt: (point: Point) => void;
  /** Kinds or fields the inline card does not cover: the full design dialog. */
  onOpenDialog: (command: 'add-child' | 'add-relation', node: AtlasNode | null) => void;
  /** Enter on the draft: its name, and the client point at the draft card's top-right corner (for the quick popup). */
  onDraftCommit: (text: string, anchor: Point) => void;
  onDraftCancel: () => void;
  /** The second click of a two-click relation; `anchor` is the client point halfway between the two cards. */
  onLink: (source: AtlasNode, target: AtlasNode, anchor: Point) => void;
  /** Double-click (or the menu's Explain) on a card or a designed route. */
  onEdit: (target: { node: AtlasNode } | { edge: AtlasEdge }, anchor: Point) => void;
}
/** The inline title a slot asks for, by the box's kind. */
export const slotKind = (containerKind: string) => containerKind === 'PACKAGE' ? 'CLASS' : 'METHOD';

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
export default function GraphCanvas({ multiIds, onMultiIdsChange: setMultiIds, mapOpen, onMapOpenChange: setMapOpen, fullscreen, onFullscreenChange: setFullscreen, onClearSelection, nodes, edges, positions, camera, selectedId, onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, scopeRemovalTargets, onNodeMoved, onNodesMoved, onCameraChange, onArrangeAroundResource, onViewCode, sizes, containerSizes, onToggleExpand, onToggleExpandMany, onUngroup, hiddenAncestorOf, onCollapseInto, onResizeNode, onResizeContainer, restoreVersion, outgoingStack, stackRoot, onCycleStack, onToggleStack, design }: Props) {
  const container = useRef<HTMLDivElement>(null), cyRef = useRef<cytoscape.Core | null>(null), menuRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onNodesMoved, onCameraChange, onArrangeAroundResource, onViewCode, onToggleExpand, onUngroup, onResizeNode, onResizeContainer, onClearSelection, onCycleStack });
  callbacks.current = { onNodeSelect, onEdgeSelect, canRemoveFromScope, onRemoveFromScope, onNodeMoved, onNodesMoved, onCameraChange, onArrangeAroundResource, onViewCode, onToggleExpand, onUngroup, onResizeNode, onResizeContainer, onClearSelection, onCycleStack };
  const [mini, setMini] = useState<MinimapState | null>(null);
  const [hover,setHover]=useState<{title:string;description:string;x:number;y:number;ready:boolean}|null>(null);
  // `node` is the card that was right-clicked; null when the menu opened from a marquee.
  // `addedId`: the card this right-click added to the multi-selection (it was not selected before).
  const [contextMenu,setContextMenu]=useState<{node:AtlasNode|null;x:number;y:number;addedId?:string|null}|null>(null);
  // A right-click on empty canvas: design commands that need no card (ADR 0014).
  const [canvasMenu,setCanvasMenu]=useState<{x:number;y:number;model:Point}|null>(null);
  const designRef=useRef(design); designRef.current=design;
  // Design mode overlays in stage pixels (ADR 0015): the hovered box's add slot, the draft card and the
  // hovered card's relation handle. Recomputed with the corner overlays on every camera change.
  const [designView,setDesignView]=useState<{slot:{id:string;left:number;top:number;width:number;height:number}|null;draft:{left:number;top:number;width:number;height:number}|null;handle:{id:string;x:number;y:number}|null}>({slot:null,draft:null,handle:null});
  // The pending two-click relation: its source card, and the pointer in stage pixels for the rubber band.
  const linkRef=useRef<{sourceId:string;pointer:Point|null}|null>(null);
  const [linkingId,setLinkingId]=useState<string|null>(null);
  // The relation handle stays while the pointer is on it (it sits half outside its card).
  const [handleHold,setHandleHold]=useState<string|null>(null);
  const hoverCardRef=useRef<string|null>(null);
  // menuPosition only reserves a fixed height; once the menu is drawn, lift it so its real height
  // (which grows with the card's actions) stays inside the stage.
  const [menuTop,setMenuTop]=useState<number|null>(null);
  // The element focused when the keyboard opened the menu: focus returns there when it closes.
  const menuOpenerRef=useRef<HTMLElement|null>(null);
  // The one multi-selection every bulk action works on. Right-click, right-drag marquee,
  // Ctrl/Cmd/Shift+click and Ctrl/Cmd/Shift+drag box selection all feed it. Cytoscape's native
  // selection is disabled (`autounselectify`) so there is never a second, action-less selection;
  // inspection emphasis uses the `.inspected` class instead.
  const multiRef=useRef(multiIds); multiRef.current=multiIds;
  // Right-button marquee in rendered (stage) pixels while a right-drag is in progress.
  const [marquee,setMarquee]=useState<{x1:number;y1:number;x2:number;y2:number}|null>(null);
  const cancelMarqueeRef=useRef<()=>void>(()=>{});
  // Screen boxes (stage pixels) for the on-card corner buttons and resize grips, recomputed with the minimap.
  const [cornerOverlays,setCornerOverlays]=useState<{id:string;action:CornerHit;left:number;top:number;size:number}[]>([]);
  const [resizeGrips,setResizeGrips]=useState<{id:string;left:number;top:number;size:number}[]>([]);
  // The card corner square the pointer is over (the canvas owns the pointer; see cornerHit).
  const [hotCorner,setHotCorner]=useState<string|null>(null);
  // The card under the pointer: it shows the relation-stack toggle, like the selected card and the root.
  const [hoverCard,setHoverCard]=useState<string|null>(null);
  hoverCardRef.current=handleHold??hoverCard;
  // The card whose stack toggle holds keyboard focus: it stays drawn after the toggle turns the stack
  // off, so focus is not dropped to the page (WCAG 2.1 SC 2.4.3).
  const [focusedStackId,setFocusedStackId]=useState<string|null>(null);
  const stackRootId=stackRoot?.rootId??null, stackDirection=stackRoot?.direction??'out';
  const stackButtonIds=useMemo(()=>new Set([selectedId,hoverCard,stackRootId,focusedStackId].filter((id):id is string=>!!id&&nodes.some(n=>n.id===id))),[selectedId,hoverCard,stackRootId,focusedStackId,nodes]);
  // Read by the Cytoscape handlers and the overlay draw, which are bound once at mount.
  const stackButtonIdsRef=useRef(stackButtonIds); stackButtonIdsRef.current=stackButtonIds;
  const stackRef=useRef(outgoingStack); stackRef.current=outgoingStack;
  const stackDirectionRef=useRef(stackDirection); stackDirectionRef.current=stackDirection;
  const model = useMemo(() => ({nodes, edges}), [nodes, edges]);
  const currentModel=useRef(model); currentModel.current=model;
  const updateMapRef = useRef<() => void>(() => {});
  const drawDirectionRef = useRef<(phase?: number, pulse?: number, invalidate?: boolean) => void>(() => {});
  const animationPhase = useRef(0);
  // Stage pixels to client pixels, where App anchors its design popover.
  const clientOf=(p:Point):Point=>{const r=container.current?.getBoundingClientRect();return {x:(r?.left||0)+p.x,y:(r?.top||0)+p.y};};
  /** Starts a two-click relation from `id`: the next card clicked is its target (ADR 0015). */
  function startLink(id:string){
    linkRef.current={sourceId:id,pointer:null};setLinkingId(id);setContextMenu(null);setHover(null);
    cyRef.current?.scratch('atlas:designLink',{sourceId:id,from:null,to:null});
  }
  function endLink(){
    if(!linkRef.current)return;
    linkRef.current=null;setLinkingId(null);
    drawDirectionRef.current(undefined,undefined,true);updateMapRef.current();
  }
  const nodesKey=useMemo(()=>JSON.stringify(nodes.map(n=>n.id)),[nodes]);
  // One merged route carries several kinds, so the label is the kind breakdown (top 2, "+n" tail)
  // rather than a single kind plus a site count; the ✦ still marks a ready explanation.
  // One kind plus a "+n" tail, not two: a two-kind label ("calls ×4 · depends on", ~124px) is
  // wider than the gap between adjacent cards (~96px), and cards are opaque and drawn above
  // edges, so the label was overdrawn at both ends -- the text read "alls ×4 · depends o".
  // The full breakdown is one hover away and listed in full in the inspector.
  const edgeLabel=(e:AtlasEdge)=>(e.design&&(e.design.origin!=='CODE'||e.design.explanation)?'✎ ':e.explanationStatus==='READY'?'✦ ':'')+kindSummary(e,1);
  const childCounts=useMemo(()=>{const m=new Map<string,number>();for(const n of nodes)if(n.containerId)m.set(n.containerId,(m.get(n.containerId)||0)+1);return m;},[nodes]);
  // `parent` is left out on purpose: Cytoscape sets a node's parent only on add or move(), never through data().
  // Boolean flags are always written: data() merges, so a flag left out would keep its stale value.
  const nodeStyleData=(n:AtlasNode)=>{
    const {containerId:_containerId,design,...rest}=n;
    const card=nodeCard(n,sizes[n.id]),min=containerSizes[n.id];
    const childWord=n.kind==='PACKAGE'?'types':'methods';
    const reviewChange=n.reviewChange&&n.reviewChange!=='UNCHANGED'?n.reviewChange:null;
    const reviewLabel=reviewChange==='UNKNOWN'?' · NOT ANALYZED':reviewChange?` · ${reviewChange} +${n.reviewAddedLines||0} −${n.reviewRemovedLines||0}`:'';
    return {...rest,...(n.reviewChange?{reviewChange:n.reviewChange}:{}),expanded:!!n.expanded,hiddenBox:!!n.hiddenBox,designOnly:!!design&&!design.codeId&&design.origin!=='CODE',noSource:!!design&&!design.codeId,card:card.image,cardWidth:card.width,cardHeight:card.height,minW:min?.width||0,minH:min?.height||0,
      containerLabel:`${n.kind==='PACKAGE'?n.qualifiedName||n.simpleName:n.simpleName}  ·  ${childCounts.get(n.id)||0} ${childWord}${reviewLabel}`,
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
        // The outgoing stack's root keeps the inspected look. Both sit before the review fills so a
        // changed resource keeps its factual change color while inspected or rooting a stack.
        { selector: 'node.inspected, node.stack-root', style: { 'background-color': '#e0f4f3', 'border-color': '#07888c', 'border-width': 2.5 } },
        { selector: 'node.neighbor', style: { 'border-color': '#07888c', 'border-width': 2.5 } },
        // Review change is parser fact carried by the overlay projection. Keep its card fill
        // visible while a changed resource is inspected; the badge in nodeCard carries the exact
        // +/- declaration totals. Base and after projections omit reviewChange and match ordinary
        // exploration styling.
        { selector: 'node[reviewChange = "ADDED"]', style: { 'background-color': REVIEW_CHANGE_PALETTE.ADDED.nodeFill, 'border-color': REVIEW_CHANGE_PALETTE.ADDED.border } },
        { selector: 'node[reviewChange = "REMOVED"]', style: { 'background-color': REVIEW_CHANGE_PALETTE.REMOVED.nodeFill, 'border-color': REVIEW_CHANGE_PALETTE.REMOVED.border } },
        { selector: 'node[reviewChange = "MODIFIED"]', style: { 'background-color': REVIEW_CHANGE_PALETTE.MODIFIED.nodeFill, 'border-color': REVIEW_CHANGE_PALETTE.MODIFIED.border } },
        { selector: 'node[reviewChange = "UNKNOWN"]', style: { 'border-color': REVIEW_CHANGE_PALETTE.UNKNOWN.border, 'border-style': 'dashed' } },
        // A card that exists only in the design layer (ADR 0014): dashed violet, never mistaken for parsed code.
        { selector: 'node[?designOnly]', style: { 'border-color': DESIGN_TONE.border, 'border-style': 'dashed', 'border-width': 2, 'background-color': DESIGN_TONE.nodeFill } },
        { selector: 'edge', style: { width: 'data(strengthWidth)', 'line-color': ORDINARY_ROUTE.line, 'target-arrow-color': ORDINARY_ROUTE.arrow, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 11, color: '#5b6d83', 'text-opacity': .85, 'text-background-color': '#f7f9fc', 'text-background-opacity': 1, 'text-background-padding': '3px', 'text-rotation': 'autorotate', 'text-margin-y': -11, 'arrow-scale': 1.4, 'text-max-width': '88px', 'text-wrap': 'ellipsis' } },
        { selector: 'edge[explanationStatus = "READY"]', style: { color: '#7955b7', 'text-background-color': '#f3eeff', 'text-opacity': 1 } },
        // Resolution is not drawn on the line (user decision, ADR 0008 amendment 2026-09-25): an
        // uncertain route looks like every other one; its resolution is in the hover text and the
        // inspector. Strength lives in data(strengthWidth); emphasis below changes color/glow only,
        // never a fixed width that would thin a strong route. Cytoscape resolves conflicts by array
        // order, not selector specificity.
        { selector: '.muted', style: { opacity: .5 } },
        // Selection restores moving dashes without replacing the factual route color.
        { selector: 'edge.flow-out, edge.flow-in', style: { 'line-style': 'dashed', 'line-dash-pattern': [8, 5], 'underlay-padding': 2, 'underlay-opacity': .32, 'z-index': 20, 'text-opacity': 1 } },
        // Direction is carried by border-style as well as hue (WCAG 2.1 SC 1.4.1): output-only keeps
        // a plain solid border, input-only is dashed, and mutual is a double border -- so a viewer
        // with a colour-vision deficiency can still tell a caller from a bidirectional collaborator.
        { selector: 'node.rel-out, node.rel-in, node.rel-both', style: { 'outline-width': 9, 'outline-offset': 2, 'outline-opacity': .85, 'border-width': 2.5 } },
        { selector: 'node.rel-out', style: { 'outline-color': HALO.out, 'border-color': HALO.out, 'border-style': 'solid' } },
        { selector: 'node.rel-in', style: { 'outline-color': HALO.in, 'border-color': HALO.in, 'border-style': 'dashed' } },
        { selector: 'node.rel-both', style: { 'outline-opacity': 0, 'border-color': '#64748b', 'border-style': 'double', 'border-width': 5 } },
        // Relation stack chain cards: a thin static outline (never the pulsing rel-out/rel-in halo),
        // cyan for an outgoing stack and indigo for an incoming one. Layer numbers are drawn on the
        // direction overlay.
        { selector: 'node.stack-member', style: { 'outline-width': 3, 'outline-offset': 2, 'outline-opacity': 1, 'outline-color': HALO.out } },
        { selector: 'node.stack-member.stack-in', style: { 'outline-color': HALO.in } },
        // Multi-select and marquee sit last so their purple outline wins over flow emphasis.
        { selector: 'node.multi-selected', style: { 'border-color': '#7955b7', 'border-width': 4, 'overlay-color': '#7955b7', 'overlay-opacity': .1, 'overlay-padding': 8 } },
        { selector: 'node.marquee-candidate', style: { 'border-color': '#7955b7', 'border-width': 3, 'border-style': 'dashed' } },
        // Review route color is factual state, so it stays visible through selection/flow emphasis.
        { selector: 'edge[reviewChange = "ADDED"]', style: { 'line-color': REVIEW_CHANGE_PALETTE.ADDED.route, 'target-arrow-color': REVIEW_CHANGE_PALETTE.ADDED.arrow, color: '#11643f' } },
        { selector: 'edge[reviewChange = "REMOVED"]', style: { 'line-color': REVIEW_CHANGE_PALETTE.REMOVED.route, 'target-arrow-color': REVIEW_CHANGE_PALETTE.REMOVED.arrow, color: '#a42b2b', 'line-style': 'dashed' } },
        // Unknown existence (change status, not resolution) is drawn amber and dotted.
        { selector: 'edge[reviewChange = "UNKNOWN"]', style: { 'line-color': REVIEW_CHANGE_PALETTE.UNKNOWN.route, 'target-arrow-color': REVIEW_CHANGE_PALETTE.UNKNOWN.arrow, color: '#805b12', 'line-style': 'dotted' } },
        // A designed relation: intent, not a parsed fact. Dashed violet, kept as its own route.
        { selector: 'edge[?designed]', style: { 'line-color': DESIGN_TONE.route, 'target-arrow-color': DESIGN_TONE.arrow, 'line-style': 'dashed', 'line-dash-pattern': [10, 6], color: DESIGN_TONE.text, 'text-background-color': DESIGN_TONE.badgeFill, 'target-arrow-shape': 'triangle-backcurve' } },
        { selector: 'edge.flow-out', style: { 'underlay-color': HALO.out } },
        { selector: 'edge.flow-in', style: { 'underlay-color': HALO.in } },
        // Direct edge inspection overrides change colors until deselection.
        { selector: 'edge.inspected', style: { 'line-color': '#000000', 'target-arrow-color': '#000000', color: '#000000', 'underlay-color': '#000000', 'underlay-opacity': .16, 'underlay-padding': 4 } },
        // An ungrouped box (ADR 0011) is still the compound parent of its children but draws nothing
        // and takes no pointer events, so its children move freely and a click anywhere reaches the
        // card or canvas under it. Last, so no selection, halo, stack or change-state rule shows it.
        { selector: 'node[?hiddenBox]', style: { 'background-opacity': 0, 'border-width': 0, 'border-opacity': 0, 'outline-width': 0, 'outline-opacity': 0, 'overlay-opacity': 0, 'underlay-opacity': 0, label: '', padding: '0px', 'min-width': 0, 'min-height': 0, events: 'no' } as any },
      ] });
    cyRef.current = cy;
    const directionCanvas = document.createElement('canvas');
    directionCanvas.className = 'graph-direction-overlay';
    directionCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(directionCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '1', pointerEvents: 'none' });
    container.current.appendChild(directionCanvas);
    const directionContext = directionCanvas.getContext('2d');
    let overlayDraws = 0, directionFrame = 0, queuedPhase = 0, queuedPulse = .5;
    const drawDirection = (phase = animationPhase.current, pulse = .5) => {
      if (!directionContext || !container.current) return;
      const w = container.current.clientWidth, h = container.current.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(w * ratio), pixelHeight = Math.round(h * ratio);
      if (directionCanvas.width !== pixelWidth || directionCanvas.height !== pixelHeight) {
        directionCanvas.width = pixelWidth; directionCanvas.height = pixelHeight;
      }
      directionContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      directionContext.clearRect(0, 0, w, h);
      const rings:{nodeId:string;x:number;y:number;width:number;height:number;leftColor:string;rightColor:string}[]=[];
      cy.nodes('.rel-both').not('.multi-selected').forEach(node => {
        const p = node.renderedPosition(), zoom = cy.zoom();
        const offset = 2 * zoom + 4.5 * zoom;
        const x = p.x - node.renderedWidth()/2 - offset, y = p.y - node.renderedHeight()/2 - offset;
        const width = node.renderedWidth() + 2*offset, height = node.renderedHeight() + 2*offset;
        const lineWidth = (5 + 4*pulse) * zoom;
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
        const ring = () => { directionContext.beginPath(); directionContext.roundRect(x, y, width, height, Math.min(12*zoom, width/4, height/4)); };
        directionContext.lineWidth = lineWidth;
        directionContext.globalAlpha = .5 + .45*pulse;
        for (const [left, color] of [[true, HALO.in], [false, HALO.out]] as const) {
          directionContext.save();
          directionContext.beginPath(); directionContext.rect(left ? x-lineWidth : x+width/2, y-lineWidth, width/2+lineWidth, height+2*lineWidth);
          directionContext.clip(); ring(); directionContext.strokeStyle = color; directionContext.stroke(); directionContext.restore();
        }
        directionContext.globalAlpha = 1;
        rings.push({nodeId:node.id(),x,y,width,height,leftColor:HALO.in,rightColor:HALO.out});
      });
      // Relation stack layer badges: a rounded square centered on each layered card's top-left
      // corner, with a dashed border (HALO.out for outgoing, HALO.in for incoming) that moves with the
      // route dashes (same phase, same [8, 5] pattern scaled to the badge). A minimum on-screen size
      // keeps it legible at low zoom.
      const badges:{nodeId:string;layer:number;x:number;y:number;width:number;height:number;color:string}[]=[];
      const stack=stackRef.current,incoming=stackDirectionRef.current==='in';
      const badgeColor=incoming?HALO.in:HALO.out,badgeText=incoming?'#3730a3':'#075985';
      if(stack) for(const [id,layer] of stack.layers){
        const node=cy.getElementById(id);
        if(!node.length||!node.isNode())continue;
        const bb=node.renderedBoundingBox({includeLabels:false,includeOverlays:false});
        if(![bb.x1,bb.y1].every(Number.isFinite))continue;
        const height=Math.max(STACK_BADGE_MIN_PX,STACK_BADGE_SIZE*cy.zoom()),scale=height/STACK_BADGE_SIZE;
        const digits=String(layer).length,width=height+(digits-1)*height*.5;
        const x=bb.x1-width/2,y=bb.y1-height/2;
        if(x>w||y>h||x+width<0||y+height<0)continue;
        directionContext.beginPath();directionContext.roundRect(x,y,width,height,height*.28);
        directionContext.fillStyle='#ffffff';directionContext.fill();
        directionContext.lineWidth=Math.max(1.5,2.5*scale);directionContext.strokeStyle=badgeColor;
        directionContext.setLineDash([8*scale,5*scale]);directionContext.lineDashOffset=-phase*scale;directionContext.stroke();
        directionContext.setLineDash([]);directionContext.lineDashOffset=0;
        directionContext.fillStyle=badgeText;directionContext.font=`700 ${Math.round(height*.56)}px Segoe UI, Arial, sans-serif`;
        directionContext.textAlign='center';directionContext.textBaseline='middle';
        directionContext.fillText(String(layer),x+width/2,y+height/2+height*.03);
        badges.push({nodeId:id,layer,x,y,width,height,color:badgeColor});
      }
      // The pending two-click relation (ADR 0015): a dashed violet line from the source card's handle to
      // the pointer. Drawn here, never as a Cytoscape element, so the graph itself is untouched.
      const link=linkRef.current,linkSource=link?cy.getElementById(link.sourceId):null;
      if(link&&link.pointer&&linkSource&&linkSource.length){
        const bb=linkSource.renderedBoundingBox({includeLabels:false,includeOverlays:false}),from={x:bb.x2,y:(bb.y1+bb.y2)/2};
        directionContext.save();
        directionContext.strokeStyle=DESIGN_TONE.route;directionContext.lineWidth=2.5;directionContext.setLineDash([9,6]);
        directionContext.beginPath();directionContext.moveTo(from.x,from.y);directionContext.lineTo(link.pointer.x,link.pointer.y);directionContext.stroke();
        directionContext.setLineDash([]);directionContext.fillStyle=DESIGN_TONE.arrow;
        directionContext.beginPath();directionContext.arc(link.pointer.x,link.pointer.y,4.5,0,Math.PI*2);directionContext.fill();
        directionContext.restore();
        cy.scratch('atlas:designLink',{sourceId:link.sourceId,from,to:{...link.pointer}});
      }else cy.scratch('atlas:designLink',link?{sourceId:link.sourceId,from:null,to:null}:null);
      overlayDraws++;cy.scratch('atlas:directionOverlay',{rings,badges,draws:overlayDraws});
    };
    const queueDirectionDraw=(phase=animationPhase.current,pulse=.5,_invalidate=false)=>{
      queuedPhase=phase;queuedPulse=pulse;
      if(!directionFrame)directionFrame=requestAnimationFrame(()=>{directionFrame=0;drawDirection(queuedPhase,queuedPulse);});
    };
    drawDirectionRef.current = queueDirectionDraw;
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
        if (n.data('hiddenBox')) return;
        const bb = n.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        if (n.data('expanded')) {
          const size = CONTAINER_BUTTON.size * zoomNow;
          if (size >= MIN_CODE_BUTTON_PX) {
            corners.push({ id: n.id(), action: 'collapse', left: bb.x2 - (CONTAINER_BUTTON.inset * zoomNow + size), top: bb.y1 + CONTAINER_BUTTON.inset * zoomNow, size });
            corners.push({ id: n.id(), action: 'ungroup', left: bb.x2 - (UNGROUP_BUTTON.right + UNGROUP_BUTTON.size) * zoomNow, top: bb.y1 + UNGROUP_BUTTON.top * zoomNow, size });
          }
        } else if (CODE_BUTTON.size * zoomNow >= MIN_CODE_BUTTON_PX) {
          const p = n.renderedPosition(), rw = n.renderedWidth(), rh = n.renderedHeight();
          for (const c of cornerButtons(n.data())) corners.push({ id: n.id(), action: c.action, left: p.x + rw / 2 - (c.right + c.size) * zoomNow, top: p.y - rh / 2 + c.top * zoomNow, size: c.size * zoomNow });
        }
        const stack = stackButton(n.data()), stackSize = stack.size * zoomNow;
        if (stackSize >= MIN_CODE_BUTTON_PX) corners.push({ id: n.id(), action: 'stack', left: bb.x2 - (stack.right + stack.size) * zoomNow, top: bb.y1 + stack.top * zoomNow, size: stackSize });
        if (bb.w >= MIN_RESIZE_CARD_PX) grips.push({ id: n.id(), left: bb.x2 - gripSize - 2, top: bb.y2 - gripSize - 2, size: gripSize });
      });
      const visibleCorners = corners.filter(onScreen), visibleGrips = grips.filter(onScreen);
      updateDesignView();
      setCornerOverlays(prev => prev.length || visibleCorners.length ? visibleCorners : prev);
      setResizeGrips(prev => prev.length || visibleGrips.length ? visibleGrips : prev);
      if (!cy.nodes().length) return;
      const b = cy.elements().boundingBox(); const v = cy.extent();
      const next = {nodes: cy.nodes().filter(n => !n.data('hiddenBox')).map(n => { const nb = n.boundingBox({ includeLabels: false, includeOverlays: false }); return { id: n.id(), x: (nb.x1 + nb.x2) / 2, y: (nb.y1 + nb.y2) / 2, w: nb.w, h: nb.h, parent: !!n.data('expanded') }; }), box: {x1: b.x1 - 30, y1: b.y1 - 30, w: Math.max(280, b.w + 60), h: Math.max(160, b.h + 60)}, viewport: v, zoom: cy.zoom()};
      // Same rule as the overlay arrays above: skip the state update (and its re-render) when nothing
      // actually moved, rather than setting a fresh object on every rAF regardless (review remediation
      // F-04). During real panning/zooming the viewport genuinely differs every frame and still updates.
      setMini(prev => prev && sameMinimap(prev, next) ? prev : next);
    };
    updateMapRef.current = updateMap;
    // Design mode overlays, in stage pixels. The slot shows for the hovered expanded box, or the box
    // the hovered card sits in; the handle for the hovered card (or the pending relation's source).
    const toStage = (b: Box) => { const z = cy.zoom(), pan = cy.pan(); return { left: b.x1 * z + pan.x, top: b.y1 * z + pan.y, width: (b.x2 - b.x1) * z, height: (b.y2 - b.y1) * z }; };
    const updateDesignView = () => {
      const d = designRef.current;
      let slot: { id: string; left: number; top: number; width: number; height: number } | null = null, handle: { id: string; x: number; y: number } | null = null;
      const hovered = linkRef.current ? linkRef.current.sourceId : hoverCardRef.current;
      if (d && hovered) {
        const el = cy.getElementById(hovered);
        if (el.length && el.isNode() && !el.data('hiddenBox')) {
          const bb = el.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
          handle = { id: hovered, x: bb.x2, y: (bb.y1 + bb.y2) / 2 };
          for (let c: cytoscape.NodeSingular | null = el as unknown as cytoscape.NodeSingular; c && c.length && !linkRef.current; c = c.parent().length ? c.parent().first() as unknown as cytoscape.NodeSingular : null) {
            const box = d.slots[c.id()];
            if (box && !c.data('hiddenBox')) { slot = { id: c.id(), ...toStage(box) }; break; }
          }
        }
      }
      const draft = d?.draft ? toStage(d.draft.box) : null;
      const next = { slot, draft, handle };
      setDesignView(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    // Real user camera movement (pan, zoom, drag) is captured, debounced, and reported once it
    // settles. `programmatic` suppresses capture while this component itself writes pan/zoom
    // (restoring a saved camera, or the one-time initial fit) so a restore round trip can never
    // be mistaken for a fresh user gesture.
    let programmatic = false;
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    let mapFrame = 0;
    cy.on('pan zoom position', () => { if (!mapFrame) mapFrame = requestAnimationFrame(() => { mapFrame = 0; updateMap(); queueDirectionDraw(animationPhase.current,queuedPulse,true); }); });
    let cameraCallback = callbacks.current.onCameraChange;
    const flushCamera = () => {
      if (!debounceHandle) return;
      clearTimeout(debounceHandle); debounceHandle = null;
      cameraCallback({ zoom: cy.zoom(), pan: { ...cy.pan() } });
    };
    window.addEventListener('atlas:flush-camera', flushCamera);
    cy.on('pan zoom', () => {
      if (programmatic) return;
      if (debounceHandle) clearTimeout(debounceHandle);
      cameraCallback = callbacks.current.onCameraChange;
      debounceHandle = setTimeout(flushCamera, 180);
    });
    (cy as any).__setProgrammaticCamera = (fn: () => void) => { if(debounceHandle){clearTimeout(debounceHandle);debounceHandle=null;} programmatic = true; try { fn(); } finally { setTimeout(() => { programmatic = false; }, 0); } };
    // The quick-code buttons are drawn over the cards but take no pointer events (CSS), so a drag,
    // right-click, double-click or marquee that starts on that corner behaves exactly like the rest of
    // the card. A plain click is hit-tested here instead: inside the square it opens the code.
    // A programmatic tap (`node.emit('tap')`) carries no position and is never on the square.
    const cornerHit = (n: cytoscape.NodeSingular, p: Point | undefined): CornerHit | null => {
      // An ungrouped box draws no buttons (ADR 0011), so none can be hit.
      if (!p || n.data('hiddenBox')) return null;
      const inSquare = (right: number, top: number, size: number) => p.x >= right - size && p.x <= right && p.y >= top && p.y <= top + size;
      // The stack toggle is live only where it is drawn: the selected card, the hovered card, the root.
      const stack = stackButton(n.data());
      if (stackButtonIdsRef.current.has(n.id()) && stack.size * cy.zoom() >= MIN_CODE_BUTTON_PX) {
        const bb = n.boundingBox({ includeLabels: false, includeOverlays: false });
        if (inSquare(bb.x2 - stack.right, bb.y1 + stack.top, stack.size)) return 'stack';
      }
      if (n.data('expanded')) {
        // The design add slot (ADR 0015): the empty card space the box keeps for "+ class"/"+ method".
        const slot = designRef.current?.slots[n.id()];
        if (slot && p.x >= slot.x1 && p.x <= slot.x2 && p.y >= slot.y1 && p.y <= slot.y2) return 'add';
        if (CONTAINER_BUTTON.size * cy.zoom() < MIN_CODE_BUTTON_PX) return null;
        const bb = n.boundingBox({ includeLabels: false, includeOverlays: false });
        if (inSquare(bb.x2 - UNGROUP_BUTTON.right, bb.y1 + UNGROUP_BUTTON.top, UNGROUP_BUTTON.size)) return 'ungroup';
        return inSquare(bb.x2 - CONTAINER_BUTTON.inset, bb.y1 + CONTAINER_BUTTON.inset, CONTAINER_BUTTON.size) ? 'collapse' : null;
      }
      if (CODE_BUTTON.size * cy.zoom() < MIN_CODE_BUTTON_PX) return null;
      const c = n.position();
      return cornerButtons(n.data()).find(b => inSquare(c.x + n.width() / 2 - b.right, c.y - n.height() / 2 + b.top, b.size))?.action ?? null;
    };
    cy.on('mousemove', 'node', e => { const action = cornerHit(e.target, e.position); const key = action ? `${e.target.id()}:${action}` : null; setHotCorner(prev => prev === key ? prev : key); });
    cy.on('mouseout', 'node', () => { setHotCorner(null); setHoverCard(null); });
    cy.on('mouseover', 'node', e => setHoverCard(e.target.id()));
    // Ctrl/Cmd/Shift+click toggles a card in the multi-selection without inspecting it; a plain click inspects.
    const multiKey = (e: cytoscape.EventObject) => { const o = e.originalEvent as MouseEvent | undefined; return !!o && (o.ctrlKey || o.metaKey || o.shiftKey); };
    cy.on('tap', 'node', e => {
      if (multiKey(e)) { const id = e.target.id(); setHover(null); setMultiIds(ids => ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]); return; }
      // The model can briefly lag Cytoscape during reconciliation; a card that is gone has nothing to open.
      const node = currentModel.current.nodes.find(n => n.id === e.target.id());
      if (!node) return;
      // The second click of a two-click relation picks its target; nothing else happens on it.
      const link = linkRef.current;
      if (link) {
        endLink();
        const source = currentModel.current.nodes.find(n => n.id === link.sourceId);
        // The quick popup (ADR 0016) opens at the middle of the new relation: halfway between the two cards.
        const from = cy.getElementById(link.sourceId), to = e.target.renderedPosition();
        const mid = from.length ? { x: (from.renderedPosition().x + to.x) / 2, y: (from.renderedPosition().y + to.y) / 2 } : to;
        if (source && source.id !== node.id && designRef.current) designRef.current.onLink(source, node, clientOf(mid));
        return;
      }
      const corner = cornerHit(e.target, e.position);
      if (corner === 'add') { setContextMenu(null); designRef.current?.onAdd(node); return; }
      if (corner === 'code') { setContextMenu(null); callbacks.current.onViewCode(node); return; }
      if (corner === 'stack') { setContextMenu(null); callbacks.current.onCycleStack(node.id); return; }
      if (corner === 'ungroup') { setContextMenu(null); callbacks.current.onUngroup(node); return; }
      if (corner) { setContextMenu(null); callbacks.current.onToggleExpand(node); return; }
      callbacks.current.onNodeSelect(node);
    });
    // Step 4 disconnected double-click from level navigation (that was explore(), a leftover from
    // before View methods/View classes existed as named commands). Step 5 (Appendix B) gives it its
    // own dedicated ARRANGE_AROUND_RESOURCE command via Cytoscape's own `dbltap` gesture recognition
    // (H4): ordinary taps still reach `onNodeSelect` above without moving or unmounting the map;
    // `dbltap` fires in addition, once, on the second tap. App explicitly inspects the arranged resource,
    // because a repeated single tap now toggles inspection off.
    // In design mode (ADR 0015) double-click opens the explanation popover instead, anchored just above
    // and to the right of the card; the inspector's Arrange button still arranges.
    cy.on('dbltap', 'node', e => {
      if (multiKey(e)) return;
      const d = designRef.current;
      if (!d) { callbacks.current.onArrangeAroundResource(e.target.id()); return; }
      const node = currentModel.current.nodes.find(n => n.id === e.target.id());
      if (!node || e.target.data('hiddenBox') || cornerHit(e.target, e.position)) return;
      const bb = e.target.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
      d.onEdit({ node }, clientOf({ x: bb.x2, y: bb.y1 }));
    });
    cy.on('dbltap', 'edge', e => {
      const d = designRef.current, edge = currentModel.current.edges.find(x => x.id === e.target.id());
      if (!d || !edge || !(edge.design || edge.occurrenceIds?.some(id => id.startsWith('design-rel:')))) return;
      const o = e.originalEvent as MouseEvent | undefined;
      d.onEdit({ edge }, o ? { x: o.clientX, y: o.clientY } : clientOf(e.renderedPosition || { x: 0, y: 0 }));
    });
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
      const addedId=multiRef.current.includes(node.id)?null:node.id;
      setMultiIds(ids=>ids.includes(node.id)?ids:[...ids,node.id]);
      const position=e.renderedPosition || e.target.renderedPosition();
      setHover(null);
      menuOpenerRef.current=null;
      setContextMenu({node,addedId,...menuPosition(cy,position)});
    });
    // A plain right-click on empty canvas (no drag: cxttap) offers the design commands that need no card.
    cy.on('cxttap', e => {
      if (e.target !== cy || !designRef.current) return;
      (e.originalEvent as Event | undefined)?.preventDefault();
      setContextMenu(null); setHover(null);
      const p = e.renderedPosition || { x: cy.width() / 2, y: cy.height() / 2 };
      const m = e.position || { x: (p.x - cy.pan().x) / cy.zoom(), y: (p.y - cy.pan().y) / cy.zoom() };
      setCanvasMenu({ x: Math.max(8, Math.min(p.x, cy.width() - 238)), y: Math.max(8, Math.min(p.y, cy.height() - 120)), model: { x: m.x, y: m.y } });
    });
    cy.on('pan zoom tap cxttapstart', e => { if (e.type !== 'cxttapstart' || e.target !== cy) setCanvasMenu(null); });
    // A plain click on empty canvas clears the multi-selection, like most canvas editors.
    cy.on('tap', e => {
      if (e.target !== cy) return;
      // A click on empty canvas cancels a pending relation and does nothing else.
      if (linkRef.current) { endLink(); return; }
      if (!multiKey(e)) callbacks.current.onClearSelection();
    });

    // Ctrl/Cmd/Shift + left-drag on empty canvas: Cytoscape's own box gesture. With native selection
    // disabled it still reports every node in the box ('box', emitted synchronously right after
    // 'boxend'), so those ids are collected and added to the multi-selection once the gesture ends.
    const boxed = new Set<string>();
    cy.on('boxstart', () => boxed.clear());
    cy.on('box', 'node', e => { if (!e.target.data('hiddenBox')) boxed.add(e.target.id()); });
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
    const hits = (band: { x1: number; y1: number; x2: number; y2: number }) => cy.nodes('[!hiddenBox]').filter(n => {
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
      menuOpenerRef.current = null;
      setContextMenu({ node: null, ...menuPosition(cy, release) });
    });
    cy.on('mouseover', 'edge', e => {
      const edge = currentModel.current.edges.find(n=>n.id===e.target.id()); if(!edge)return;
      const a=currentModel.current.nodes.find(n=>n.id===edge.sourceId),b=currentModel.current.nodes.find(n=>n.id===edge.targetId);
      const position=e.renderedPosition || e.target.renderedMidpoint();
      const resolutions=(edge.resolutions||[edge.resolution]).map(r=>r.toLowerCase()).join(' + ');
      if(edge.design&&edge.design.origin!=='CODE'){
        setHover({ready:false,title:`${a?.simpleName} → ${b?.simpleName}`,description:`Designed ${kindSummary(edge)} (${edge.design.status.toLowerCase()}). ${edge.design.intent||'No explanation yet.'} Click to inspect.`,x:Math.max(12,Math.min(position.x,cy.width()-280)),y:Math.max(12,position.y-100)});
        return;
      }
      setHover({ready:edge.explanationStatus==='READY',title:`${a?.simpleName} → ${b?.simpleName}`,description:`${kindSummary(edge)} · ${edge.occurrenceCount||1} source occurrence(s) · ${resolutions}.${reviewRouteSummary(edge)} Click to inspect evidence.`,x:Math.max(12,Math.min(position.x,cy.width()-280)),y:Math.max(12,position.y-100)});
    });
    cy.on('mouseout pan zoom tap',()=>setHover(null));
    cy.on('pan zoom tap',()=>setContextMenu(null));
    // An expanded box's interior is not hit-tested like a card image, so a route drawn across its
    // collapse or stack square wins the tap over the box. A tap there acts on the box instead. Ordinary
    // card corners already win over routes through the node tap above, so a route crossing them still inspects.
    cy.on('tap', 'edge', e => {
      const p = e.position;
      const boxHit = (n: cytoscape.NodeSingular) => { const hit = p ? cornerHit(n, p) : null; return hit === 'collapse' || hit === 'ungroup' || hit === 'stack' ? hit : null; };
      const box = p && cy.nodes('[?expanded][!hiddenBox]').filter(n => boxHit(n) !== null).first();
      const node = box && box.length ? currentModel.current.nodes.find(m => m.id === box.id()) : undefined;
      if (node) {
        setContextMenu(null);
        const hit = boxHit(box as unknown as cytoscape.NodeSingular);
        if (hit === 'stack') callbacks.current.onCycleStack(node.id); else if (hit === 'ungroup') callbacks.current.onUngroup(node); else callbacks.current.onToggleExpand(node);
        return;
      }
      const edge = currentModel.current.edges.find(n => n.id === e.target.id()); if (edge) callbacks.current.onEdgeSelect(edge);
    });
    const canvas=container.current;
    const preventContextMenu=(event:MouseEvent)=>event.preventDefault();
    canvas.addEventListener('contextmenu',preventContextMenu);
    // Resize keeps the renderer's own dimensions in sync but never re-fits: a pane resize (narrow
    // screen swap, sidebar toggle) must not move the camera the user set. Skip on a transient
    // zero-size container so cy.resize() cannot corrupt pan/zoom.
    const observer = new ResizeObserver(() => { if (!container.current?.clientWidth || !container.current?.clientHeight) return; cy.resize(); updateMap(); queueDirectionDraw(animationPhase.current,queuedPulse,true); }); observer.observe(canvas);
    return () => { window.removeEventListener('atlas:flush-camera', flushCamera); canvas.removeEventListener('contextmenu',preventContextMenu); observer.disconnect(); if (debounceHandle) clearTimeout(debounceHandle); if (mapFrame) cancelAnimationFrame(mapFrame); if(directionFrame)cancelAnimationFrame(directionFrame); drawDirectionRef.current = () => {}; directionCanvas.remove(); cy.destroy(); cyRef.current = null; };
  }, []);

  // A card membership change closes the menu and drops selected cards that are no longer displayed.
  // Keyed on card IDs only: an edge or relationship-filter change leaves the menu's cards untouched.
  useEffect(()=>{
    setContextMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[nodesKey]);
  // App no longer remounts the canvas on undo/redo (it only remounts on tab switch), so this closes
  // the one gap that leaves open: transient pointer UI a restored state has no opinion about.
  useEffect(()=>{
    setContextMenu(null);setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[restoreVersion]);
  useLayoutEffect(()=>{
    const menu=menuRef.current,stage=menu?.offsetParent as HTMLElement|null;
    if(!contextMenu||!menu||!stage){setMenuTop(null);return;}
    const limit=stage.clientHeight-menu.offsetHeight-8;
    setMenuTop(contextMenu.y>limit?Math.max(8,limit):null);
  },[contextMenu]);
  useEffect(()=>{
    if(!contextMenu)return;
    const dismiss=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setContextMenu(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();setContextMenu(null);}};
    window.addEventListener('pointerdown',dismiss,true);window.addEventListener('keydown',escape,true);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return()=>{
      window.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('keydown',escape,true);
      // A keyboard-opened menu hands focus back to its opener when it closes (Escape or an item),
      // unless the user already moved focus elsewhere.
      const opener=menuOpenerRef.current,focused=document.activeElement;
      if(opener&&opener.isConnected&&(!focused||focused===document.body||menuRef.current?.contains(focused)))opener.focus();
    };
  },[contextMenu]);
  // Keyboard path to the card actions menu (docs/OUTGOING_STACK.md §Activation): Shift+F10 or the
  // ContextMenu key, on a focused corner button (its card) or with the page focused and a card
  // selected. It opens the same menu at the card, and never adds the card to the multi-selection.
  const selectedIdRef=useRef(selectedId); selectedIdRef.current=selectedId;
  useEffect(()=>{
    const stage=container.current?.parentElement;
    if(!stage)return;
    const open=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||!(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')))return;
      const cy=cyRef.current,focused=document.activeElement as HTMLElement|null;
      const fromButton=focused&&stage.contains(focused)?focused.closest<HTMLElement>('[data-card-id]')?.dataset.cardId:undefined;
      const id=fromButton??(!focused||focused===document.body||stage.contains(focused)?selectedIdRef.current:null);
      const node=id?currentModel.current.nodes.find(n=>n.id===id):undefined;
      const element=id&&cy?cy.getElementById(id):null;
      if(!cy||!node||!element||!element.length||node.hiddenBox)return;
      event.preventDefault();
      setHover(null);
      menuOpenerRef.current=fromButton&&focused?focused:null;
      setContextMenu({node,addedId:null,...menuPosition(cy,element.renderedPosition())});
    };
    // The keyboard gesture also raises the browser's own menu on the focused control.
    const suppress=(event:MouseEvent)=>{if(stage.contains(event.target as Node))event.preventDefault();};
    window.addEventListener('keydown',open);stage.addEventListener('contextmenu',suppress);
    return()=>{window.removeEventListener('keydown',open);stage.removeEventListener('contextmenu',suppress);};
  },[]);
  function menuKeyDown(event:ReactKeyboardEvent<HTMLDivElement>){
    const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')];
    if(!items.length)return;
    const at=items.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==='ArrowDown'?(at+1)%items.length:event.key==='ArrowUp'?(at<=0?items.length-1:at-1):event.key==='Home'?0:event.key==='End'?items.length-1:-1;
    if(next<0)return;
    event.preventDefault();items[next].focus();
  }
  useEffect(()=>{
    if(!marquee)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();cancelMarqueeRef.current();}};
    window.addEventListener('keydown',escape,true);
    return()=>window.removeEventListener('keydown',escape,true);
  },[marquee!==null]);
  // App handles ordinary Escape once, clearing inspection and multi-selection atomically.
  // Menu/marquee/resize handlers above consume it first when cancelling a transient gesture.
  // App owns browser fullscreen across canvas remounts. This stage supplies the fixed overlay;
  // ResizeObserver resizes its renderer without fitting, preserving the saved camera.
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
          // Cytoscape's data({ ... }) call merges keys. A shared display ID therefore keeps stale
          // review facts when Changes is turned off unless every optional review field is removed
          // explicitly before ordinary data is applied.
          for (const key of REVIEW_DATA_KEYS) if (!(key in data)) existing.removeData(key);
          existing.data(data);
          // A container's position is its children's bounds; writing it would drag every child along.
          if (!n.expanded || !existing.isParent()) {
            const cur = existing.position();
            if (cur.x !== pos.x || cur.y !== pos.y) { existing.position(pos); arranged = true; }
          }
        } else {
          // Cytoscape retains and mutates the object supplied to add(). History and cloned tabs
          // share immutable coordinates, so the renderer must receive its own copy.
          cy.add({ data: { ...data, ...(n.containerId ? { parent: n.containerId } : {}) }, position: { ...pos } });
        }
      }
      for (const e of edges) {
        const { design: _design, ...edgeRest } = e;
        const data = { ...edgeRest, designed: !!e.design&&e.design.origin!=='CODE', source: e.sourceId, target: e.targetId!, label: edgeLabel(e) };
        const existing = cy.getElementById(e.id);
        if (existing.length) {
          for (const key of REVIEW_DATA_KEYS) if (!(key in data)) existing.removeData(key);
          existing.data(data);
        }
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
    drawDirectionRef.current(undefined,undefined,true);
  }, [nodes, edges, positions, sizes, containerSizes]);

  // Multi-selection outline. Declared after reconciliation so a card added in the same commit already exists.
  useEffect(()=>{
    const cy=cyRef.current; if(!cy)return;
    cy.batch(()=>{cy.nodes('.multi-selected').removeClass('multi-selected');for(const id of multiIds)cy.getElementById(id).addClass('multi-selected');});
    drawDirectionRef.current(undefined,undefined,true);
  },[multiIds,nodes]);

  // Selection/inspection emphasis only: never a layout or fit call. Everything outside the selected
  // element's closed neighborhood is gently dimmed (.muted). Hidden edges contribute no neighbors
  // because they were never added to cy in the first place (filtered out by the caller).
  // - An inspected resource: route colors stay factual; moving dashes show source-to-target flow.
  //   Related resources get cyan, indigo, or left/right split halos by direction.
  //   A METHOD-level self-call is both directions on itself and gets no halo (it is the selection).
  // - An inspected edge: the edge itself (.inspected) and its endpoints (.neighbor), as before.
  // The flow classes replace the former fixed-width `.incident` emphasis: a route's width now carries
  // its occurrence strength (data(strengthWidth)), so emphasis only adds glow and direction marks.
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('inspected muted neighbor flow-out flow-in rel-out rel-in rel-both stack-root stack-member stack-in').removeStyle(ANIMATED_STYLES);
      // An ungrouped box is not on the map (ADR 0011): selected from the tree, search or Back, it is
      // treated like any undrawn subject, so nothing is lit or muted around an invisible card.
      const picked = selectedId ? cy.getElementById(selectedId) : cy.collection();
      const selected = picked.length && picked.data('hiddenBox') ? cy.collection() : picked;
      // A relation stack replaces the selection's neighborhood emphasis: the chain stays lit (its
      // routes with the selected-route dashes and a cyan underlay, indigo for an incoming stack;
      // dashes keep the factual source-to-target motion), the selection keeps only its
      // `inspected` look, and everything else is muted except containers of what is emphasized.
      if (outgoingStack) {
        // Covered cards sit inside a layered expanded box: part of the chain, but without badge or outline.
        const chain = cy.nodes().filter(n => outgoingStack.rootSet.has(n.id()) || outgoingStack.layers.has(n.id()) || outgoingStack.coveredIds.has(n.id()));
        const routes = cy.edges().filter(e => outgoingStack.chainEdgeIds.has(e.id()));
        // Every layer-0 card takes the root look, so the inside of an expanded root reads as the root
        // (docs/OUTGOING_STACK_REVIEW.md); the pressed toggle stays on the pinned root card only.
        chain.filter(n => outgoingStack.rootSet.has(n.id())).addClass('stack-root');
        const incoming = stackDirection === 'in';
        chain.filter(n => outgoingStack.layers.has(n.id())).addClass(incoming ? 'stack-member stack-in' : 'stack-member');
        routes.addClass(incoming ? 'flow-in' : 'flow-out');
        selected.addClass('inspected');
        const lit = chain.union(routes).union(selected).union(selected.connectedNodes());
        cy.elements().difference(lit.union(lit.nodes().ancestors())).addClass('muted');
        return;
      }
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
      });
      direct.nodes().difference(selected).forEach(node => {
        const id = node.id();
        node.addClass(outgoing.has(id) && incoming.has(id) ? 'rel-both' : outgoing.has(id) ? 'rel-out' : 'rel-in');
      });
    });
    // An ungrouped box draws nothing (ADR 0011): it never takes an emphasis look. The pulsing halo is a
    // style bypass, which would win over its stylesheet rule, so it must not be a halo target at all.
    cy.nodes('[?hiddenBox]').removeClass('inspected neighbor rel-out rel-in rel-both stack-root stack-member stack-in');
    drawDirectionRef.current(undefined,undefined,true);
  }, [selectedId, nodes, edges, outgoingStack, stackRootId, stackDirection]);

  // The moving glow: one requestAnimationFrame loop, only while a displayed resource is inspected (or an
  // outgoing stack is shown, with or without a selection) and has emphasized routes. Dash phase moves from source to target; route glow and halos pulse together. The phase
  // lives in a ref so a re-run caused by a graph poll replacing `edges` does not visibly restart it.
  // Animated values are element style bypasses, removed on every re-run and on unmount so none leak
  // into the next selection. Reduced-motion users keep the static colors without movement.
  useEffect(() => {
    const cy = cyRef.current; if (!cy || (!selectedId && !outgoingStack)) return;
    const flowEdges = cy.edges('.flow-out, .flow-in'), halos = cy.nodes('.rel-out, .rel-in');
    if (!flowEdges.length) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0, last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 33) return; // ~30 fps is smooth for dashes and keeps redraws cheap
      const elapsed = last ? Math.min(now - last, 100) : 33; last = now;
      animationPhase.current = (animationPhase.current + elapsed * .045) % 26000; // whole multiple of the dash period
      const pulse = (Math.sin(now / 420) + 1) / 2;
      cy.batch(() => {
        flowEdges.style({ 'line-dash-offset': -animationPhase.current, 'underlay-opacity': .28 + .12 * pulse });
        halos.style({ 'outline-opacity': .5 + .45 * pulse, 'outline-width': 5 + 4 * pulse });
      });
      cy.scratch('atlas:dashPhase', animationPhase.current);
      drawDirectionRef.current(animationPhase.current, pulse);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); if (!cy.destroyed()) { cy.batch(() => { flowEdges.removeStyle(ANIMATED_STYLES); halos.removeStyle(ANIMATED_STYLES); }); cy.scratch('atlas:dashPhase', 0); } drawDirectionRef.current(undefined,undefined,true); };
  }, [selectedId, nodes, edges, outgoingStack]);

  // Design overlays follow hover, slots and the draft card (ADR 0015); leaving design mode ends a pending relation.
  useEffect(()=>{updateMapRef.current();},[hoverCard,handleHold,design?.slots,design?.draft]);
  useEffect(()=>{if(!design)endLink();// eslint-disable-next-line react-hooks/exhaustive-deps
  },[!!design]);
  useEffect(()=>{
    if(!linkingId)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();endLink();}};
    window.addEventListener('keydown',onKey,true);
    return()=>window.removeEventListener('keydown',onKey,true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[linkingId]);

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
      callbacks.current.onCameraChange({ zoom: cy.zoom(), pan: { x: cy.pan().x, y: cy.pan().y } }, true);
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

  function zoom(factor: number) {
    const cy = cyRef.current; if (!cy) return;
    const apply = () => cy.zoom({level: cy.zoom() * factor, renderedPosition: {x: cy.width()/2, y: cy.height()/2}});
    const setProgrammatic = (cy as any).__setProgrammaticCamera as ((fn: () => void) => void) | undefined;
    if (setProgrammatic) setProgrammatic(apply); else apply();
    callbacks.current.onCameraChange({ zoom: cy.zoom(), pan: { ...cy.pan() } }, false, true);
  }
  function fit() { const cy = cyRef.current; if (cy && nodes.length) { cy.fit(undefined, 55); if (cy.zoom() > 1) { cy.zoom(1); cy.center(); } } }
  const menuNode=contextMenu?.node||null;
  const menuSelected=menuNode?selectedNodes.some(n=>n.id===menuNode.id):false;
  const menuHiddenAncestor=menuNode?hiddenAncestorOf(menuNode):null;
  // Expand/Collapse follows the right-clicked card's state and, when it is part of a multi-selection,
  // applies to every selected card that can make the same change.
  const menuGroup=menuNode&&menuSelected&&selectedNodes.length>1;
  const menuExpand:'expand'|'collapse'=menuNode?.expanded?'collapse':'expand';
  // A hidden (ungrouped) box is never a target: it has no card to collapse (its way back is "Collapse
  // into", step 14), and it is never drawn, so it is not in the selection either.
  const canToggle=(n:AtlasNode)=>!n.hiddenBox&&(menuExpand==='collapse'?!!n.expanded:!n.expanded&&hasDetailsButton(n));
  const expandTargets=menuNode&&canToggle(menuNode)?(menuGroup?selectedNodes.filter(canToggle):[menuNode]):[];
  // A single-card action is not a multi-select action: undo the selection this right-click added.
  function menuSingle(action:()=>void){const added=contextMenu?.addedId;if(added)setMultiIds(ids=>ids.filter(id=>id!==added));action();setContextMenu(null);}
  const menuTitle=selectedNodes.length>1?`${selectedNodes.length} resources selected`:(menuNode||selectedNodes[0])?.simpleName||'Selection';
  const slotNode=design&&designView.slot?nodes.find(n=>n.id===designView.slot!.id):null;
  const handleNode=design&&designView.handle?nodes.find(n=>n.id===designView.handle!.id):null;
  const linkSourceNode=linkingId?nodes.find(n=>n.id===linkingId):null;
  return <div className={`graph-stage${fullscreen?' fullscreen':''}${linkingId?' design-linking':''}`} onPointerMove={e=>{
      const link=linkRef.current;if(!link||!container.current)return;
      const r=container.current.getBoundingClientRect();link.pointer={x:e.clientX-r.left,y:e.clientY-r.top};drawDirectionRef.current();
    }}>
    <div ref={container} className="graph-canvas" aria-label="Dependency graph" />
    {slotNode&&designView.slot&&<div className={`design-slot${hotCorner===`${slotNode.id}:add`?' hot':''}`} data-slot-for={slotNode.id} aria-hidden="true" style={{left:designView.slot.left,top:designView.slot.top,width:designView.slot.width,height:designView.slot.height}}><span>＋ {slotKind(slotNode.kind)==='CLASS'?'class':'method'}</span></div>}
    {handleNode&&designView.handle&&<button type="button" className={`design-link-handle${linkingId?' active':''}`} data-card-id={handleNode.id} style={{left:designView.handle.x-10,top:designView.handle.y-10}} aria-label={`Draw a designed relation from ${handleNode.simpleName}: then click its target`} title="Draw a relation: click here, then click the target card" onPointerEnter={()=>setHandleHold(handleNode.id)} onPointerLeave={()=>setHandleHold(h=>h===handleNode.id?null:h)} onClick={event=>{event.stopPropagation();if(linkingId)endLink();else startLink(handleNode.id);setHandleHold(null);}}/>}
    {linkSourceNode&&<div className="design-link-hint" role="status">Relation from <strong>{linkSourceNode.simpleName}</strong>: click the target card · Esc cancels</div>}
    {design?.draft&&designView.draft&&<DesignDraftInput key={`${design.draft.kind}:${Math.round(design.draft.box.x1)}:${Math.round(design.draft.box.y1)}`} rect={designView.draft} draft={design.draft} onCommit={design.onDraftCommit} onCancel={design.onDraftCancel}/>}
    {cornerOverlays.map(b=>{
      const n=nodes.find(item=>item.id===b.id);if(!n)return null;
      const hot=hotCorner===`${b.id}:${b.action}`?' hot':'',style={left:b.left,top:b.top,width:b.size,height:b.size,fontSize:Math.max(10,b.size*.5)};
      if(b.action==='stack'){
        if(!stackButtonIds.has(b.id))return null;
        // Three states on the root: outgoing, then incoming, then off. The label names what a press does.
        const on=stackRootId===b.id,incoming=on&&stackDirection==='in';
        const label=!on?`Show outgoing stack of ${n.simpleName}`:incoming?`Hide incoming stack of ${n.simpleName}`:`Show incoming stack of ${n.simpleName}`;
        const title=!on||!outgoingStack?'Show outgoing stack: what this sets in motion, layer by layer':`${stackSummary(outgoingStack,stackDirection)}${incoming?' (click to hide)':' (click for incoming)'}`;
        return <button key={`${b.id}:stack`} type="button" className={`code-button map-code-button map-stack-button${on?' active':''}${incoming?' incoming':''}${hot}`} style={style} aria-pressed={on} aria-label={label} title={title} data-card-id={b.id} data-stack-direction={on?stackDirection:undefined} onFocus={()=>setFocusedStackId(b.id)} onBlur={()=>setFocusedStackId(id=>id===b.id?null:id)} onClick={event=>{event.stopPropagation();setContextMenu(null);onCycleStack(n.id);}}><StackIcon/></button>;
      }
      if(b.action==='code')return <CodeButton key={`${b.id}:code`} cardId={b.id} name={n.simpleName} kind={n.kind} className={`map-code-button${hot}`} style={style} onClick={()=>{setContextMenu(null);onViewCode(n);}}/>;
      if(b.action==='ungroup')return <button key={`${b.id}:ungroup`} type="button" data-card-id={b.id} data-action="ungroup" className={`code-button map-code-button map-ungroup-button${hot}`} style={style} aria-label={`Ungroup ${n.simpleName}`} title={`Ungroup: remove the box and keep its ${n.kind==='PACKAGE'?'types':'methods'} as free cards`} onClick={event=>{event.stopPropagation();setContextMenu(null);onUngroup(n);}}><UngroupIcon/></button>;
      const collapse=b.action==='collapse',what=n.kind==='PACKAGE'?'types':'methods';
      // Stable key across the details<->collapse flip (WCAG 2.1 SC 2.4.3): `b.action` changes when the
      // card expands, so keying on it unmounted the very button the user just pressed and focus fell
      // back to document.body, losing their place. It is the same control either way -- only its label
      // and icon change -- so React must reconcile it in place and keep focus on it.
      return <button key={`${b.id}:details-toggle`} type="button" data-card-id={b.id} className={`code-button map-code-button map-details-button${hot}`} style={style} aria-expanded={collapse} aria-label={collapse?`Collapse ${n.simpleName}`:`Show ${what} inside ${n.simpleName}`} title={collapse?'Collapse':`Show ${what} and their relationships`} onClick={event=>{event.stopPropagation();setContextMenu(null);onToggleExpand(n);}}><DetailsIcon expanded={collapse}/></button>;
    })}
    {resizeGrips.map(g=>{const n=nodes.find(item=>item.id===g.id);return n?<button key={g.id} type="button" className="map-resize-grip" title={`Resize ${n.simpleName}`} aria-label={`Resize ${n.simpleName}. Use arrow keys, hold Shift for larger steps.`} style={{left:g.left,top:g.top,width:g.size,height:g.size}} onPointerDown={e=>startResize(e,g.id)} onKeyDown={e=>gripKeyDown(e,g.id)}/>:null;})}
    {!nodes.length && <div className="canvas-empty">No symbols in this view. Choose another level or clear the filter.</div>}
    {hover&&<div className="edge-hover" style={{left:hover.x,top:hover.y}}><strong>{hover.ready&&<GeminiBadge/>} {hover.title}</strong><p>{hover.description}</p></div>}
    {contextMenu&&<div ref={menuRef} className="graph-context-menu" role="menu" onKeyDown={menuKeyDown} aria-label={selectedNodes.length>1?`Actions for ${selectedNodes.length} selected resources`:`Actions for ${menuTitle}`} style={{left:contextMenu.x,top:menuTop??contextMenu.y}}>
      <div className="graph-context-menu-heading">{menuTitle}</div>
      <button role="menuitem" className="danger" disabled={!removableNodes.length} title={removalTitle} onClick={removeSelectedFromScope}><span aria-hidden="true">−</span> {removalLabel}</button>
      {menuNode&&menuSelected&&selectedNodes.length>1&&<button role="menuitem" onClick={()=>{setMultiIds(ids=>ids.filter(id=>id!==menuNode.id));setContextMenu(null);}}><span aria-hidden="true">○</span> Deselect {menuNode.simpleName}</button>}
      {menuNode&&(['out','in'] as const).map(direction=>{
        const on=stackRootId===menuNode.id&&stackDirection===direction,name=direction==='in'?'incoming':'outgoing';
        // Rooting a stack is not a multi-select action: menuSingle undoes the selection this right-click added.
        return <button key={direction} role="menuitem" aria-pressed={on} onClick={()=>menuSingle(()=>onToggleStack(menuNode.id,direction))}><span aria-hidden="true">{direction==='in'?'⇇':'⇶'}</span> {on?`Hide ${name} stack`:`Show ${name} stack`}</button>;})}
      {expandTargets.length>0&&<button role="menuitem" onClick={()=>{if(menuGroup){onToggleExpandMany(expandTargets,menuExpand);setContextMenu(null);}else menuSingle(()=>onToggleExpandMany(expandTargets,menuExpand));}}><span aria-hidden="true">{menuExpand==='expand'?'⊞':'⊟'}</span> {menuExpand==='expand'?'Expand':'Collapse'}{expandTargets.length>1?` ${expandTargets.length} selected`:''}</button>}
      {menuNode&&menuNode.expanded&&!menuNode.hiddenBox&&<button role="menuitem" onClick={()=>{setContextMenu(null);onUngroup(menuNode);}}><span aria-hidden="true">⬚</span> Ungroup {menuNode.simpleName}</button>}
      {/* Distinct from Collapse above: it brings back the nearest ungrouped box this card sits in. */}
      {menuHiddenAncestor&&<button role="menuitem" onClick={()=>menuSingle(()=>onCollapseInto(menuHiddenAncestor))}><span aria-hidden="true">⊟</span> Collapse into {menuHiddenAncestor.simpleName}</button>}
      {menuNode&&hasCodeButton(menuNode)&&!(menuNode.design&&!menuNode.design.codeId)&&<button role="menuitem" onClick={()=>menuSingle(()=>onViewCode(menuNode))}><span aria-hidden="true">{'</>'}</span> View source</button>}
      {menuNode&&design&&!menuGroup&&<>
        {menuNode.kind==='PACKAGE'&&<>
          <button role="menuitem" className="design-menuitem" onClick={()=>menuSingle(()=>design.onAdd(menuNode,'CLASS'))}><span aria-hidden="true">＋</span> Add class</button>
          <button role="menuitem" className="design-menuitem" onClick={()=>menuSingle(()=>design.onAdd(menuNode,'INTERFACE'))}><span aria-hidden="true">＋</span> Add interface</button>
          <button role="menuitem" className="design-menuitem" onClick={()=>menuSingle(()=>design.onOpenDialog('add-child',menuNode))}><span aria-hidden="true">＋</span> Add other type…</button>
        </>}
        {!['PACKAGE','METHOD','CONSTRUCTOR','FIELD'].includes(menuNode.kind)&&<>
          <button role="menuitem" className="design-menuitem" onClick={()=>menuSingle(()=>design.onAdd(menuNode,'METHOD'))}><span aria-hidden="true">＋</span> Add method</button>
          <button role="menuitem" className="design-menuitem" onClick={()=>menuSingle(()=>design.onOpenDialog('add-child',menuNode))}><span aria-hidden="true">＋</span> Add nested type…</button>
        </>}
        <button role="menuitem" className="design-menuitem" onClick={()=>menuSingle(()=>startLink(menuNode.id))}><span aria-hidden="true">⤳</span> Draw relation from here</button>
        <button role="menuitem" className="design-menuitem" onClick={()=>{const at=clientOf({x:contextMenu!.x,y:contextMenu!.y});menuSingle(()=>design.onEdit({node:menuNode},at));}}><span aria-hidden="true">✎</span> {menuNode.design?.origin==='AUTHORED'?'Edit design…':menuNode.design?.explanation?'Edit explanation…':'Explain intent…'}</button>
      </>}
      <button role="menuitem" onClick={()=>{onClearSelection();setContextMenu(null);}}><span aria-hidden="true">✕</span> {selectedNodes.length>1?'Clear selection':'Deselect'}</button>
      <p className="graph-context-menu-hint">Right-click or right-drag over more cards to add them. Drag any selected card to move the group.</p>
    </div>}
    {canvasMenu&&design&&<div className="graph-context-menu" role="menu" aria-label="Map actions" style={{left:canvasMenu.x,top:canvasMenu.y}} onKeyDown={e=>{if(e.key==='Escape')setCanvasMenu(null);}}>
      <div className="graph-context-menu-heading">Design</div>
      <button role="menuitem" className="design-menuitem" autoFocus onClick={()=>{setCanvasMenu(null);design.onAddPackageAt(canvasMenu.model);}}><span aria-hidden="true">＋</span> Add package</button>
      <button role="menuitem" className="design-menuitem" onClick={()=>{setCanvasMenu(null);design.onOpenDialog('add-relation',null);}}><span aria-hidden="true">⤳</span> Add relation by key…</button>
      <button role="menuitem" onClick={()=>setCanvasMenu(null)}><span aria-hidden="true">✕</span> Close</button>
    </div>}
    {selectedNodes.length>0&&<div className="selection-bar" role="toolbar" aria-label="Selected resources"><strong>{selectedNodes.length} selected</strong><button className="danger" disabled={!removableNodes.length} title={removalTitle} onClick={removeSelectedFromScope}>{removalLabel}</button><button onClick={onClearSelection}>Clear</button></div>}
    {marquee&&<div className="graph-marquee" aria-hidden="true" style={{left:marquee.x1,top:marquee.y1,width:marquee.x2-marquee.x1,height:marquee.y2-marquee.y1}}/>}
    <div className="canvas-hint">Arrows point from caller to dependency · right-drag or Ctrl+click to select several</div>
    <div className="zoom-controls"><button onClick={() => zoom(1.2 ** 3)} aria-label="Zoom in">+</button><span>{Math.round((mini?.zoom || 1)*100)}%</span><button onClick={() => zoom(1/(1.2 ** 3))} aria-label="Zoom out">−</button><button onClick={fit} aria-label="Fit map" title="Fit map"><span aria-hidden="true" className="control-icon">⤧</span><span className="control-text">Fit map</span></button><button onClick={() => setFullscreen(!fullscreen)} aria-pressed={fullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title={fullscreen ? 'Exit full screen (Esc)' : 'Show the map full screen'}><span aria-hidden="true">{fullscreen ? '⤡' : '⤢'}</span><span className="control-text">{fullscreen ? ' Exit full screen' : ' Full screen'}</span></button></div>
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

/** Where the card actions menu opens: at the pointer (or the card's center), kept inside the canvas. */
function menuPosition(cy: cytoscape.Core, position: Point) {
  return { x: Math.max(8, Math.min(position.x, cy.width() - 238)), y: Math.max(8, Math.min(position.y, cy.height() - 150)) };
}

/** Four cards whose surrounding box is broken open: the Ungroup button. */
function UngroupIcon() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>
    <path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z"/>
  </svg>;
}

/** Three stacked, right-pointing layers: the outgoing-stack toggle. */
function StackIcon() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="6" height="16" rx="1.5"/><path d="M11 8h4M11 16h4M15 6l3 2-3 2M15 14l3 2-3 2"/><rect x="19" y="5" width="2" height="14" rx="1" fill="currentColor" stroke="none"/>
  </svg>;
}

/** Expand (a grid inside a box) or collapse (a box with a minus) glyph for the details button. */
function DetailsIcon({ expanded }: { expanded: boolean }) {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3"/>
    {expanded ? <path d="M8 12h8"/> : <path d="M7.5 7.5h3v3h-3zM13.5 7.5h3v3h-3zM7.5 13.5h3v3h-3zM13.5 13.5h3v3h-3z"/>}
  </svg>;
}

/**
 * A new card typed in place (ADR 0015): the title field is focused at once. Enter commits, Esc or
 * leaving it empty cancels; a rejected name stays with the server's message under it.
 */
function DesignDraftInput({ rect, draft, onCommit, onCancel }: { rect: { left: number; top: number; width: number; height: number }; draft: DesignDraftCard; onCommit: (text: string, anchor: Point) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null), card = useRef<HTMLDivElement>(null);
  const corner = (): Point => { const r = card.current?.getBoundingClientRect(); return { x: r?.right ?? 0, y: r?.top ?? 0 }; };
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const kindWord = draft.kind.toLowerCase();
  return <div ref={card} className={`design-draft-card${draft.error ? ' invalid' : ''}`} data-draft-kind={draft.kind} style={{ left: rect.left, top: rect.top, width: Math.max(200, rect.width), minHeight: Math.max(76, rect.height) }}
    onPointerDown={e => e.stopPropagation()}>
    <span className="design-draft-kind">New {kindWord}</span>
    <input ref={input} value={text} disabled={draft.busy} placeholder={draft.placeholder} aria-label={`Name of the new ${kindWord}`} aria-invalid={!!draft.error}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); if (text.trim()) onCommit(text, corner()); }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={() => { if (!text.trim() && !draft.busy) onCancel(); }}/>
    {draft.error ? <p className="design-draft-error" role="alert">{draft.error}</p> : <p className="design-draft-hint">Enter to add · Esc to cancel</p>}
  </div>;
}
