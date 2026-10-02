import type { AtlasEdge, AtlasGraph, AtlasNode } from '../explorer/graphModel';
import type { DesignOperation } from '../../api/client';

/**
 * The engineer-owned design layer (ADR 0014) on the ordinary code map. Pure: no runtime imports, so
 * scripts/test-design-model.mjs can transpile and run it on its own.
 *
 * The backend keys every design item by the parser's stable key (qualified name). Merging it into a
 * snapshot graph has three cases:
 * - an item whose key is parsed code (an explanation on existing code, or a designed resource the
 *   code now implements) annotates that parsed card through `design`;
 * - a designed resource not in the code (PLANNED), or an imported reference the code lacks (MISSING),
 *   becomes its own card with the display ID `design:<key>`;
 * - a designed relation becomes a route with resolution DESIGNED between whatever cards its
 *   endpoints resolve to, kept apart from parser routes by aggregateEdges.
 */
export type DesignStatus = 'PLANNED' | 'IMPLEMENTED' | 'PRESENT' | 'MISSING' | 'ORPHANED';
export interface DesignResource {
  id: string; key: string; kind: string; name: string; parentKey?: string | null; parameterTypes?: string[] | null;
  signature?: string | null; origin: 'AUTHORED' | 'CODE'; status: DesignStatus; explanation: string; intent: string;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; revision: number;
  codeId?: string | null; parentCodeId?: string | null;
  /** Spring roles of an imported reference to code (ADR 0016), so it is drawn like the original card. */
  roles?: string[] | null;
}
/** `origin` AUTHORED: a relation drawn as design. CODE: a parsed dependency carried along (ADR 0016), an
 * explanation on a relation the code has or an imported one the code lacks; it is drawn as an ordinary route. */
export interface DesignRelation {
  id: string; sourceKey: string; targetKey: string; kind: string; resolution: 'DESIGNED' | 'CODE'; status: DesignStatus; origin?: 'AUTHORED' | 'CODE';
  explanation: string; intent: string; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; revision: number;
  sourceCodeId?: string | null; targetCodeId?: string | null;
}
export interface DesignOverlay { schemaVersion: string; workspaceId: string; snapshotId: string | null; resources: DesignResource[]; relations: DesignRelation[] }

export const DESIGN_NODE_PREFIX = 'design:';
export const DESIGN_EDGE_PREFIX = 'design-rel:';
export const designNodeId = (key: string) => DESIGN_NODE_PREFIX + key;
export const isDesignNodeId = (id: string) => id.startsWith(DESIGN_NODE_PREFIX);
export const TYPE_KINDS = ['CLASS', 'INTERFACE', 'ENUM', 'RECORD', 'ANNOTATION'];
export const MEMBER_KINDS = ['METHOD', 'CONSTRUCTOR'];
export const RELATION_KINDS = ['CALLS', 'DEPENDS_ON', 'USES_TYPE', 'INJECTS', 'CONSTRUCTS', 'EXTENDS', 'IMPLEMENTS', 'OVERRIDES', 'READS_FIELD', 'WRITES_FIELD', 'DECLARES_BEAN', 'HANDLES_ROUTE'];

/** A card's stable key: the parser's qualified name, or a design card's own key. */
export const keyOf = (n: AtlasNode) => n.design?.key || n.qualifiedName || n.simpleName;

/** A card that exists only in the design layer (planned, or an imported reference absent from the code). */
export const isDesignOnly = (n: AtlasNode) => !!n.design && !n.design.codeId;
/** An imported reference to code this project lacks (ADR 0016): drawn like the original card, tagged "imported". */
export const isImported = (n: AtlasNode) => isDesignOnly(n) && n.design!.origin === 'CODE';
/** A relation the engineer drew as design (not a parsed dependency carried along): its own violet route. */
export const isDesignedRelation = (e: AtlasEdge) => !!e.design && e.design.origin !== 'CODE';

/** First paragraph of an explanation: by convention the intent. */
export function intentOf(explanation: string | null | undefined): string {
  const text = (explanation || '').trim();
  const blank = text.search(/\n\s*\n/);
  return (blank < 0 ? text : text.slice(0, blank)).replace(/\s+/g, ' ').trim();
}
/** Everything after the intent paragraph. */
export function detailOf(explanation: string | null | undefined): string {
  const text = (explanation || '').trim();
  const blank = text.search(/\n\s*\n/);
  return blank < 0 ? '' : text.slice(blank).trim();
}

/** A method card's display name, `name(Types)`, so overloads stay distinguishable. An imported reference to
 * code is named as the parser names it (ADR 0016), so it reads like the original card. */
function displayName(r: DesignResource): string {
  if (r.origin === 'CODE') return r.name;
  if (MEMBER_KINDS.includes(r.kind)) return `${r.name}(${(r.parameterTypes || []).join(', ')})`;
  return r.name;
}

/**
 * The snapshot graph with the design layer merged in. Returns `graph` itself when there is nothing
 * to merge, so an empty design layer never changes graph identity.
 */
export function mergeDesignGraph(graph: AtlasGraph, overlay: DesignOverlay | null | undefined): AtlasGraph {
  if (!overlay || (!overlay.resources.length && !overlay.relations.length)) return graph;
  const parsedIds = new Set(graph.nodes.map(n => n.id));
  const byKey = new Map(overlay.resources.map(r => [r.key, r]));
  const annotate = new Map<string, DesignResource>();
  const added: AtlasNode[] = [];
  const idOfKey = (key: string | null | undefined, codeId?: string | null): string | undefined => {
    if (codeId && parsedIds.has(codeId)) return codeId;
    if (!key) return undefined;
    const r = byKey.get(key);
    if (!r) return undefined;
    return r.codeId && parsedIds.has(r.codeId) ? r.codeId : designNodeId(key);
  };
  for (const r of overlay.resources) {
    if (r.codeId && parsedIds.has(r.codeId)) { annotate.set(r.codeId, r); continue; }
    const design = { ...r, codeId: null };
    added.push({
      id: designNodeId(r.key), kind: r.kind, simpleName: displayName(r), qualifiedName: r.key,
      parentId: idOfKey(r.parentKey, r.parentCodeId), explanationStatus: 'NOT_REQUESTED',
      responsibilitySummary: r.intent || undefined, design, ...(r.origin === 'CODE' && r.roles?.length ? { roles: [...r.roles] } : {}),
    });
  }
  const nodes = annotate.size ? graph.nodes.map(n => annotate.has(n.id) ? { ...n, design: annotate.get(n.id) } : n) : [...graph.nodes];
  nodes.push(...added);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges: AtlasEdge[] = [...graph.edges];
  for (const rel of overlay.relations) {
    const sourceId = idOfKey(rel.sourceKey, rel.sourceCodeId), targetId = idOfKey(rel.targetKey, rel.targetCodeId);
    if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;
    // A carried parsed dependency (origin CODE) is an ordinary route: aggregateEdges merges it with the
    // parser's route between the same cards, and it is drawn grey like the map it came from.
    const carried = rel.origin === 'CODE';
    edges.push({
      id: DESIGN_EDGE_PREFIX + rel.id, sourceId, targetId, kind: rel.kind, resolution: carried ? 'CODE' : 'DESIGNED',
      descriptiveLabel: rel.kind.toLowerCase().replaceAll('_', ' '), hoverSummary: rel.intent, explanationStatus: 'NOT_REQUESTED', design: rel,
    });
  }
  return { ...graph, nodes, edges };
}

/**
 * Two graphs' cards and routes as one parked graph (ADR 0015): the Changes overlay's hidden cards and,
 * while Design is off, the design cards. The first graph wins an ID both carry.
 */
export function unionGraphs(a: AtlasGraph | undefined, b: AtlasGraph | undefined): AtlasGraph | undefined {
  if (!a || !b || a === b) return a || b;
  const ids = new Set(a.nodes.map(n => n.id)), edgeIds = new Set(a.edges.map(e => e.id));
  return { ...a, nodes: [...a.nodes, ...b.nodes.filter(n => !ids.has(n.id))], edges: [...a.edges, ...b.edges.filter(e => !edgeIds.has(e.id))] };
}

/** The design relations behind a drawn (possibly aggregated) route. */
export function relationsOfRoute(edge: AtlasEdge, overlay: DesignOverlay | null | undefined): DesignRelation[] {
  if (!overlay) return [];
  const ids = (edge.occurrenceIds?.length ? edge.occurrenceIds : [edge.id]).filter(id => id.startsWith(DESIGN_EDGE_PREFIX)).map(id => id.slice(DESIGN_EDGE_PREFIX.length));
  return overlay.relations.filter(r => ids.includes(r.id));
}

/** The parser's key for a new child, mirroring the backend (DesignKeys.key). */
export function childKey(kind: string, parentKey: string | null, name: string, parameterTypes: string[] = []): string {
  const n = name.trim();
  if (kind === 'PACKAGE') return n;
  if (TYPE_KINDS.includes(kind)) return !parentKey || parentKey === '(default)' ? n : `${parentKey}.${n}`;
  return `${parentKey}.${n}(${parameterTypes.map(p => p.trim()).join(',')})`;
}

/** Which kinds may be added inside a card of this kind. */
export function childKindsFor(kind: string | null): string[] {
  if (kind === null) return ['PACKAGE'];
  if (kind === 'PACKAGE') return TYPE_KINDS;
  if (TYPE_KINDS.includes(kind)) return [...MEMBER_KINDS, ...TYPE_KINDS];
  return [];
}

/** Splits "Long id, List<String> names" or "Long, String" into parameter types. Generic commas stay inside their type. */
export function parseParameterTypes(text: string): string[] {
  const out: string[] = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '<') depth++;
    if (ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(current); current = ''; } else current += ch;
  }
  if (current.trim() || out.length) out.push(current);
  return out.map(p => p.trim()).filter(Boolean).map(p => {
    // "List<String> names" -> "List<String>": drop a trailing parameter name when one is given.
    const m = p.match(/^(.*[>\]\w])\s+[A-Za-z_$][\w$]*$/);
    return m ? m[1].trim() : p;
  });
}

/** Joins an intent and its details back into one explanation (the inverse of intentOf/detailOf). */
export function joinExplanation(intent: string, details: string): string {
  const i = intent.replace(/\s+/g, ' ').trim(), d = details.trim();
  return i && d ? `${i}\n\n${d}` : i || d;
}

/** What an inline title on a new card means: a name and, for a member, `name(Type, Type)` parameter types. */
export interface InlineName { name: string; kind: string; parameterTypes: string[] }
/**
 * Reads the title typed on a new inline card. `kind` is the card's kind; a METHOD named after its
 * owning type becomes a CONSTRUCTOR. Returns an error message instead when the text cannot be a name.
 */
export function parseInlineName(text: string, kind: string, ownerSimpleName: string | null = null): InlineName | string {
  const t = text.trim();
  if (!t) return 'Type a name';
  if (MEMBER_KINDS.includes(kind)) {
    const m = t.match(/^([A-Za-z_$][\w$]*)\s*(?:\((.*)\))?$/s);
    if (!m) return 'Write a method as name or name(Type, Type)';
    const name = m[1], parameterTypes = parseParameterTypes(m[2] || '');
    return { name, kind: ownerSimpleName && name === ownerSimpleName ? 'CONSTRUCTOR' : 'METHOD', parameterTypes };
  }
  if (kind === 'PACKAGE') return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(t) ? { name: t, kind, parameterTypes: [] } : 'Write a package as a dotted name, e.g. com.acme.billing';
  return /^[A-Za-z_$][\w$]*$/.test(t) ? { name: t, kind, parameterTypes: [] } : 'A type name is one identifier, e.g. InvoiceService';
}

/** The kind of a relation drawn with two clicks (ADR 0016): always CALLS; the quick popup changes it. */
export function defaultRelationKind(_sourceKind?: string, _targetKind?: string): string {
  return 'CALLS';
}

/** The change set that creates one resource under `parentKey` (null: a package on the map). */
export function createResourceOps(parentKey: string | null, parsed: InlineName, explanation = ''): DesignOperation[] {
  const member = MEMBER_KINDS.includes(parsed.kind);
  return [{ op: 'putResource', kind: parsed.kind, parentKey, name: parsed.name, ...(member ? { parameterTypes: parsed.parameterTypes } : {}), explanation }];
}
/** The change set that sets a card's explanation: parsed code takes it as a CODE explanation, an authored card is updated. */
export function explainOps(node: AtlasNode, explanation: string): DesignOperation[] {
  const key = keyOf(node);
  return node.design?.origin === 'AUTHORED' ? [{ op: 'updateResource', key, explanation }] : [{ op: 'putResource', key, explanation }];
}
/** The change set that creates or edits one relation; a changed kind replaces the old record (kind is part of its identity). */
export function relationOps(sourceKey: string, targetKey: string, kind: string, explanation: string, previousKind?: string | null): DesignOperation[] {
  const ops: DesignOperation[] = [];
  if (previousKind && previousKind !== kind) ops.push({ op: 'deleteRelation', sourceKey, targetKey, kind: previousKind });
  ops.push({ op: 'putRelation', sourceKey, targetKey, kind, explanation });
  return ops;
}

/** Layout of a tab keyed by stable keys, so it can be re-applied to a different snapshot's IDs. */
export interface MapLayout {
  version: 1;
  scope: { mode: 'ALL' | 'CUSTOM'; packageKeys: string[]; classKeys: string[] };
  positions: Record<string, { x: number; y: number }>;
  /** `minSize`: a box the user resized larger (its inner minimum); absent when it was never resized. */
  expansions: Record<string, { ownerKey: string | null; hidden?: boolean; minSize?: { width: number; height: number }; childPositions: Record<string, { x: number; y: number }> }>;
  sizes: Record<string, { width: number; height: number }>;
  camera: { zoom: number; pan: { x: number; y: number } } | null;
  kind: string;
}

/**
 * Splits what App holds for cards typed in place but not on the map yet (ADR 0015 pins, ADR 0017 growth),
 * keyed by the new card's node id, into the entries the graph about to be reconciled now holds, and the
 * rest. An entry is used only by the reconciliation that actually admits its card: an unrelated one (the
 * agent overlay poll landing while the create request is still in flight) keeps it for later. A create
 * that fails removes its entry (commitInlineDraft), so nothing is ever applied to a card that was not created.
 */
export function takeAdmitted<T>(pending: Record<string, T>, admitted: (id: string) => boolean): { taken: Record<string, T>; kept: Record<string, T> } {
  const taken: Record<string, T> = {}, kept: Record<string, T> = {};
  for (const [id, value] of Object.entries(pending)) (admitted(id) ? taken : kept)[id] = value;
  return { taken, kept };
}
