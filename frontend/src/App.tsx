import { useState } from 'react';
import './styles/App.css';
import { apiClient } from './api/client';
import GraphCanvas from './features/explorer/GraphCanvas';

function App() {
  const [workspacePath, setWorkspacePath] = useState('');
  const [status, setStatus] = useState('Idle');
  const [graphData, setGraphData] = useState<{nodes: any[], edges: any[]} | null>(null);

  const handleImport = async () => {
    try {
      setStatus('Creating workspace...');
      const ws = await apiClient.createWorkspace(workspacePath);
      
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
      
      setStatus('Fetching graph...');
      const wsUpdated = await apiClient.getWorkspace(ws.id);
      if (wsUpdated.activeSnapshotId) {
        const graph = await apiClient.getGraph(wsUpdated.activeSnapshotId);
        setGraphData(graph);
        setStatus('Graph loaded');
      } else {
        setStatus('No snapshot available');
      }
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  };

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header className="app-header" style={{ padding: '10px', background: '#2c3e50', color: 'white', display: 'flex', gap: '20px', alignItems: 'center' }}>
        <div className="brand" style={{ fontWeight: 'bold' }}>Code Atlas</div>
        
        <div style={{ display: 'flex', gap: '10px', flex: 1 }}>
          <input 
            type="text" 
            value={workspacePath} 
            onChange={e => setWorkspacePath(e.target.value)} 
            placeholder="Absolute path to Java project (e.g. /home/sajjad/...)"
            style={{ flex: 1, padding: '5px' }}
          />
          <button onClick={handleImport} style={{ padding: '5px 15px' }}>Analyze</button>
        </div>
        
        <div>Status: {status}</div>
      </header>

      <main className="app-main" style={{ flex: 1, display: 'flex', position: 'relative' }}>
        {graphData ? (
          <GraphCanvas nodes={graphData.nodes} edges={graphData.edges} />
        ) : (
          <div style={{ margin: 'auto', color: '#666' }}>Enter a workspace path to begin analysis</div>
        )}
      </main>
    </div>
  );
}

export default App;
