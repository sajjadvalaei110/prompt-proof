const API_BASE = '/api';

export const apiClient = {
  getHealth: async () => {
    const res = await fetch(`${API_BASE}/health`);
    return res.json();
  },
  createWorkspace: async (path: string) => {
    const res = await fetch(`${API_BASE}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    return res.json();
  },
  getWorkspace: async (id: string) => {
    const res = await fetch(`${API_BASE}/workspaces/${id}`);
    return res.json();
  },
  triggerAnalysis: async (workspaceId: string) => {
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/analysis-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    return res.json();
  },
  getJob: async (jobId: string) => {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`);
    return res.json();
  },
  getGraph: async (snapshotId: string) => {
    const res = await fetch(`${API_BASE}/snapshots/${snapshotId}/graph`);
    return res.json();
  }
};
