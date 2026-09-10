import { AtlasGraph, AtlasNode, isType, ownerAt } from './graphModel';

/**
 * The graph's explicit boundary. ALL means the whole indexed snapshot; CUSTOM means only the
 * packages/classes named in the two sets (plus whatever they imply, see isClassInScope).
 * Packages are flat (JavaParserAdapter never links a PACKAGE to another PACKAGE), so a class's
 * package membership is resolved once via ownerAt('PACKAGE') rather than any parent-chain walk.
 * Within an open snapshot this boundary may change only through controls explicitly labelled as
 * scope edits: the tree checkboxes/actions, the scope reset, and graph "Remove from scope".
 */
export interface ScopeSelection {
  mode: 'ALL' | 'CUSTOM';
  selectedPackageIds: Set<string>;
  selectedClassIds: Set<string>;
}

export type CheckState = 'checked' | 'indeterminate' | 'unchecked';

export interface ScopeCounts { totalPackages: number; totalClasses: number; selectedPackages: number; selectedClasses: number }

/** A visual namespace in the dotted package-name trie. It is not a graph symbol. */
export interface PackageHierarchyNode {
  name: string;
  qualifiedName: string;
  packageNode?: AtlasNode;
  packageIds: string[];
  children: PackageHierarchyNode[];
}

export const wholeSystemScope = (): ScopeSelection => ({ mode: 'ALL', selectedPackageIds: new Set(), selectedClassIds: new Set() });
export const emptyScope = (): ScopeSelection => ({ mode: 'CUSTOM', selectedPackageIds: new Set(), selectedClassIds: new Set() });

const nodeMap = (graph: AtlasGraph) => new Map(graph.nodes.map(n => [n.id, n]));
const allPackageIds = (graph: AtlasGraph) => graph.nodes.filter(n => n.kind === 'PACKAGE').map(n => n.id);

interface MutablePackageHierarchyNode {
  name: string;
  qualifiedName: string;
  packageNode?: AtlasNode;
  children: Map<string, MutablePackageHierarchyNode>;
}

/** Builds the package hierarchy the backend intentionally does not persist. */
export function buildPackageHierarchy(graph: AtlasGraph): PackageHierarchyNode[] {
  const roots = new Map<string, MutablePackageHierarchyNode>();
  const packages = graph.nodes.filter(n => n.kind === 'PACKAGE').sort((a, b) =>
    (a.qualifiedName || a.simpleName).localeCompare(b.qualifiedName || b.simpleName));
  for (const packageNode of packages) {
    const dottedName = packageNode.qualifiedName || packageNode.simpleName || packageNode.id;
    const parts = dottedName.split('.').filter(Boolean);
    let siblings = roots;
    let qualifiedName = '';
    for (const part of parts.length ? parts : [dottedName]) {
      qualifiedName = qualifiedName ? `${qualifiedName}.${part}` : part;
      let current = siblings.get(part);
      if (!current) {
        current = { name: part, qualifiedName, children: new Map() };
        siblings.set(part, current);
      }
      if (qualifiedName === dottedName) current.packageNode = packageNode;
      siblings = current.children;
    }
  }
  const finish = (nodes: Map<string, MutablePackageHierarchyNode>): PackageHierarchyNode[] =>
    [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)).map(node => {
      const children = finish(node.children);
      return {
        name: node.name,
        qualifiedName: node.qualifiedName,
        packageNode: node.packageNode,
        packageIds: [node.packageNode?.id, ...children.flatMap(child => child.packageIds)].filter((id): id is string => Boolean(id)),
        children
      };
    });
  return finish(roots);
}

/** Every type-level node (CLASS/INTERFACE/ENUM/RECORD/ANNOTATION) whose owning package is packageNode. */
export function classesUnderPackage(packageNode: AtlasNode, graph: AtlasGraph): AtlasNode[] {
  const all = nodeMap(graph);
  return graph.nodes.filter(n => isType(n) && ownerAt(n, 'PACKAGE', all)?.id === packageNode.id);
}

export function isClassInScope(classNode: AtlasNode, scope: ScopeSelection, graph: AtlasGraph): boolean {
  if (scope.mode === 'ALL') return true;
  if (scope.selectedClassIds.has(classNode.id)) return true;
  const pkg = ownerAt(classNode, 'PACKAGE', nodeMap(graph));
  return pkg != null && scope.selectedPackageIds.has(pkg.id);
}

/** A package is in scope (for rendering at PACKAGE level) whenever any of its classes are. */
export function getPackageCheckState(packageNode: AtlasNode, scope: ScopeSelection, graph: AtlasGraph): CheckState {
  if (scope.mode === 'ALL') return 'checked';
  if (scope.selectedPackageIds.has(packageNode.id)) return 'checked';
  const classes = classesUnderPackage(packageNode, graph);
  if (classes.length === 0) return 'unchecked';
  const inScope = classes.filter(c => isClassInScope(c, scope, graph)).length;
  return inScope === 0 ? 'unchecked' : inScope === classes.length ? 'checked' : 'indeterminate';
}

/** Aggregate checkbox state for a visual namespace containing one or more real packages. */
export function getPackageGroupCheckState(packageIds: string[], scope: ScopeSelection, graph: AtlasGraph): CheckState {
  const packages = graph.nodes.filter(n => n.kind === 'PACKAGE' && packageIds.includes(n.id));
  if (packages.length === 0) return 'unchecked';
  const states = packages.map(packageNode => getPackageCheckState(packageNode, scope, graph));
  if (states.every(state => state === 'checked')) return 'checked';
  if (states.every(state => state === 'unchecked')) return 'unchecked';
  return 'indeterminate';
}

/** Any node, at any granularity: package (checked/indeterminate), class, or method/constructor via its enclosing class. */
export function isNodeInScope(node: AtlasNode, scope: ScopeSelection, graph: AtlasGraph): boolean {
  if (scope.mode === 'ALL') return true;
  if (node.kind === 'PACKAGE') return getPackageCheckState(node, scope, graph) !== 'unchecked';
  if (isType(node)) return isClassInScope(node, scope, graph);
  const owner = ownerAt(node, 'CLASS', nodeMap(graph));
  return owner != null && isClassInScope(owner, scope, graph);
}

export function getScopeCounts(graph: AtlasGraph, scope: ScopeSelection): ScopeCounts {
  const packages = graph.nodes.filter(n => n.kind === 'PACKAGE');
  const classes = graph.nodes.filter(isType);
  if (scope.mode === 'ALL') return { totalPackages: packages.length, totalClasses: classes.length, selectedPackages: packages.length, selectedClasses: classes.length };
  const selectedClasses = classes.filter(c => isClassInScope(c, scope, graph)).length;
  const selectedPackages = packages.filter(p => getPackageCheckState(p, scope, graph) !== 'unchecked').length;
  return { totalPackages: packages.length, totalClasses: classes.length, selectedPackages, selectedClasses };
}

const shortPackageName = (n: AtlasNode) => (n.simpleName || n.qualifiedName || n.id).split('.').pop()!;
const list = (names: string[]) => names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');

/** Exact, human-readable description of the current boundary for the scope banner and breadcrumbs. */
export function scopeToLabel(graph: AtlasGraph, scope: ScopeSelection): string {
  const counts = getScopeCounts(graph, scope);
  if (scope.mode === 'ALL') return `Whole system · ${counts.totalPackages} packages · ${counts.totalClasses} classes`;
  if (scope.selectedPackageIds.size === 0 && scope.selectedClassIds.size === 0) return 'No packages or classes selected';
  const packageNames = graph.nodes.filter(n => scope.selectedPackageIds.has(n.id)).map(shortPackageName);
  const classNames = graph.nodes.filter(n => scope.selectedClassIds.has(n.id)).map(n => n.simpleName);
  if (packageNames.length && classNames.length) return `${packageNames.length} package${packageNames.length === 1 ? '' : 's'}, ${classNames.length} class${classNames.length === 1 ? '' : 'es'} selected · ${counts.selectedClasses} classes total`;
  if (packageNames.length) return `${packageNames.length} package${packageNames.length === 1 ? '' : 's'} selected · ${list(packageNames)} · ${counts.selectedClasses} classes`;
  return `${classNames.length} class${classNames.length === 1 ? '' : 'es'} selected · ${list(classNames)}`;
}

export function selectAllScope(): ScopeSelection { return wholeSystemScope(); }
export function clearScope(): ScopeSelection { return emptyScope(); }

/** Toggles real packages as one group for a package leaf or synthetic namespace checkbox. */
export function togglePackages(scope: ScopeSelection, packageIds: string[], graph: AtlasGraph): ScopeSelection {
  const realPackageIds = new Set(graph.nodes.filter(n => n.kind === 'PACKAGE' && packageIds.includes(n.id)).map(n => n.id));
  const checking = getPackageGroupCheckState([...realPackageIds], scope, graph) === 'unchecked';
  const nextPackages = new Set(scope.mode === 'ALL' ? allPackageIds(graph) : scope.selectedPackageIds);
  const nextClasses = new Set(scope.mode === 'ALL' ? [] : scope.selectedClassIds);
  const packages = graph.nodes.filter(n => realPackageIds.has(n.id));
  if (checking) packages.forEach(packageNode => {
    nextPackages.add(packageNode.id);
    classesUnderPackage(packageNode, graph).forEach(c => nextClasses.delete(c.id));
  });
  else packages.forEach(packageNode => {
    nextPackages.delete(packageNode.id);
    classesUnderPackage(packageNode, graph).forEach(c => nextClasses.delete(c.id));
  });
  const next: ScopeSelection = { mode: 'CUSTOM', selectedPackageIds: nextPackages, selectedClassIds: nextClasses };
  const packageIdsInGraph = allPackageIds(graph);
  const coversWholeGraph = packageIdsInGraph.length > 0
    && packageIdsInGraph.every(id => nextPackages.has(id))
    && graph.nodes.filter(isType).every(classNode => isClassInScope(classNode, next, graph));
  return coversWholeGraph ? wholeSystemScope() : next;
}

/** Toggles one real package; the batch helper also powers synthetic namespace checkboxes. */
export function togglePackage(scope: ScopeSelection, packageNode: AtlasNode, graph: AtlasGraph): ScopeSelection {
  return togglePackages(scope, [packageNode.id], graph);
}

/** Toggles one class. Unchecking a class whose package is wholesale-selected splits the package into its remaining siblings. */
export function toggleClass(scope: ScopeSelection, classNode: AtlasNode, graph: AtlasGraph): ScopeSelection {
  const pkg = ownerAt(classNode, 'PACKAGE', nodeMap(graph));
  const currentlyIn = isClassInScope(classNode, scope, graph);
  const nextPackages = new Set(scope.mode === 'ALL' ? allPackageIds(graph) : scope.selectedPackageIds);
  const nextClasses = new Set(scope.mode === 'ALL' ? [] : scope.selectedClassIds);
  const wholePackageSelected = pkg != null && nextPackages.has(pkg.id);
  if (currentlyIn) {
    if (wholePackageSelected) {
      nextPackages.delete(pkg!.id);
      classesUnderPackage(pkg!, graph).forEach(c => { if (c.id !== classNode.id) nextClasses.add(c.id); });
    } else nextClasses.delete(classNode.id);
  } else nextClasses.add(classNode.id);
  return { mode: 'CUSTOM', selectedPackageIds: nextPackages, selectedClassIds: nextClasses };
}
