import { useEffect, useRef, useState } from 'react';

interface Props {
  /** The rendered prompt (Markdown), already fetched. */
  text: string;
  /** Whether opening it already put the prompt on the clipboard. */
  copied: boolean;
  fileName: string;
  onClose: () => void;
}

/**
 * The design prompt (ADR 0015): what the engineer designed, as a work order for an AI coding agent.
 * Opening it copies the prompt; the dialog shows it and offers Copy again and Download.
 */
export default function DesignPromptDialog({ text, copied, fileName, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState(copied ? 'Copied to the clipboard.' : 'Select the text or use Copy.');
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNote('Copied to the clipboard.'); }
    catch { setNote('The browser blocked the clipboard. Select the text and copy it.'); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <dialog ref={dialog} className="settings-dialog design-dialog design-prompt-dialog" onCancel={onClose} onClose={onClose} aria-label="Prompt for an AI coding agent">
    <header><div><h2>Prompt for an AI coding agent</h2><p>Only what you designed: planned resources, designed relations and every intention. Paste it into your agent; it reports back through the design API.</p></div><button onClick={onClose} aria-label="Close prompt">✕</button></header>
    <textarea className="design-prompt-text" readOnly value={text} rows={18} aria-label="Prompt text"/>
    <p className="design-prompt-note" role="status">{note}</p>
    <div className="settings-actions">
      <button type="button" onClick={download}>Download .md</button>
      <button type="button" onClick={() => void copy()}>Copy</button>
      <button type="button" className="primary" onClick={onClose}>Done</button>
    </div>
  </dialog>;
}
