import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
interface Doc { id?: string; title: string; content: string; revision?: number }
export default function ProjectDocuments({workspaceId, onChanged}: {workspaceId: string; onChanged: () => void}) {
  const [docs, setDocs] = useState<Doc[]>([]), [draft, setDraft] = useState<Doc>(()=>{try{return JSON.parse(sessionStorage.getItem('codeatlas-draft:'+workspaceId)||'null')||{title:'',content:''};}catch{return{title:'',content:''};}});
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(()=>!!sessionStorage.getItem('codeatlas-draft:'+workspaceId));
  useEffect(()=>{if(dirty)sessionStorage.setItem('codeatlas-draft:'+workspaceId,JSON.stringify(draft));else sessionStorage.removeItem('codeatlas-draft:'+workspaceId);},[draft,dirty,workspaceId]);
  async function refresh() { setDocs(await apiClient.getDocuments(workspaceId)); }
  useEffect(() => { refresh().catch(e => setMessage(e.message)); }, [workspaceId]);
  function choose(doc: Doc) { if (dirty && !window.confirm('Discard unsaved document edits?')) return; setDraft(doc); setDirty(false); setMessage(''); }
  async function save() { setBusy(true); try { const saved = await apiClient.saveDocument(workspaceId, draft); setDraft(saved); setDirty(false); await refresh(); onChanged(); setMessage('Saved. Future explanations will use this context. Existing explanations are marked stale.'); } catch(e: any) { setMessage(e.message); } finally {setBusy(false);} }
  return <section className="documents-view">
    <div className="page-heading"><div><h1>Project context</h1><p>Give the code its business context.</p></div><button onClick={() => choose({title:'', content:''})}>+ New document</button></div>
    <p className="context-intro">Add architecture notes, domain language, requirements, or a README. Saved documents join the codebase overview and source evidence in each explanation request to your configured model.</p>
    <div className="documents-layout"><nav aria-label="Project documents"><h3>Documents <span className="count">{docs.length}</span></h3>{docs.map(d => <button className={d.id === draft.id ? 'active document-link' : 'document-link'} key={d.id} onClick={() => choose(d)}><span>▤</span><span>{d.title}<small>Revision {d.revision}</small></span></button>)}{!docs.length && <p>No documents yet. Start with what this application does and the terms your team uses.</p>}</nav>
      <div className="document-editor"><label>Document title<input maxLength={160} value={draft.title} placeholder="e.g. Architecture and order lifecycle" onChange={e => {setDraft({...draft,title:e.target.value});setDirty(true);}} /></label>
      <label>Context<textarea maxLength={100000} value={draft.content} placeholder="Describe the purpose of the application, its main workflows, and important design decisions…" onChange={e => {setDraft({...draft,content:e.target.value});setDirty(true);}} /></label>
      <div className="editor-actions"><label className="file-button">Import .md or .txt<input type="file" accept=".md,.txt,.markdown" onChange={async e => {const f=e.target.files?.[0]; if (!f) return; if (f.size > 100000) {setMessage('Choose a text file under 100 KB.');return;} if(dirty&&!window.confirm('Replace unsaved document text with this file?'))return;setDraft({...draft,title:draft.title||f.name,content:await f.text()});setDirty(true);}}/></label><span className="muted">{draft.content.length.toLocaleString()} / 100,000</span><button className="primary" disabled={busy || !draft.title.trim() || !draft.content.trim()} onClick={save}>{busy?'Saving…':'Save context'}</button></div>
      {draft.id && <button className="danger-link" disabled={busy} onClick={async()=>{if(!window.confirm(`Delete “${draft.title}”?`))return;setBusy(true);try{await apiClient.deleteDocument(workspaceId,draft.id!);setDraft({title:'',content:''});setDirty(false);await refresh();onChanged();setMessage('Document deleted. Explanations marked stale.');}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Delete document</button>}
      <p role="status" className="form-message">{message}</p><p className="muted">Stored locally with this project. Documents provide context; parser evidence still determines dependencies. Large context is shortened with explicit limits.</p></div>
    </div>
  </section>;
}
