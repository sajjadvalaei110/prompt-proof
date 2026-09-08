import { useState } from 'react';
import { apiClient } from '../../api/client';

interface InspectorPanelProps {
  selectedNode: any | null;
  selectedEdge: any | null;
  workspaceId: string | null;
  snapshotId: string | null;
  routes: any[];
  injections: any[];
  onExplanationRequested?: () => void;
}

export default function InspectorPanel({
  selectedNode,
  selectedEdge,
  workspaceId,
  snapshotId,
  routes,
  injections,
  onExplanationRequested,
}: InspectorPanelProps) {
  const [explaining, setExplaining] = useState(false);
  const [explanationMsg, setExplanationMsg] = useState<string | null>(null);

  const handleRequestExplanation = async () => {
    if (!selectedNode || !workspaceId || !snapshotId) return;
    try {
      setExplaining(true);
      setExplanationMsg('Submitting priority request...');
      await apiClient.requestExplanation(workspaceId, snapshotId, selectedNode.id, 'symbol');
      setExplanationMsg('Queued at high priority!');
      if (onExplanationRequested) onExplanationRequested();
    } catch (e: any) {
      setExplanationMsg(`Error: ${e.message}`);
    } finally {
      setExplaining(false);
    }
  };

  // Find related routes for this node
  const nodeRoutes = selectedNode
    ? routes.filter(r => r.handler_qualified?.startsWith(selectedNode.qualifiedName) || r.handler_qualified === selectedNode.qualifiedName)
    : [];

  // Find related injections for this node
  const nodeInjections = selectedNode
    ? injections.filter(ip => ip.source_qualified === selectedNode.qualifiedName || ip.target_type_name?.includes(selectedNode.simpleName))
    : [];

  return (
    <aside
      style={{
        width: '380px',
        borderLeft: '1px solid #333',
        backgroundColor: '#161622',
        color: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        fontSize: '13px',
      }}
    >
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #28283a', background: '#1e1e2f' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: '#fff' }}>Inspector</h3>
      </div>

      {!selectedNode && !selectedEdge ? (
        <div style={{ padding: '24px 16px', color: '#888', textAlign: 'center' }}>
          Select a node or edge in the graph to inspect Spring details, routes, injections, and explanations.
        </div>
      ) : null}

      {selectedNode ? (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#888', letterSpacing: '0.5px' }}>
              {selectedNode.kind}
            </div>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', wordBreak: 'break-word' }}>
              {selectedNode.label || selectedNode.simpleName}
            </div>
            <div style={{ fontSize: '11px', color: '#888', wordBreak: 'break-all', marginTop: '2px' }}>
              {selectedNode.qualifiedName}
            </div>
          </div>

          {/* Spring Roles */}
          {selectedNode.roles && selectedNode.roles.length > 0 ? (
            <div style={{ background: '#1c2230', padding: '8px 12px', borderRadius: '4px', border: '1px solid #2c3e55' }}>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#4fc3f7', marginBottom: '4px' }}>
                Spring Stereotypes
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {selectedNode.roles.map((role: string) => (
                  <span
                    key={role}
                    style={{
                      background: '#0277bd',
                      color: '#fff',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '11px',
                    }}
                  >
                    @{role}
                  </span>
                ))}
              </div>
              {selectedNode.responsibilitySummary ? (
                <div style={{ fontSize: '11px', color: '#bbb', marginTop: '6px' }}>
                  {selectedNode.responsibilitySummary}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Explanation Section */}
          <div style={{ background: '#1e1e2d', padding: '10px 12px', borderRadius: '4px', border: '1px solid #333' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: '600', color: '#aaa' }}>Explanation Status:</span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 'bold',
                  color:
                    selectedNode.explanationStatus === 'READY'
                      ? '#4caf50'
                      : selectedNode.explanationStatus === 'STALE'
                      ? '#ff9800'
                      : selectedNode.explanationStatus === 'QUEUED'
                      ? '#03a9f4'
                      : '#9e9e9e',
                }}
              >
                {selectedNode.explanationStatus || 'NOT_REQUESTED'}
              </span>
            </div>
            <button
              onClick={handleRequestExplanation}
              disabled={explaining || !workspaceId}
              style={{
                width: '100%',
                padding: '6px 12px',
                background: '#4527a0',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: explaining ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '12px',
              }}
            >
              {explaining ? 'Requesting...' : 'Explain Symbol (Priority)'}
            </button>
            {explanationMsg ? (
              <div style={{ fontSize: '11px', color: '#4caf50', marginTop: '4px', textAlign: 'center' }}>
                {explanationMsg}
              </div>
            ) : null}
          </div>

          {/* HTTP Routes */}
          {nodeRoutes.length > 0 ? (
            <div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#66bb6a', marginBottom: '6px' }}>
                HTTP Endpoints ({nodeRoutes.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {nodeRoutes.map((r: any) => (
                  <div
                    key={r.id || r.path + r.http_method}
                    style={{ background: '#1c2820', padding: '6px 10px', borderRadius: '4px', border: '1px solid #2e4d35' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontWeight: 'bold',
                          fontSize: '10px',
                          color: '#fff',
                          background:
                            r.http_method === 'GET'
                              ? '#2e7d32'
                              : r.http_method === 'POST'
                              ? '#1565c0'
                              : r.http_method === 'DELETE'
                              ? '#c62828'
                              : '#f57f17',
                          padding: '1px 6px',
                          borderRadius: '3px',
                        }}
                      >
                        {r.http_method}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#a5d6a7' }}>{r.path}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '3px' }}>
                      Handler: {r.handler_method || r.handler_qualified?.split('.').pop()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Injections */}
          {nodeInjections.length > 0 ? (
            <div>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#f48fb1', marginBottom: '6px' }}>
                Dependency Injections ({nodeInjections.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {nodeInjections.map((ip: any) => (
                  <div
                    key={ip.id || ip.target_type_name}
                    style={{ background: '#251c24', padding: '6px 10px', borderRadius: '4px', border: '1px solid #4a2842' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#f06292', fontWeight: 'bold' }}>
                        {ip.injection_kind}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 'bold',
                          color: ip.resolution === 'RESOLVED' ? '#81c784' : '#ffb74d',
                        }}
                      >
                        {ip.resolution}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#fff', wordBreak: 'break-all', marginTop: '2px' }}>
                      {ip.target_type_name?.split('.').pop()}
                    </div>
                    {ip.qualifier_value ? (
                      <div style={{ fontSize: '10px', color: '#ba68c8', marginTop: '2px' }}>
                        Qualifier: @Qualifier("{ip.qualifier_value}")
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedEdge ? (
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#888' }}>Relationship</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#ffb74d' }}>{selectedEdge.kind}</div>
          </div>
          <div style={{ background: '#1e1e2d', padding: '10px', borderRadius: '4px' }}>
            <div style={{ fontSize: '11px', color: '#aaa' }}>Label: {selectedEdge.label}</div>
            <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>Resolution: {selectedEdge.resolution}</div>
            {selectedEdge.hoverSummary ? (
              <div style={{ fontSize: '11px', color: '#81c784', marginTop: '6px' }}>{selectedEdge.hoverSummary}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
