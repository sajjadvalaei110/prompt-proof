import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignOperation } from '../../api/client';
import type { AtlasGraph, AtlasNode } from '../explorer/graphModel';
import { DesignRelation, MEMBER_KINDS, RELATION_KINDS, TYPE_KINDS, childKey, childKindsFor, keyOf, parseParameterTypes } from './designModel';

/** What the dialog edits. Resources are addressed by key, relations by their stored record. */
export type DesignDraft =
  | { mode: 'resource-new'; parentKey: string | null; parentKind: string | null; parentLabel: string | null }
  | { mode: 'resource-edit'; node: AtlasNode }
  | { mode: 'relation-new'; sourceKey: string | null; targetKey?: string | null }
  | { mode: 'relation-edit'; relation: DesignRelation };

interface Props {
  draft: DesignDraft;
  graph: AtlasGraph;
  /** Applies one change set; rejects with the server's message, which the dialog shows. */
  onApply: (operations: DesignOperation[]) => Promise<void>;
  onClose: () => void;
}

const EXPLANATION_HINT = 'First paragraph: the intent. What this is for and why it exists.\n\nThen rationale, constraints, contracts, and any planned change to existing code.';
const kindLabel = (k: string) => k.toLowerCase().replaceAll('_', ' ');

/**
 * Add or edit one design-layer element (ADR 0014). Every save goes through the same atomic change
 * set API agents use. Parsed code only takes an explanation: its structure belongs to the parser.
 */
export default function DesignEditorDialog({ draft, graph, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editNode = draft.mode === 'resource-edit' ? draft.node : null;
  const authored = editNode?.design?.origin === 'AUTHORED';
  const relation = draft.mode === 'relation-edit' ? draft.relation : null;
  const parentKind = draft.mode === 'resource-new' ? draft.parentKind : null;
  const kinds = draft.mode === 'resource-new' ? childKindsFor(parentKind) : editNode ? (TYPE_KINDS.includes(editNode.kind) ? TYPE_KINDS : [editNode.kind]) : [];
  const [kind, setKind] = useState(editNode?.kind || kinds[0] || 'CLASS');
  const [name, setName] = useState(editNode ? (editNode.design?.name || editNode.simpleName) : '');
  const [params, setParams] = useState((editNode?.design?.parameterTypes || []).join(', '));
  const [signature, setSignature] = useState(editNode?.design?.signature || '');
  const [explanation, setExplanation] = useState(editNode?.design?.explanation || relation?.explanation || '');
  const [sourceKey, setSourceKey] = useState(draft.mode === 'relation-new' ? draft.sourceKey || '' : relation?.sourceKey || '');
  const [targetKey, setTargetKey] = useState(draft.mode === 'relation-new' ? draft.targetKey || '' : relation?.targetKey || '');
  const [relationKind, setRelationKind] = useState(relation?.kind || 'CALLS');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);

  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);

  const member = MEMBER_KINDS.includes(kind);
  const parentKey = draft.mode === 'resource-new' ? draft.parentKey : editNode?.design?.parentKey ?? null;
  const previewKey = (draft.mode === 'resource-new' || authored) && name.trim()
    ? childKey(kind, parentKey, kind === 'CONSTRUCTOR' && parentKey ? parentKey.split('.').pop()! : name, member ? parseParameterTypes(params) : [])
    : null;
  const keyOptions = useMemo(() => [...new Set(graph.nodes.filter(n => n.kind !== 'FIELD').map(keyOf))].sort(), [graph]);

  async function submit() {
    setBusy(true); setMessage('');
    try {
      const ops: DesignOperation[] = [];
      if (draft.mode === 'resource-new') {
        ops.push({ op: 'putResource', kind, parentKey: draft.parentKey, name: kind === 'CONSTRUCTOR' && draft.parentKey ? draft.parentKey.split('.').pop()! : name.trim(),
          ...(member ? { parameterTypes: parseParameterTypes(params), ...(signature.trim() ? { signature: signature.trim() } : {}) } : {}), explanation });
      } else if (draft.mode === 'resource-edit') {
        const key = keyOf(draft.node);
        if (authored) ops.push({ op: 'updateResource', key, kind, name: kind === 'CONSTRUCTOR' ? undefined : name.trim(), ...(member ? { parameterTypes: parseParameterTypes(params), signature: signature.trim() || undefined } : {}), explanation });
        else ops.push({ op: 'putResource', key, explanation });
      } else if (draft.mode === 'relation-new') {
        ops.push({ op: 'putRelation', sourceKey: sourceKey.trim(), targetKey: targetKey.trim(), kind: relationKind, explanation });
      } else if (relation) {
        if (relationKind !== relation.kind) ops.push({ op: 'deleteRelation', sourceKey: relation.sourceKey, targetKey: relation.targetKey, kind: relation.kind });
        ops.push({ op: 'putRelation', sourceKey: relation.sourceKey, targetKey: relation.targetKey, kind: relationKind, explanation });
      }
      await onApply(ops);
      onClose();
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    const what = relation ? 'this designed relation' : authored ? `${editNode!.simpleName} and everything designed inside it` : 'this explanation';
    if (!window.confirm(`Delete ${what}? This cannot be undone with Undo.`)) return;
    setBusy(true); setMessage('');
    try {
      await onApply(relation ? [{ op: 'deleteRelation', sourceKey: relation.sourceKey, targetKey: relation.targetKey, kind: relation.kind }] : [{ op: 'deleteResource', key: keyOf(editNode!) }]);
      onClose();
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  const title = draft.mode === 'resource-new' ? (draft.parentLabel ? `Add to ${draft.parentLabel}` : 'Add a package')
    : draft.mode === 'resource-edit' ? (authored ? `Edit ${editNode!.simpleName}` : `Explain ${editNode!.simpleName}`)
    : draft.mode === 'relation-new' ? 'Add a relation' : 'Edit relation';
  const canDelete = (draft.mode === 'resource-edit' && !!editNode?.design) || draft.mode === 'relation-edit';
  const structural = draft.mode === 'resource-new' || authored;

  return <dialog ref={dialog} className="settings-dialog design-dialog" onCancel={onClose} onClose={onClose} aria-label={title}>
    <header><div><h2>{title}</h2><p>{structural || draft.mode.startsWith('relation') ? 'Design layer: a plan on the map, kept apart from parsed code facts.' : 'Parsed code keeps its structure. Describe its intent, and any change you plan, in the explanation.'}</p></div><button onClick={onClose} aria-label="Close design editor">✕</button></header>
    <form className="settings-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {structural && <div className="settings-grid">
        <label>Kind<select value={kind} onChange={e => setKind(e.target.value)} disabled={kinds.length < 2}>{kinds.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></label>
        <label>{kind === 'PACKAGE' ? 'Package name' : 'Name'}<input value={kind === 'CONSTRUCTOR' && parentKey ? parentKey.split('.').pop()! : name} disabled={kind === 'CONSTRUCTOR'} onChange={e => setName(e.target.value)} placeholder={kind === 'PACKAGE' ? 'com.acme.billing' : MEMBER_KINDS.includes(kind) ? 'issueInvoice' : 'InvoiceService'} required={kind !== 'CONSTRUCTOR'} autoFocus/></label>
        {member && <label>Parameter types<input value={params} onChange={e => setParams(e.target.value)} placeholder="OrderId, boolean"/></label>}
        {member && <label>Signature (optional)<input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Invoice issue(OrderId id, boolean draft)"/></label>}
      </div>}
      {draft.mode === 'relation-new' && <div className="settings-grid">
        <label>From<input list="design-keys" value={sourceKey} onChange={e => setSourceKey(e.target.value)} required placeholder="com.acme.orders.OrderService"/></label>
        <label>To<input list="design-keys" value={targetKey} onChange={e => setTargetKey(e.target.value)} required autoFocus placeholder="com.acme.billing.InvoiceService"/></label>
        <datalist id="design-keys">{keyOptions.map(k => <option key={k} value={k}/>)}</datalist>
      </div>}
      {draft.mode === 'relation-edit' && relation && <p className="design-relation-ends"><code>{relation.sourceKey}</code> → <code>{relation.targetKey}</code></p>}
      {draft.mode.startsWith('relation') && <label>Relation<select value={relationKind} onChange={e => setRelationKind(e.target.value)}>{RELATION_KINDS.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></label>}
      <label>Explanation<textarea className="design-explanation-input" value={explanation} onChange={e => setExplanation(e.target.value)} placeholder={EXPLANATION_HINT} rows={9} maxLength={20000}/></label>
      {previewKey && <p className="design-key-preview">Key <code>{previewKey}</code></p>}
      {message && <p className="notice" role="alert">{message}</p>}
      <div className="settings-actions">
        {canDelete && <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>{relation || authored ? 'Delete' : 'Remove explanation'}</button>}
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </dialog>;
}
