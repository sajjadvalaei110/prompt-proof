import type { Language } from '../types';
import { workspaceRequestBody, type WorkspaceRegistration } from '../features/import/importEngine';

const API_BASE = '/api';

export type WorkspaceLanguage = Language;
/** One definition site from go to definition (1-based, inclusive end column, UTF-16 code units). */
/** `snapshotId`: where to open it (ADR 0014); `differsFromChange`: it opens in the current analysis, not the change. */
export interface DefinitionLocation { path: string; startLine: number; startColumn: number; endLine: number; endColumn: number; displayName?: string | null; signature?: string | null; symbolId?: string | null; snapshotId?: string | null; differsFromChange?: boolean }
export interface DefinitionResult { status: 'found' | 'external' | 'no_symbol' | 'not_indexed' | 'stale'; locations: DefinitionLocation[]; indexer?: string | null; indexerLabel?: string | null; navigationIndexers?: string[]; servedFrom?: { snapshotId: string; label?: string | null } | null }
/** One indexing engine of a language (ADR 0012). `executesTargetBuild` engines need explicit consent;
 * `providesNavigation` engines fill the occurrence index behind go to definition (ADR 0013). */
export interface IndexerOption {
  language: WorkspaceLanguage;
  indexer: string;
  label: string;
  defaultIndexer: boolean;
  executesTargetBuild: boolean;
  available: boolean;
  unavailableReason: string | null;
  providesNavigation?: boolean;
}

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
  /** Whole retained file content by path, for building a git-style diff between two snapshots. */
  getSnapshotFile: (snapshot: string, path: string): Promise<{schemaVersion:string;path:string;content:string}> =>
    requestJson(`${API_BASE}/snapshots/${snapshot}/files/source?path=${encodeURIComponent(path)}`),

  /** Every resolved name in one file of a snapshot, for go to definition (ADR 0013). Decode with `codeTokens.decodeOccurrences`. */
  getFileOccurrences: (snapshot: string, path: string): Promise<any> =>
    requestJson(`${API_BASE}/snapshots/${snapshot}/files/occurrences?path=${encodeURIComponent(path)}`),
  /** Go to definition for the resolved name at a 1-based line and column (UTF-16 code units). */
  getDefinition: (snapshot: string, path: string, line: number, column: number): Promise<DefinitionResult> =>
    requestJson(`${API_BASE}/snapshots/${snapshot}/files/definition?path=${encodeURIComponent(path)}&line=${line}&column=${column}`),

  /**
   * Registers (or reuses) a workspace. `engine.indexer` omitted keeps an existing workspace's engine (ADR 0012);
   * `engine.repositoryRoot` omitted keeps its root, empty clears it (ADR 0015).
   */
  createWorkspace: (path: string, language: WorkspaceLanguage = 'java', engine: WorkspaceRegistration = {}): Promise<any> =>
    requestJson(`${API_BASE}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workspaceRequestBody(path, language, engine))
    }),

  /** Shipped indexing engines per language, with whether each can run on this machine. */
  listIndexers: (): Promise<IndexerOption[]> => requestJson(`${API_BASE}/indexers`),

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
