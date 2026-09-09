import { AtlasGraph, AtlasNode } from './graphModel';
import { ScopeSelection, classesUnderPackage, getPackageCheckState, isClassInScope, getScopeCounts, selectAllScope, clearScope, togglePackage, toggleClass } from './scopeModel';

interface Props {
  graph: AtlasGraph;
  scope: ScopeSelection;
  selectedNode: AtlasNode | null;
  search: string;
  onScopeChange: (scope: ScopeSelection) => void;
  onSelect: (node: AtlasNode) => void;
  onFocusScope: (node: AtlasNode) => void;
}

/** Tri-state checkbox: HTML has no `indeterminate` attribute, only the DOM property. */
function TriStateCheckbox({ state, onChange, label }: { state: 'checked'|'indeterminate'|'unchecked'; onChange: () => void; label: string }) {
  return <input type="checkbox" className={`scope-checkbox ${state}`} checked={state === 'checked'} aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
    ref={el => { if (el) el.indeterminate = state === 'indeterminate'; }}
    onClick={e => e.stopPropagation()} onChange={onChange} aria-label={label} />;
}

function ClassRow({ node, graph, scope, selected, onScopeChange, onSelect, onFocusScope }:
  { node: AtlasNode; graph: AtlasGraph; scope: ScopeSelection; selected: boolean; onScopeChange: (s: ScopeSelection) => void; onSelect: (n: AtlasNode) => void; onFocusScope: (n: AtlasNode) => void }) {
  const inScope = isClassInScope(node, scope, graph);
  return <div className={`scope-row scope-row-class ${selected ? 'selected' : ''}`}>
    <TriStateCheckbox state={inScope ? 'checked' : 'unchecked'} onChange={() => onScopeChange(toggleClass(scope, node, graph))} label={`${inScope ? 'Remove' : 'Add'} ${node.simpleName} from scope`} />
    <button className="scope-label" title={node.qualifiedName} onClick={() => onSelect(node)}><span className="tree-icon">◇</span>{node.simpleName}</button>
    <button className="scope-focus" onClick={() => onFocusScope(node)} aria-label={`Focus scope to ${node.simpleName}`} title="Focus scope to this class">⌖</button>
  </div>;
}

function PackageRow({ node, graph, scope, selectedNode, forceOpen, onScopeChange, onSelect, onFocusScope }:
  { node: AtlasNode; graph: AtlasGraph; scope: ScopeSelection; selectedNode: AtlasNode | null; forceOpen: boolean; onScopeChange: (s: ScopeSelection) => void; onSelect: (n: AtlasNode) => void; onFocusScope: (n: AtlasNode) => void }) {
  const classes = classesUnderPackage(node, graph).sort((a, b) => a.simpleName.localeCompare(b.simpleName));
  const state = getPackageCheckState(node, scope, graph);
  const shortName = node.simpleName.split('.').pop()!;
  const open = forceOpen || selectedNode?.id === node.id || classes.some(c => c.id === selectedNode?.id) || undefined;
  return <details className="tree-branch scope-row-package" open={open}>
    <summary>
      <TriStateCheckbox state={state} onChange={() => onScopeChange(togglePackage(scope, node, graph))} label={`${state === 'unchecked' ? 'Add' : 'Remove'} package ${shortName} ${state === 'unchecked' ? 'to' : 'from'} scope`} />
      <span className="tree-icon">▱</span>
      <button className={`scope-label ${selectedNode?.id === node.id ? 'selected' : ''}`} title={node.qualifiedName} onClick={() => onSelect(node)}>{shortName}</button>
      <button className="scope-focus" onClick={() => onFocusScope(node)} aria-label={`Focus scope to ${shortName}`} title="Focus scope to this package">⌖</button>
      <small>{classes.length}</small>
    </summary>
    <div>{classes.map(c => <ClassRow key={c.id} node={c} graph={graph} scope={scope} selected={selectedNode?.id === c.id} onScopeChange={onScopeChange} onSelect={onSelect} onFocusScope={onFocusScope} />)}</div>
  </details>;
}

export default function NavigationPane({ graph, scope, selectedNode, search, onScopeChange, onSelect, onFocusScope }: Props) {
  const packages = graph.nodes.filter(n => n.kind === 'PACKAGE').sort((a, b) => a.simpleName.localeCompare(b.simpleName));
  const counts = getScopeCounts(graph, scope);
  const forceOpen = !!search;
  return <div className="scope-tree">
    <div className="scope-toolbar">
      <button className="text-button" onClick={() => onScopeChange(selectAllScope())}>Select all</button>
      <button className="text-button" onClick={() => onScopeChange(clearScope())}>Clear</button>
      <span className="scope-count">{scope.mode === 'ALL' ? 'Whole system' : `${counts.selectedClasses} class${counts.selectedClasses === 1 ? '' : 'es'} selected`}</span>
    </div>
    <div className="package-tree">
      {packages.map(p => <PackageRow key={p.id} node={p} graph={graph} scope={scope} selectedNode={selectedNode} forceOpen={forceOpen} onScopeChange={onScopeChange} onSelect={onSelect} onFocusScope={onFocusScope} />)}
      {!packages.length && <p className="muted">No packages in this snapshot.</p>}
    </div>
  </div>;
}
