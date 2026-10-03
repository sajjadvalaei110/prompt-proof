import type { AtlasGraph } from '../explorer/graphModel';
import type { ExplorerViewState, LevelViewState } from '../explorer/explorerViewState';
import type { ScopeSelection } from '../explorer/scopeModel';
import type { MapLayout } from './designModel';

/**
 * Map layout for the design brief (ADR 0014), keyed by stable keys instead of snapshot IDs so the
 * same map can be rebuilt in another workspace or after re-analysis. Pure, type-only imports, so
 * scripts/test-design-exchange.mjs runs it without a bundler.
 */
const keyMap = (graph: AtlasGraph) => {
  const keyOfId = new Map<string, string>(), idOfKey = new Map<string, string>();
  for (const n of graph.nodes) {
    const key = n.design?.key || n.qualifiedName || n.simpleName;
    keyOfId.set(n.id, key);
    if (!idOfKey.has(key)) idOfKey.set(key, n.id);
  }
  return { keyOfId, idOfKey };
};

/** The package-level view, scope and filter of one tab, keyed by stable keys. */
export function captureLayout(view: ExplorerViewState, scope: ScopeSelection, kind: string, graph: AtlasGraph): MapLayout {
  const { keyOfId } = keyMap(graph);
  const level: LevelViewState = view.levelViews.PACKAGE;
  const k = (id: string) => keyOfId.get(id);
  const positions: MapLayout['positions'] = {};
  for (const id of level.displayedIds) { const key = k(id), p = level.positions[id]; if (key && p) positions[key] = { x: p.x, y: p.y }; }
  const expansions: MapLayout['expansions'] = {};
  for (const [id, e] of Object.entries(level.expansions)) {
    const key = k(id);
    if (!key) continue;
    const childPositions: Record<string, { x: number; y: number }> = {};
    for (const [child, p] of Object.entries(e.childPositions)) { const ck = k(child); if (ck) childPositions[ck] = { x: p.x, y: p.y }; }
    expansions[key] = { ownerKey: e.ownerId ? k(e.ownerId) ?? null : null, ...(e.hidden ? { hidden: true } : {}), ...(e.minSize ? { minSize: { width: e.minSize.width, height: e.minSize.height } } : {}), childPositions };
  }
  const sizes: MapLayout['sizes'] = {};
  for (const [id, s] of Object.entries(level.sizes)) { const key = k(id); if (key) sizes[key] = { width: s.width, height: s.height }; }
  return {
    version: 1,
    scope: { mode: scope.mode, packageKeys: [...scope.selectedPackageIds].map(k).filter((x): x is string => !!x).sort(), classKeys: [...scope.selectedClassIds].map(k).filter((x): x is string => !!x).sort() },
    positions, expansions, sizes,
    camera: level.camera ? { zoom: level.camera.zoom, pan: { x: level.camera.pan.x, y: level.camera.pan.y } } : null,
    kind,
  };
}

/** The scope a layout names, resolved to this graph's IDs (keys the graph lacks are dropped). */
export function scopeFromLayout(layout: MapLayout, graph: AtlasGraph): ScopeSelection {
  if (!layout.scope || layout.scope.mode !== 'CUSTOM') return { mode: 'ALL', selectedPackageIds: new Set(), selectedClassIds: new Set() };
  const { idOfKey } = keyMap(graph);
  const ids = (keys: string[]) => new Set(keys.map(key => idOfKey.get(key)).filter((x): x is string => !!x));
  return { mode: 'CUSTOM', selectedPackageIds: ids(layout.scope.packageKeys || []), selectedClassIds: ids(layout.scope.classKeys || []) };
}

/**
 * `base` (a fresh view whose PACKAGE level already admitted the layout's scope) with the layout's
 * geometry re-applied by key: saved positions for displayed cards, expansions whose card and owner
 * exist here, user sizes and the camera. Cards without a saved position keep the placement `base`
 * gave them. Returns a new object; `base` is not modified.
 */
export function applyLayout(base: ExplorerViewState, layout: MapLayout, graph: AtlasGraph): ExplorerViewState {
  const { idOfKey } = keyMap(graph);
  const level = base.levelViews.PACKAGE;
  const displayed = new Set(level.displayedIds);
  const positions = { ...level.positions };
  for (const [key, p] of Object.entries(layout.positions || {})) { const id = idOfKey.get(key); if (id && displayed.has(id)) positions[id] = { x: p.x, y: p.y }; }
  const parentOf = new Map(graph.nodes.map(n => [n.id, n.parentId]));
  const expansions: LevelViewState['expansions'] = {};
  // Owners before the cards inside them, so a nested expansion is kept only where its owner is.
  const entries = Object.entries(layout.expansions || {}).map(([key, e]) => ({ key, e, id: idOfKey.get(key) })).filter(x => x.id);
  let progress = true;
  const pending = new Map(entries.map(x => [x.id!, x]));
  while (progress && pending.size) {
    progress = false;
    for (const [id, { e }] of [...pending]) {
      const ownerId = e.ownerKey ? idOfKey.get(e.ownerKey) ?? null : null;
      const placed = ownerId === null ? displayed.has(id) : !!expansions[ownerId];
      if (!placed) continue;
      const childPositions: Record<string, { x: number; y: number }> = {};
      for (const [ck, p] of Object.entries(e.childPositions || {})) {
        const child = idOfKey.get(ck);
        if (child && isInside(child, id, parentOf)) childPositions[child] = { x: p.x, y: p.y };
      }
      // A resized box comes back at its size (ADR 0017 review: it holds the blocks its cards were made in).
      const min = e.minSize && Number.isFinite(e.minSize.width) && Number.isFinite(e.minSize.height) ? { width: e.minSize.width, height: e.minSize.height } : null;
      expansions[id] = { ownerId, childPositions, minSize: min, ...(e.hidden ? { hidden: true } : {}) };
      pending.delete(id);
      progress = true;
    }
  }
  const sizes: LevelViewState['sizes'] = {};
  for (const [key, s] of Object.entries(layout.sizes || {})) { const id = idOfKey.get(key); if (id) sizes[id] = { width: s.width, height: s.height }; }
  const camera = layout.camera ? { zoom: layout.camera.zoom, pan: { x: layout.camera.pan.x, y: layout.camera.pan.y } } : level.camera;
  return { ...base, levelViews: { ...base.levelViews, PACKAGE: { ...level, positions, expansions, sizes, camera, geometryRevision: level.geometryRevision + 1, cameraRevision: level.cameraRevision + 1, geometryInitialized: true } } };
}

/** A child drawn inside a container: a type of a package (through nested types) or a member of a type. */
function isInside(child: string, container: string, parentOf: Map<string, string | undefined>): boolean {
  const seen = new Set<string>();
  for (let c = parentOf.get(child); c && !seen.has(c); c = parentOf.get(c)) { if (c === container) return true; seen.add(c); }
  return false;
}

/** True when a value looks like a MapLayout this version can apply. */
export function isMapLayout(value: unknown): value is MapLayout {
  const v = value as MapLayout | null;
  return !!v && typeof v === 'object' && v.version === 1 && typeof v.positions === 'object' && typeof v.expansions === 'object';
}
