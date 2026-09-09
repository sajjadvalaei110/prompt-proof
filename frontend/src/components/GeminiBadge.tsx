import { useId } from 'react';

/** A completion marker for any configured model, not a provider identity. */
export default function GeminiBadge() {
  const gradient = useId();
  return <span className="gemini-badge" role="img" aria-label="Explanation ready" title="Explanation ready">
    <svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#9461ef"/><stop offset=".6" stopColor="#4b8af2"/><stop offset="1" stopColor="#80ddff"/></linearGradient></defs><path fill={`url(#${gradient})`} d="M12 1C13.4 8.1 15.9 10.6 23 12C15.9 13.4 13.4 15.9 12 23C10.6 15.9 8.1 13.4 1 12C8.1 10.6 10.6 8.1 12 1Z"/><path d="m19 2 .7 2.3L22 5l-2.3.7L19 8l-.7-2.3L16 5l2.3-.7Z" fill="#a9e7ff"/></svg>
  </span>;
}
