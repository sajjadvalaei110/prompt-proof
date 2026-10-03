import { useLayoutEffect, useRef, useState } from 'react';
import type { DesignOperation } from '../../api/client';
import type { AtlasNode } from '../explorer/graphModel';
import { RELATION_KINDS, detailOf, explainOps, intentOf, joinExplanation, keyOf, relationOps } from './designModel';

/** A relation as the popover edits it: identified by its ends and kind (ADR 0014). */
export interface PopoverRelation { sourceKey: string; targetKey: string; kind: string; explanation: string }
export type PopoverTarget = { node: AtlasNode } | { relation: PopoverRelation } | { relations: PopoverRelation[] };

interface Props {
  target: PopoverTarget;
  /** Client pixels: the popover opens just above and to the right of it. */
  anchor: { x: number; y: number };
  /** Applies one change set; rejects with the server's message, which the popover shows. */
  onApply: (operations: DesignOperation[]) => Promise<void>;
  /** "More…": the full design dialog for what the popover does not cover. */
  onMore: (target: { node: AtlasNode } | { relation: PopoverRelation }) => void;
  onClose: () => void;
}

const kindLabel = (k: string) => k.toLowerCase().replaceAll('_', ' ');
const tail = (key: string) => key.replace(/\(.*$/, '').split('.').pop() + (key.includes('(') ? key.slice(key.indexOf('(')) : '');

/**
 * The design popover (ADR 0015): create or edit one explanation, intent first, in place on the map.
 * Used for a card's double-click, for a designed route's double-click and right after a two-click
 * relation, where it also changes the relation's kind. Every save is one change set.
 */
export default function DesignPopover({ target, anchor, onApply, onMore, onClose }: Props) {
  const [picked, setPicked] = useState<PopoverRelation | null>('relation' in target ? target.relation : null);
  const node = 'node' in target ? target.node : null;
  const relation = picked;
  const initial = node ? node.design?.explanation || '' : relation?.explanation || '';
  const [intent, setIntent] = useState(intentOf(initial)), [details, setDetails] = useState(detailOf(initial));
  const [kind, setKind] = useState(relation?.kind || 'CALLS');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x + 8, top: anchor.y - 8 });

  // Above and to the right of the anchor, kept inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(anchor.x + 8, window.innerWidth - w - 8));
    const above = anchor.y - h - 8;
    const top = above >= 8 ? above : Math.min(anchor.y + 8, window.innerHeight - h - 8);
    setPosition({ left, top: Math.max(8, top) });
  }, [anchor.x, anchor.y, picked]);

  function choose(r: PopoverRelation) {
    setPicked(r); setKind(r.kind); setIntent(intentOf(r.explanation)); setDetails(detailOf(r.explanation));
  }

  async function save() {
    const explanation = joinExplanation(intent, details);
    const ops = node ? explainOps(node, explanation) : relation ? relationOps(relation.sourceKey, relation.targetKey, kind, explanation, relation.kind) : [];
    if (!ops.length || (explanation === initial.trim() && (!relation || kind === relation.kind))) { onClose(); return; }
    setBusy(true); setMessage('');
    try { await onApply(ops); onClose(); }
    catch (e: any) { setMessage(e.message); }
    finally { setBusy(false); }
  }

  const title = node ? `${node.design?.origin === 'AUTHORED' ? 'Design' : 'Explain'} ${node.simpleName}` : relation ? `${tail(relation.sourceKey)} → ${tail(relation.targetKey)}` : 'Designed relations';
  return <div ref={box} className="design-popover" role="dialog" aria-label={title} style={position}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
    }}>
    <header><strong>{title}</strong><button type="button" onClick={onClose} aria-label="Close">✕</button></header>
    {'relations' in target && !relation ? <ul className="design-popover-picker">
      {target.relations.map(r => <li key={`${r.sourceKey}|${r.targetKey}|${r.kind}`}><button type="button" onClick={() => choose(r)}><code>{tail(r.sourceKey)}</code> {kindLabel(r.kind)} <code>{tail(r.targetKey)}</code></button></li>)}
    </ul> : <form onSubmit={e => { e.preventDefault(); void save(); }}>
      {relation && <label>Relation<select value={kind} onChange={e => setKind(e.target.value)} autoFocus={!relation.explanation}>{RELATION_KINDS.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></label>}
      <label>Intent<input value={intent} onChange={e => setIntent(e.target.value)} placeholder={relation ? 'Why should this relation exist?' : 'What is this for? One sentence.'} autoFocus={!relation || !!relation.explanation} maxLength={2000}/></label>
      <label>Details<textarea value={details} onChange={e => setDetails(e.target.value)} rows={4} placeholder="Rationale, constraints, and any change to existing code." maxLength={18000}/></label>
      {message && <p className="notice" role="alert">{message}</p>}
      <footer>
        <button type="button" className="text-button" onClick={() => onMore(node ? { node } : { relation: relation! })}>More…</button>
        <span>Ctrl+Enter</span>
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </footer>
      <p className="design-popover-key"><code>{node ? keyOf(node) : `${relation!.sourceKey} -${kind}-> ${relation!.targetKey}`}</code></p>
    </form>}
  </div>;
}
