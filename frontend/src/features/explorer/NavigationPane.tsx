import { useEffect, useState } from 'react';
import { AtlasGraph, AtlasNode, isType, ownerAt } from './graphModel';
import { PackageHierarchyNode, ScopeSelection, buildPackageHierarchy, classesUnderPackage, getPackageGroupCheckState, isClassInScope, getScopeCounts, selectAllScope, clearScope, togglePackages, toggleClass } from './scopeModel';

interface Props {
  graph: AtlasGraph;
  scope: ScopeSelection;
  selectedNode: AtlasNode | null;
  search: string;
  /** `explicitClassAddId` is set only when this change is a direct single-class checkbox add, so the
   * displayed page can append exactly that class instead of a ranked batch (Appendix A2). */
  onScopeChange: (scope: ScopeSelection, explicitClassAddId?: string) => void;
  onSelect: (node: AtlasNode) => void;
  /** Named navigation commands (Step 4): a package's ⌖ button explicitly views its classes; a
   * class's ⌖ button explicitly views its methods. Neither changes scope or filters. */
  onViewClasses: (node: AtlasNode) => void;
  onViewMethods: (node: AtlasNode) => void;
}

/** Folder-shaped icon distinguishing packages/namespaces from classes in the scope tree. */
function PackageIcon() {
  return <svg className="tree-icon-svg" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.8 4.3c0-.72.58-1.3 1.3-1.3h2.85l1.2 1.4h5.75c.72 0 1.3.58 1.3 1.3v5.7c0 .72-.58 1.3-1.3 1.3H3.1c-.72 0-1.3-.58-1.3-1.3V4.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>;
}

/** UML-style class box icon (a name compartment above a divider) for classes in the scope tree. */
function ClassIcon() {
  return <svg className="tree-icon-svg" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <line x1="2" y1="6.4" x2="14" y2="6.4" stroke="currentColor" strokeWidth="1.3" />
  </svg>;
}

/** Tri-state checkbox: HTML has no `indeterminate` attribute, only the DOM property. */
function TriStateCheckbox({ state, onChange, label }: { state: 'checked'|'indeterminate'|'unchecked'; onChange: () => void; label: string }) {
  return <input type="checkbox" className={`scope-checkbox ${state}`} checked={state === 'checked'} aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
    ref={el => { if (el) el.indeterminate = state === 'indeterminate'; }}
    onClick={e => e.stopPropagation()} onChange={onChange} aria-label={label} />;
}

function ClassRow({ node, graph, scope, selected, onScopeChange, onSelect, onViewMethods }:
  { node: AtlasNode; graph: AtlasGraph; scope: ScopeSelection; selected: boolean; onScopeChange: (s: ScopeSelection, explicitClassAddId?: string) => void; onSelect: (n: AtlasNode) => void; onViewMethods: (n: AtlasNode) => void }) {
  const inScope = isClassInScope(node, scope, graph);
  return <div className={`scope-row scope-row-class ${selected ? 'selected' : ''}`}>
    <TriStateCheckbox state={inScope ? 'checked' : 'unchecked'} onChange={() => onScopeChange(toggleClass(scope, node, graph), inScope ? undefined : node.id)} label={`${inScope ? 'Remove' : 'Add'} ${node.simpleName} from scope`} />
    <button className="scope-label" title={node.qualifiedName} onClick={() => onSelect(node)}><span className="tree-icon class-icon"><ClassIcon /></span>{node.simpleName}</button>
    <button className="scope-explore" onClick={() => onViewMethods(node)} aria-label={`View methods of ${node.simpleName}`} title="View methods">⌖</button>
  </div>;
}

function PackageRow({ branch, graph, scope, selectedNode, forceOpen, defaultOpen, onScopeChange, onSelect, onViewClasses, onViewMethods }:
  { branch: PackageHierarchyNode; graph: AtlasGraph; scope: ScopeSelection; selectedNode: AtlasNode | null; forceOpen: boolean; defaultOpen: boolean; onScopeChange: (s: ScopeSelection) => void; onSelect: (n: AtlasNode) => void; onViewClasses: (n: AtlasNode) => void; onViewMethods: (n: AtlasNode) => void }) {
  const node = branch.packageNode;
  const classes = node ? classesUnderPackage(node, graph).sort((a, b) => a.simpleName.localeCompare(b.simpleName)) : [];
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const descendantClassCount = graph.nodes.filter(n => isType(n) && branch.packageIds.includes(ownerAt(n, 'PACKAGE', all)?.id || '')).length;
  const state = getPackageGroupCheckState(branch.packageIds, scope, graph);
  const selectedPackage = selectedNode ? ownerAt(selectedNode, 'PACKAGE', all) : undefined;
  const selectedWithin = !!selectedPackage && branch.packageIds.includes(selectedPackage.id);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (forceOpen || selectedWithin) setOpen(true); }, [forceOpen, selectedWithin]);
  return <details className={`tree-branch scope-row-package ${node ? '' : 'scope-row-namespace'}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <TriStateCheckbox state={state} onChange={() => onScopeChange(togglePackages(scope, branch.packageIds, graph))} label={`${state === 'unchecked' ? 'Add' : 'Remove'} ${node && !branch.children.length ? 'package' : 'namespace'} ${branch.qualifiedName} ${state === 'unchecked' ? 'to' : 'from'} scope`} />
      <span className="tree-icon package-icon"><PackageIcon /></span>
      {node
        ? <button className={`scope-label ${selectedNode?.id === node.id ? 'selected' : ''}`} title={node.qualifiedName} onClick={() => onSelect(node)}>{branch.name}</button>
        : <span className="scope-label scope-namespace-label" title={branch.qualifiedName}>{branch.name}</span>}
      {node && <button className="scope-explore" onClick={() => onViewClasses(node)} aria-label={`View classes in ${branch.name}`} title="View classes">⌖</button>}
      <small>{descendantClassCount}</small>
    </summary>
    <div>
      {classes.map(c => <ClassRow key={c.id} node={c} graph={graph} scope={scope} selected={selectedNode?.id === c.id} onScopeChange={onScopeChange} onSelect={onSelect} onViewMethods={onViewMethods} />)}
      {branch.children.map(child => <PackageRow key={child.qualifiedName} branch={child} graph={graph} scope={scope} selectedNode={selectedNode} forceOpen={forceOpen} defaultOpen={defaultOpen && !branch.packageNode && branch.children.length === 1} onScopeChange={onScopeChange} onSelect={onSelect} onViewClasses={onViewClasses} onViewMethods={onViewMethods} />)}
    </div>
  </details>;
}

export default function NavigationPane({ graph, scope, selectedNode, search, onScopeChange, onSelect, onViewClasses, onViewMethods }: Props) {
  const packages = buildPackageHierarchy(graph);
  const counts = getScopeCounts(graph, scope);
  const forceOpen = !!search;
  return <div className="scope-tree">
    <div className="scope-toolbar">
      <button className="text-button" onClick={() => onScopeChange(selectAllScope())}>Select all</button>
      <button className="text-button" onClick={() => onScopeChange(clearScope())}>Clear</button>
      <span className="scope-count">{scope.mode === 'ALL' ? 'Whole system' : `${counts.selectedClasses} class${counts.selectedClasses === 1 ? '' : 'es'} selected`}</span>
    </div>
    <div className="package-tree">
      {packages.map(branch => <PackageRow key={branch.qualifiedName} branch={branch} graph={graph} scope={scope} selectedNode={selectedNode} forceOpen={forceOpen} defaultOpen onScopeChange={onScopeChange} onSelect={onSelect} onViewClasses={onViewClasses} onViewMethods={onViewMethods} />)}
      {!packages.length && <p className="muted">No packages in this snapshot.</p>}
    </div>
  </div>;
}
