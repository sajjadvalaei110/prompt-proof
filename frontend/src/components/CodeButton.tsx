import type { CSSProperties } from 'react';

/** The `</>` quick-code glyph, sized by the surrounding font/box. */
export function CodeIcon() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15"/></svg>;
}

/** Opens the existing read-only source dialog for one class or method without changing inspection. */
export default function CodeButton({ name, kind, onClick, className = '', style }: { name: string; kind: string; onClick: () => void; className?: string; style?: CSSProperties }) {
  const what = kind === 'METHOD' || kind === 'CONSTRUCTOR' ? 'method' : 'class';
  return <button type="button" className={`code-button ${className}`} style={style} aria-label={`View code for ${name}`} title={`View ${what} code`} onClick={event => { event.stopPropagation(); onClick(); }}><CodeIcon /></button>;
}
