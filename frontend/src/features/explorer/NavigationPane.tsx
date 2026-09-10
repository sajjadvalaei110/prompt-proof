import { useEffect, useState } from 'react';
import { AtlasGraph, AtlasNode, isType, ownerAt } from './graphModel';
import { PackageHierarchyNode, ScopeSelection, buildPackageHierarchy, classesUnderPackage, getPackageGroupCheckState, isClassInScope, getScopeCounts, selectAllScope, clearScope, togglePackages, toggleClass } from './scopeModel';

interface Props {
  graph: AtlasGraph;
  scope: ScopeSelection;
  selectedNode: AtlasNode | null;
  search: string;
  onScopeChange: (scope: ScopeSelection) => void;
  onSelect: (node: AtlasNode) => void;
  onExplore: (node: AtlasNode) => void;
}

/** Tri-state checkbox: HTML has no `indeterminate` attribute, only the DOM property. */
function TriStateCheckbox({ state, onChange, label }: { state: 'checked'|'indeterminate'|'unchecked'; onChange: () => void; label: string }) {
  return <input type="checkbox" className={`scope-checkbox ${state}`} checked={state === 'checked'} aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
    ref={el => { if (el) el.indeterminate = state === 'indeterminate'; }}
    onClick={e => e.stopPropagation()} onChange={onChange} aria-label={label} />;
}

function ClassRow({ node, graph, scope, selected, onScopeChange, onSelect, onExplore }:
  { node: AtlasNode; graph: AtlasGraph; scope: ScopeSelection; selected: boolean; onScopeChange: (s: ScopeSelection) => void; onSelect: (n: AtlasNode) => void; onExplore: (n: AtlasNode) => void }) {
  const inScope = isClassInScope(node, scope, graph);
  return <div className={`scope-row scope-row-class ${selected ? 'selected' : ''}`}>
    <TriStateCheckbox state={inScope ? 'checked' : 'unchecked'} onChange={() => onScopeChange(toggleClass(scope, node, graph))} label={`${inScope ? 'Remove' : 'Add'} ${node.simpleName} from scope`} />
    <button className="scope-label" title={node.qualifiedName} onClick={() => onSelect(node)}><span className="tree-icon">◇</span>{node.simpleName}</button>
    <button className="scope-explore" onClick={() => onExplore(node)} aria-label={`Explore ${node.simpleName}`} title="Explore this class">⌖</button>
  </div>;
}

function PackageRow({ branch, graph, scope, selectedNode, forceOpen, defaultOpen, onScopeChange, onSelect, onExplore }:
  { branch: PackageHierarchyNode; graph: AtlasGraph; scope: ScopeSelection; selectedNode: AtlasNode | null; forceOpen: boolean; defaultOpen: boolean; onScopeChange: (s: ScopeSelection) => void; onSelect: (n: AtlasNode) => void; onExplore: (n: AtlasNode) => void }) {
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
      <span className="tree-icon">▱</span>
      {node
        ? <button className={`scope-label ${selectedNode?.id === node.id ? 'selected' : ''}`} title={node.qualifiedName} onClick={() => onSelect(node)}>{branch.name}</button>
        : <span className="scope-label scope-namespace-label" title={branch.qualifiedName}>{branch.name}</span>}
      {node && <button className="scope-explore" onClick={() => onExplore(node)} aria-label={`Explore ${branch.name}`} title="Explore this package">⌖</button>}
      <small>{descendantClassCount}</small>
    </summary>
    <div>
      {classes.map(c => <ClassRow key={c.id} node={c} graph={graph} scope={scope} selected={selectedNode?.id === c.id} onScopeChange={onScopeChange} onSelect={onSelect} onExplore={onExplore} />)}
      {branch.children.map(child => <PackageRow key={child.qualifiedName} branch={child} graph={graph} scope={scope} selectedNode={selectedNode} forceOpen={forceOpen} defaultOpen={defaultOpen && !branch.packageNode && branch.children.length === 1} onScopeChange={onScopeChange} onSelect={onSelect} onExplore={onExplore} />)}
    </div>
  </details>;
}

export default function NavigationPane({ graph, scope, selectedNode, search, onScopeChange, onSelect, onExplore }: Props) {
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
      {packages.map(branch => <PackageRow key={branch.qualifiedName} branch={branch} graph={graph} scope={scope} selectedNode={selectedNode} forceOpen={forceOpen} defaultOpen onScopeChange={onScopeChange} onSelect={onSelect} onExplore={onExplore} />)}
      {!packages.length && <p className="muted">No packages in this snapshot.</p>}
    </div>
  </div>;
}
