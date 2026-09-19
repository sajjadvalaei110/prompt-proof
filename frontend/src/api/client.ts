const API_BASE = '/api';

export interface ApiErrorResponse {
  timestamp?: string;
  status?: number;
  error?: string;
  message?: string;
  path?: string;
}

async function requestJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err: any) {
    throw new Error(`Failed to connect to Code Atlas server: ${err?.message || 'Connection refused'}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let errorDetail = '';
    if (isJson) {
      try {
        const body: ApiErrorResponse = await res.json();
        errorDetail = body.message || body.error || JSON.stringify(body);
      } catch {
        errorDetail = res.statusText;
      }
    } else {
      try {
        const text = await res.text();
        errorDetail = text.slice(0, 300);
      } catch {
        errorDetail = res.statusText;
      }
    }
    throw new Error(errorDetail || `Request failed with status ${res.status} (${res.statusText})`);
  }

  if (isJson) {
    return res.json();
  } else {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text as unknown as T;
    }
  }
}

/**
 * API client for Code Atlas backend.
 *
 * R3/R4 additions:
 * - Spring routes/injections/components queries
 * - Explanation queue management (explain all, request explanation, queue status)
 * - Job cancellation
 */
export const apiClient = {
  listWorkspaces: (): Promise<any[]> => requestJson(`${API_BASE}/workspaces`),
  getDocuments: (workspaceId: string): Promise<any[]> => requestJson(`${API_BASE}/workspaces/${workspaceId}/documents`),
  saveDocument: (workspaceId: string, doc: {id?: string; title: string; content: string}): Promise<any> => requestJson(`${API_BASE}/workspaces/${workspaceId}/documents${doc.id ? '/' + doc.id : ''}`, { method: doc.id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(doc) }),
  deleteDocument: (workspaceId: string, id: string): Promise<any> => requestJson(`${API_BASE}/workspaces/${workspaceId}/documents/${id}`, {method: 'DELETE'}),
  getSource: (snapshot: string, id: string, type = 'symbol'): Promise<any> => requestJson(`${API_BASE}/snapshots/${snapshot}/${type === 'symbol' ? 'symbols' : 'relationships'}/${id}/source`),
  getRelationshipsSource: (snapshot: string, ids: string[]): Promise<any[]> => requestJson(`${API_BASE}/snapshots/${snapshot}/relationships/source`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ ids }) }),
  getSubjectExplanation:(snapshot: string, id: string, type: string): Promise<any> => requestJson(`${API_BASE}/snapshots/${snapshot}/${type === 'symbol' ? 'symbols' : 'relationships'}/${id}/explanation`),
  getExplanationEvidence: (snapshot: string, id: string, type: string): Promise<any[]> => requestJson(`${API_BASE}/snapshots/${snapshot}/explanation-evidence/${id}?subjectType=${type}`),

  createWorkspace: (path: string): Promise<any> =>
    requestJson(`${API_BASE}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    }),

  getWorkspace: (id: string): Promise<any> => requestJson(`${API_BASE}/workspaces/${id}`),

  triggerAnalysis: (workspaceId: string): Promise<any> =>
    requestJson(`${API_BASE}/workspaces/${workspaceId}/analysis-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }),

  getJob: (jobId: string): Promise<any> => requestJson(`${API_BASE}/jobs/${jobId}`),

  getGraph: (snapshotId: string): Promise<any> =>
    requestJson(`${API_BASE}/snapshots/${snapshotId}/graph`),

  /** Creates one immutable base-vs-working-tree comparison. Its snapshots retain source evidence for both sides. */
  createReview: (workspaceId: string, baseRef?: string): Promise<any> =>
    requestJson(`${API_BASE}/workspaces/${workspaceId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: '1', ...(baseRef?.trim() ? { baseRef: baseRef.trim() } : {}) })
    }),

  // --- R3: Spring-specific endpoints ---

  /** Get HTTP routes for a snapshot */
  getSpringRoutes: (snapshotId: string): Promise<any> =>
    requestJson(`${API_BASE}/snapshots/${snapshotId}/spring/routes`),

  /** Get injection points for a snapshot */
  getSpringInjections: (snapshotId: string): Promise<any> =>
    requestJson(`${API_BASE}/snapshots/${snapshotId}/spring/injections`),

  // --- R4: Explanation queue endpoints ---

  /** Start a bulk "Explain All" job */
  startExplainAll: (workspaceId: string, snapshotId: string, concurrency: number = 1): Promise<any> =>
    requestJson(
      `${API_BASE}/explanation-jobs?workspaceId=${workspaceId}&snapshotId=${snapshotId}&concurrency=${concurrency}`,
      { method: 'POST' }
    ),

  /** Request a single high-priority explanation (user click) */
  requestExplanation: (workspaceId: string, snapshotId: string, subjectId: string, subjectType: string): Promise<any> =>
    requestJson(
      `${API_BASE}/explanations/request?workspaceId=${workspaceId}&snapshotId=${snapshotId}&subjectId=${subjectId}&subjectType=${subjectType}`,
      { method: 'POST' }
    ),

  /** Cancel a running job */
  cancelJob: (jobId: string): Promise<any> =>
    requestJson(`${API_BASE}/jobs/${jobId}/cancel`, { method: 'POST' }),

  /** Get explanation queue status for a workspace */
  getQueueStatus: (workspaceId: string): Promise<any> =>
    requestJson(`${API_BASE}/workspaces/${workspaceId}/queue-status`),

  // --- Model Profile & LLM Settings ---

  /** Get active model profile settings */
  getModelProfiles: (): Promise<any> => requestJson(`${API_BASE}/model-profiles`),

  /** Update model profile settings in memory */
  saveModelProfile: (profile: {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
    contextBudget: number;
    outputBudget: number;
    timeoutSeconds: number;
    temperature: number;
    concurrency?: number;
    userAgent?: string;
  }): Promise<any> =>
    requestJson(`${API_BASE}/model-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile)
    }),

  /** Test model profile connection */
  testModelConnection: (profile?: {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
    contextBudget?: number;
    outputBudget?: number;
    timeoutSeconds?: number;
    temperature?: number;
    concurrency?: number;
    userAgent?: string;
  }): Promise<any> =>
    requestJson(`${API_BASE}/model-profiles/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: profile ? JSON.stringify(profile) : JSON.stringify({})
    }),
};
