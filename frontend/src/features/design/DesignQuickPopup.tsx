import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesignOperation } from '../../api/client';
import { RELATION_KINDS, TYPE_KINDS, relationOps } from './designModel';

/** What was just created (ADR 0016): a relation by its ends and kind, or a resource by its key and kind. */
export type QuickTarget =
  | { relation: { sourceKey: string; targetKey: string; kind: string } }
  | { resource: { key: string; kind: string; name: string } };

interface Props {
  target: QuickTarget;
  /** Client pixels: a relation's middle (the popup is centred on it), or a card's top-right corner. */
  anchor: { x: number; y: number };
  /** Applies one change set; rejects with the server's message, shown on the popup. */
  onApply: (operations: DesignOperation[]) => Promise<void>;
  onClose: () => void;
}

const kindLabel = (k: string) => k.toLowerCase().replaceAll('_', ' ');

/**
 * The quick intent popup (ADR 0016): opens right after a relation or a resource is created, with the
 * intent field focused so the engineer just keeps typing, then the kind. No details: double-click opens
 * the full popover for that. Enter saves; Esc closes without saving; clicking elsewhere saves what was typed.
 * Packages and methods show no kind choice (a package has one kind; a constructor must be named after its class).
 */
export default function DesignQuickPopup({ target, anchor, onApply, onClose }: Props) {
  const relation = 'relation' in target ? target.relation : null, resource = 'resource' in target ? target.resource : null;
  const initialKind = relation ? relation.kind : resource!.kind;
  const kinds = relation ? RELATION_KINDS : TYPE_KINDS.includes(initialKind) ? TYPE_KINDS : [];
  const [intent, setIntent] = useState(''), [kind, setKind] = useState(initialKind);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const box = useRef<HTMLFormElement>(null), input = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  const latest = useRef({ intent, kind, busy }); latest.current = { intent, kind, busy };

  // A relation's popup is centred on its middle; a resource's sits just right of the card's top corner. Kept on screen.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = relation ? anchor.x - w / 2 : anchor.x + 8, top = relation ? anchor.y - h / 2 : anchor.y - 4;
    setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - w - 8)), top: Math.max(8, Math.min(top, window.innerHeight - h - 8)) });
  }, [anchor.x, anchor.y]);
  useEffect(() => { input.current?.focus(); }, []);

  async function save() {
    const { intent: text, kind: chosen, busy: running } = latest.current;
    if (running) return;
    const explanation = text.trim();
    const ops: DesignOperation[] = relation
      ? (explanation || chosen !== relation.kind ? relationOps(relation.sourceKey, relation.targetKey, chosen, explanation, relation.kind) : [])
      : explanation || chosen !== resource!.kind ? [{ op: 'updateResource', key: resource!.key, ...(chosen !== resource!.kind ? { kind: chosen } : {}), ...(explanation ? { explanation } : {}) }] : [];
    if (!ops.length) { onClose(); return; }
    setBusy(true); setMessage('');
    try { await onApply(ops); onClose(); }
    catch (e: any) { setMessage(e.message); setBusy(false); }
  }

  // Clicking anywhere else keeps what was typed (an accidental click must not lose it).
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) void save(); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const what = relation ? 'relation' : kindLabel(resource!.kind);
  return <form ref={box} className="design-quick-popup" role="dialog" aria-label={`Intent of the new ${what}`} style={position}
    onSubmit={e => { e.preventDefault(); void save(); }}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
    <input ref={input} value={intent} onChange={e => setIntent(e.target.value)} disabled={busy} maxLength={2000}
      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }}
      placeholder={relation ? 'Why? The intent of this relation' : `What is this ${what} for?`} aria-label="Intent"/>
    {kinds.length > 0 && <select value={kind} onChange={e => setKind(e.target.value)} disabled={busy}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} aria-label={relation ? 'Relation kind' : 'Kind'}>
      {kinds.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}
    </select>}
    <button type="submit" className="primary" disabled={busy} aria-label="Save intent" title="Save (Enter)">{busy ? '…' : '↵'}</button>
    {message && <p className="notice" role="alert">{message}</p>}
  </form>;
}
