export interface Workspace {
  id: string;
  name: string;
  path: string;
  language: Language;
}

export interface AnalysisJob {
  id: string;
  status: JobStatus;
}

export interface Snapshot {
  id: string;
  timestamp: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  label: string;
  kind: SymbolKind;
  summary?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationshipKind;
  resolutionStatus: ResolutionStatus;
  label?: string;
}

export interface SymbolDetail {
  id: string;
  name: string;
  kind: SymbolKind;
}

export interface RelationshipDetail {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationshipKind;
}

export interface EvidenceDetail {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface ExplanationResponse {
  status: ExplanationStatus;
  shortLabel?: string;
  hoverSummary?: string;
  claims: Claim[];
  unknowns?: string[];
  suggestedNextSymbolIds?: string[];
  provenance?: string;
  errorDetail?: string;
}

export interface Claim {
  description?: string;
  text?: string;
  basis: ClaimBasis;
  evidenceIds: string[];
}

export interface SearchResult {
  id: string;
  name: string;
  kind: SymbolKind;
  module: string;
}

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
/** Languages exposed by the import contract. Add a value only when its adapter ships. */
export type Language = 'java';
export type ExplanationStatus = 'NOT_REQUESTED' | 'QUEUED' | 'RUNNING' | 'READY' | 'STALE' | 'FAILED' | 'PENDING';
export type ResolutionStatus = 'RESOLVED' | 'CANDIDATE' | 'UNRESOLVED';
export type SymbolKind = 'PACKAGE' | 'CLASS' | 'METHOD';
/** Every kind the backend can emit. Mirrors `src/main/java/dev/codeatlas/api/dto/enums/RelationshipKind.java`
 * exactly -- a kind added there without being added here makes this union silently lie about the wire shape. */
export type RelationshipKind = 'EXTENDS' | 'IMPLEMENTS' | 'CALLS' | 'CONSTRUCTS' | 'USES_TYPE' | 'READS_FIELD' | 'WRITES_FIELD' | 'INJECTS' | 'DECLARES_BEAN' | 'HANDLES_ROUTE' | 'DEPENDS_ON';
export type ClaimBasis = 'SOURCE_FACT' | 'INFERRED_PURPOSE' | 'UNKNOWN' | 'SOURCE' | 'INFERRED' | 'USER';
export type GraphLevel = 'PACKAGE' | 'CLASS' | 'METHOD';
export type Direction = 'INCOMING' | 'OUTGOING' | 'BOTH';

export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
}

export interface ModelTestResult {
  success: boolean;
  message: string;
}
