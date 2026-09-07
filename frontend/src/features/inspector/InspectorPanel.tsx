
export default function InspectorPanel() {
  return (
    <div style={{ width: '360px', borderLeft: '1px solid var(--border-color)', backgroundColor: 'var(--bg-panel)' }}>
      <div style={{ padding: 'var(--spacing-2)' }}>
        <h3>Inspector</h3>
        <p>Select a node or edge to view details.</p>
      </div>
    </div>
  );
}
