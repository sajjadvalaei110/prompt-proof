const API_BASE = '/api';

/**
 * API client for Code Atlas backend.
 *
 * R3/R4 additions:
 * - Spring routes/injections/components queries
 * - Explanation queue management (explain all, request explanation, queue status)
 * - Job cancellation
 */
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
  },

  // --- R3: Spring-specific endpoints ---

  /** Get HTTP routes for a snapshot */
  getSpringRoutes: async (snapshotId: string) => {
    const res = await fetch(`${API_BASE}/snapshots/${snapshotId}/spring/routes`);
    return res.json();
  },
  /** Get injection points for a snapshot */
  getSpringInjections: async (snapshotId: string) => {
    const res = await fetch(`${API_BASE}/snapshots/${snapshotId}/spring/injections`);
    return res.json();
  },
  /** Get Spring components for a snapshot */
  getSpringComponents: async (snapshotId: string) => {
    const res = await fetch(`${API_BASE}/snapshots/${snapshotId}/spring/components`);
    return res.json();
  },

  // --- R4: Explanation queue endpoints ---

  /** Start a bulk "Explain All" job */
  startExplainAll: async (workspaceId: string, snapshotId: string, concurrency: number = 1) => {
    const res = await fetch(
      `${API_BASE}/explanation-jobs?workspaceId=${workspaceId}&snapshotId=${snapshotId}&concurrency=${concurrency}`,
      { method: 'POST' }
    );
    return res.json();
  },
  /** Request a single high-priority explanation (user click) */
  requestExplanation: async (workspaceId: string, snapshotId: string, subjectId: string, subjectType: string) => {
    const res = await fetch(
      `${API_BASE}/explanations/request?workspaceId=${workspaceId}&snapshotId=${snapshotId}&subjectId=${subjectId}&subjectType=${subjectType}`,
      { method: 'POST' }
    );
    return res.json();
  },
  /** Cancel a running job */
  cancelJob: async (jobId: string) => {
    const res = await fetch(`${API_BASE}/jobs/${jobId}/cancel`, { method: 'POST' });
    return res.json();
  },
  /** Get explanation queue status for a workspace */
  getQueueStatus: async (workspaceId: string) => {
    const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/queue-status`);
    return res.json();
  },

  // --- Model Profile & LLM Settings ---

  /** Get active model profile settings */
  getModelProfiles: async () => {
    const res = await fetch(`${API_BASE}/model-profiles`);
    return res.json();
  },
  /** Update model profile settings in memory */
  saveModelProfile: async (profile: {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
    contextBudget: number;
    outputBudget: number;
    timeoutSeconds: number;
    temperature: number;
    concurrency?: number;
  }) => {
    const res = await fetch(`${API_BASE}/model-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    });
    return res.json();
  },
  /** Test model profile connection */
  testModelConnection: async (profile?: {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
    contextBudget?: number;
    outputBudget?: number;
    timeoutSeconds?: number;
    temperature?: number;
    concurrency?: number;
  }) => {
    const res = await fetch(`${API_BASE}/model-profiles/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: profile ? JSON.stringify(profile) : JSON.stringify({})
    });
    return res.json();
  },
};
