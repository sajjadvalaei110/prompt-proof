export interface Workspace {
  id: string;
  name: string;
  path: string;
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
  claims: Claim[];
}

export interface Claim {
  text: string;
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
export type ExplanationStatus = 'PENDING' | 'READY' | 'FAILED';
export type ResolutionStatus = 'RESOLVED' | 'CANDIDATE' | 'UNRESOLVED';
export type SymbolKind = 'PACKAGE' | 'CLASS' | 'METHOD';
export type RelationshipKind = 'CALLS' | 'IMPLEMENTS' | 'DEPENDS_ON';
export type ClaimBasis = 'SOURCE' | 'INFERRED' | 'USER';
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
