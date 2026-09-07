
export function ImportScreen() {
  return (
    <div style={{ padding: 'var(--spacing-3)' }}>
      <h2>Import Workspace</h2>
      <div>
        <label>Repository Path: </label>
        <input type="text" placeholder="/path/to/repo" />
        <button>Scan Source</button>
      </div>
    </div>
  );
}
