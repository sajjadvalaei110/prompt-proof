import { useState, useEffect } from 'react';
import './styles/App.css';
import { apiClient } from './api/client';
import GraphCanvas from './features/explorer/GraphCanvas';
import InspectorPanel from './features/inspector/InspectorPanel';
import SettingsScreen from './features/settings/SettingsScreen';

function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const [workspacePath, setWorkspacePath] = useState(queryParams.get('path') || '');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [status, setStatus] = useState(queryParams.get('preview') === 'true' ? 'Ready (Preview Mode)' : 'Idle');
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[]; metadata?: any } | null>(() => {
    if (queryParams.get('preview') === 'true') {
      return {
        nodes: [
          { id: 'pkg-1', simpleName: 'dev.codeatlas.order', kind: 'PACKAGE' },
          { id: 'cls-1', simpleName: 'OrderController', kind: 'CLASS', parentId: 'pkg-1', roles: ['REST_CONTROLLER'] },
          { id: 'cls-2', simpleName: 'OrderService', kind: 'CLASS', parentId: 'pkg-1', roles: ['SERVICE'] },
          { id: 'cls-3', simpleName: 'OrderRepository', kind: 'INTERFACE', parentId: 'pkg-1', roles: ['REPOSITORY'] },
          { id: 'm-1', simpleName: 'createOrder()', kind: 'METHOD', parentId: 'cls-1' },
          { id: 'm-2', simpleName: 'processOrder()', kind: 'METHOD', parentId: 'cls-2' },
        ],
        edges: [
          { id: 'e-1', sourceId: 'cls-1', targetId: 'cls-2', kind: 'INJECTS', resolution: 'RESOLVED' },
          { id: 'e-2', sourceId: 'cls-2', targetId: 'cls-3', kind: 'INJECTS', resolution: 'RESOLVED' },
          { id: 'e-3', sourceId: 'm-1', targetId: 'm-2', kind: 'CALLS', resolution: 'RESOLVED' },
        ]
      };
    }
    return null;
  });
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<any | null>(null);
  const [springRoutes, setSpringRoutes] = useState<any[]>([]);
  const [springInjections, setSpringInjections] = useState<any[]>([]);
  const [queueStatus, setQueueStatus] = useState<any | null>(null);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(() => queryParams.get('settings') === 'true');

  // Sync settings from localStorage on initial load if backend unconfigured
  useEffect(() => {
    const initSettings = async () => {
      try {
        const profiles = await apiClient.getModelProfiles();
        if ((!profiles || profiles.length === 0 || !profiles[0].baseUrl) && localStorage.getItem('codeatlas_model_settings')) {
          const saved = JSON.parse(localStorage.getItem('codeatlas_model_settings')!);
          if (saved && saved.baseUrl) {
            await apiClient.saveModelProfile(saved);
          }
        }
      } catch (e) {
        // Ignore startup sync errors
      }
    };
    initSettings();

    const autoPath = queryParams.get('autoPath');
    if (autoPath) {
      setWorkspacePath(autoPath);
      (async () => {
        try {
          setStatus('Analyzing autoPath...');
          const ws = await apiClient.createWorkspace(autoPath);
          setWorkspaceId(ws.id);
          const job = await apiClient.triggerAnalysis(ws.id);
          let cur = job;
          while (cur.status !== 'COMPLETED' && cur.status !== 'FAILED') {
            await new Promise(r => setTimeout(r, 400));
            cur = await apiClient.getJob(job.id);
          }
          const wsUpdated = await apiClient.getWorkspace(ws.id);
          if (wsUpdated.activeSnapshotId) {
            setSnapshotId(wsUpdated.activeSnapshotId);
            const [graph, routes, injections] = await Promise.all([
              apiClient.getGraph(wsUpdated.activeSnapshotId),
              apiClient.getSpringRoutes(wsUpdated.activeSnapshotId).catch(() => []),
              apiClient.getSpringInjections(wsUpdated.activeSnapshotId).catch(() => []),
            ]);
            setGraphData(graph);
            setSpringRoutes(routes);
            setSpringInjections(injections);
            setStatus(`Ready (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
          }
        } catch (err: any) {
          setStatus(`Error: ${err.message}`);
        }
      })();
    }
  }, []);

  // Poll queue status periodically when workspace is active
  useEffect(() => {
    if (!workspaceId) return;
    const interval = setInterval(async () => {
      try {
        const qs = await apiClient.getQueueStatus(workspaceId);
        setQueueStatus(qs);
        setIsBulkRunning(!!qs.activeJobId || qs.inProgress > 0);
      } catch (e) {
        // Ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [workspaceId]);

  const handleImport = async () => {
    try {
      setStatus('Creating workspace...');
      const ws = await apiClient.createWorkspace(workspacePath);
      setWorkspaceId(ws.id);

      setStatus('Triggering analysis...');
      const job = await apiClient.triggerAnalysis(ws.id);

      setStatus('Analysis running...');

      // Poll job
      let currentJob = job;
      while (currentJob.status !== 'COMPLETED' && currentJob.status !== 'FAILED') {
        await new Promise(r => setTimeout(r, 1000));
        currentJob = await apiClient.getJob(job.id);
      }

      if (currentJob.status === 'FAILED') {
        setStatus('Analysis failed');
        return;
      }

      setStatus('Fetching graph & Spring data...');
      const wsUpdated = await apiClient.getWorkspace(ws.id);
      if (wsUpdated.activeSnapshotId) {
        const activeSnap = wsUpdated.activeSnapshotId;
        setSnapshotId(activeSnap);

        const [graph, routes, injections] = await Promise.all([
          apiClient.getGraph(activeSnap),
          apiClient.getSpringRoutes(activeSnap).catch(() => []),
          apiClient.getSpringInjections(activeSnap).catch(() => []),
        ]);

        setGraphData(graph);
        setSpringRoutes(routes);
        setSpringInjections(injections);
        setStatus(`Ready (${graph.nodes.length} nodes, ${graph.edges.length} edges, ${routes.length} routes)`);
      } else {
        setStatus('No snapshot available');
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleExplainAll = async () => {
    if (!workspaceId || !snapshotId) return;
    try {
      setStatus('Starting Explain All job...');
      await apiClient.startExplainAll(workspaceId, snapshotId, 1);
      setStatus('Explain All running in background');
      const qs = await apiClient.getQueueStatus(workspaceId);
      setQueueStatus(qs);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const handleCancelBulk = async () => {
    if (!queueStatus?.activeJobId) return;
    try {
      await apiClient.cancelJob(queueStatus.activeJobId);
      setStatus('Bulk job cancelled');
      const qs = await apiClient.getQueueStatus(workspaceId!);
      setQueueStatus(qs);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        className="app-header"
        style={{
          padding: '8px 16px',
          background: '#1a1a2e',
          color: 'white',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          borderBottom: '1px solid #333',
        }}
      >
        <div className="brand" style={{ fontWeight: 'bold', fontSize: '15px', color: '#82b1ff' }}>
          Code Atlas
        </div>

        <div style={{ display: 'flex', gap: '8px', flex: 1 }}>
          <input
            type="text"
            value={workspacePath}
            onChange={e => setWorkspacePath(e.target.value)}
            placeholder="Absolute path to Java project (e.g. /home/sajjad/.../test-fixtures/spring-project)"
            style={{
              flex: 1,
              padding: '6px 10px',
              background: '#252538',
              border: '1px solid #444',
              color: '#fff',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          />
          <button
            onClick={handleImport}
            style={{
              padding: '6px 16px',
              background: '#1e88e5',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '12px',
            }}
          >
            Analyze
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            style={{
              padding: '6px 14px',
              background: '#2d2d44',
              color: '#fff',
              border: '1px solid #484860',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Configure OpenAI / Local LLM Settings"
          >
            ⚙ Settings
          </button>
        </div>

        {/* Explain All & Queue Status */}
        {snapshotId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={isBulkRunning ? handleCancelBulk : handleExplainAll}
              style={{
                padding: '5px 12px',
                background: isBulkRunning ? '#c62828' : '#3949ab',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: '600',
              }}
            >
              {isBulkRunning ? '⏹ Cancel Explain' : '⚡ Explain All'}
            </button>
            {queueStatus ? (
              <div style={{ fontSize: '11px', color: '#bbb', background: '#252538', padding: '4px 8px', borderRadius: '4px' }}>
                Queue: {queueStatus.pending} pending, {queueStatus.completed} done
              </div>
            ) : null}
          </div>
        ) : null}

        <div style={{ fontSize: '12px', color: '#aaa', minWidth: '150px', textAlign: 'right' }}>
          {status}
        </div>
      </header>

      <main className="app-main" style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {graphData ? (
          <>
            <GraphCanvas
              nodes={graphData.nodes}
              edges={graphData.edges}
              onNodeSelect={node => {
                setSelectedNode(node);
                setSelectedEdge(null);
              }}
              onEdgeSelect={edge => {
                setSelectedEdge(edge);
                setSelectedNode(null);
              }}
            />
            <InspectorPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              workspaceId={workspaceId}
              snapshotId={snapshotId}
              routes={springRoutes}
              injections={springInjections}
              onExplanationRequested={async () => {
                if (workspaceId) {
                  const qs = await apiClient.getQueueStatus(workspaceId);
                  setQueueStatus(qs);
                }
              }}
            />
          </>
        ) : (
          <div style={{ margin: 'auto', color: '#666', textAlign: 'center' }}>
            <h2>Welcome to Code Atlas</h2>
            <p>Enter a workspace path above and click <strong>Analyze</strong> to explore Spring structure and explanations.</p>
          </div>
        )}
      </main>

      {/* LLM & Model Settings Modal */}
      <SettingsScreen
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
