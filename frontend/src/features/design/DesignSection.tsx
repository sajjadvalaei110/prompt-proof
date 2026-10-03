import type { AtlasNode } from '../explorer/graphModel';
import { DesignRelation, DesignStatus, detailOf, intentOf, isDesignOnly } from './designModel';

const STATUS_TEXT: Record<DesignStatus, string> = {
  PLANNED: 'planned · not in the code yet',
  IMPLEMENTED: 'implemented · found in the code',
  PRESENT: 'in the code',
  MISSING: 'referenced · not found in the code',
  ORPHANED: 'orphaned · its parent or endpoint is gone',
};

function Explanation({ text, empty }: { text: string; empty: string }) {
  const intent = intentOf(text), detail = detailOf(text);
  if (!intent) return <p className="muted">{empty}</p>;
  return <><p className="design-intent">{intent}</p>{detail && <div className="design-detail">{detail}</div>}</>;
}

function Provenance({ createdBy, updatedBy, updatedAt }: { createdBy: string; updatedBy: string; updatedAt: string }) {
  return <small className="provenance design-provenance">Written by {createdBy}{updatedBy !== createdBy ? ` · last edited by ${updatedBy}` : ''} · {updatedAt}</small>;
}

/**
 * The engineer's explanation of a card, from the design layer (ADR 0014). It leads the inspector:
 * the first paragraph is the intent. Text is rendered as plain text, never as markup.
 */
export function DesignNodeSection({ node, onEdit, onAddChild, onAddRelation, canAddChild }: { node: AtlasNode; onEdit: () => void; onAddChild: () => void; onAddRelation: () => void; canAddChild: boolean }) {
  const d = node.design, designOnly = isDesignOnly(node);
  return <section className="design-section" aria-label="Design explanation">
    <div className="section-heading"><h3>✎ Explanation</h3>{d && (d.origin === 'AUTHORED' || d.status !== 'PRESENT') && <span className={`tag design-status design-status-${d.status.toLowerCase()}`}>{STATUS_TEXT[d.status]}</span>}</div>
    {designOnly && d?.signature && <p className="design-signature"><code>{d.signature}</code></p>}
    <Explanation text={d?.explanation || ''} empty="No explanation yet. Start with the intent: what this is for and why it exists."/>
    <div className="design-actions">
      <button onClick={onEdit}>{d?.origin === 'AUTHORED' ? 'Edit' : d?.explanation ? 'Edit explanation' : 'Write explanation'}</button>
      {canAddChild && <button onClick={onAddChild}>＋ Add {node.kind === 'PACKAGE' ? 'type' : 'member'}</button>}
      <button onClick={onAddRelation}>＋ Relation from here</button>
    </div>
    {d && <Provenance createdBy={d.createdBy} updatedBy={d.updatedBy} updatedAt={d.updatedAt}/>}
  </section>;
}

/** The designed relations behind a route, or an offer to explain a parsed one. */
export function DesignEdgeSection({ relations, onEdit, onExplainParsed }: { relations: DesignRelation[]; onEdit: (r: DesignRelation) => void; onExplainParsed?: () => void }) {
  return <section className="design-section" aria-label="Designed relations">
    <div className="section-heading"><h3>✎ Designed relation{relations.length === 1 ? '' : 's'}</h3>{relations.length > 0 && <span className="count">{relations.length}</span>}</div>
    {relations.map(r => <div className="design-relation" key={r.id}>
      <div className="design-relation-head"><span className="tag">{r.kind.toLowerCase().replaceAll('_', ' ')}</span><span className={`tag design-status design-status-${r.status.toLowerCase()}`}>{STATUS_TEXT[r.status]}</span></div>
      <Explanation text={r.explanation} empty="No explanation yet."/>
      <div className="design-actions"><button onClick={() => onEdit(r)}>Edit</button></div>
      <Provenance createdBy={r.createdBy} updatedBy={r.updatedBy} updatedAt={r.updatedAt}/>
    </div>)}
    {!relations.length && <p className="muted">Parsed from the code. Explain why it exists, or what should change about it.</p>}
    {onExplainParsed && <button className="full-width" onClick={onExplainParsed}>✎ Explain this relation</button>}
  </section>;
}
