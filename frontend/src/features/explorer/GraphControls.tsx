
export function GraphControls() {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 'var(--spacing-1)', display: 'flex', gap: 'var(--spacing-2)', background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(4px)', zIndex: 10 }}>
      <select><option>Class</option><option>Method</option><option>Package</option></select>
      <select><option>Depth 1</option><option>Depth 2</option></select>
      <select><option>Incoming</option><option>Outgoing</option><option>Both</option></select>
      <button>Fit View</button>
    </div>
  );
}
