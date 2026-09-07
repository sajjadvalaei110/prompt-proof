
export function ModelStatusIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title="Model connected">
      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'green' }}></span>
      <span style={{ fontSize: '0.9em' }}>Model OK</span>
    </div>
  );
}
