
export default function NavigationPane() {
  return (
    <div style={{ width: '240px', borderRight: '1px solid var(--border-color)', backgroundColor: 'var(--bg-panel)' }}>
      <div style={{ padding: 'var(--spacing-2)' }}>
        <h3>Navigation</h3>
        <ul>
          <li>Package 1</li>
          <li>Package 2</li>
        </ul>
      </div>
    </div>
  );
}
