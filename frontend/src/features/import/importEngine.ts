import type { IndexerOption, WorkspaceLanguage } from '../../api/client';

/**
 * Each language's source-only default engine id, used when the engine list could not be loaded.
 * Must match the backend's default adapter for the language (ADR 0012).
 */
export const DEFAULT_INDEXER_BY_LANGUAGE: Record<WorkspaceLanguage, string> = { java: 'javaparser' };

/** What an import submission sends: always an explicit engine, so the server never silently keeps an older one. */
export interface ImportEngineChoice {
  indexer: string;
  allowBuildExecution: boolean;
  /**
   * The repository root field (ADR 0015). The import form always sends it — empty means auto-detect — so the
   * form replaces whatever was stored; omitted (Re-analyze source, Recent projects) keeps the stored root.
   */
  repositoryRoot?: string;
}

/**
 * The engine the import picker displays: the selected one when the language ships it, else the language's
 * default from the engine list, else the built-in source-only default when that list is unavailable.
 */
export function displayedIndexer(indexers: readonly IndexerOption[], language: WorkspaceLanguage, selected: string): IndexerOption | null {
  const engines = indexers.filter(option => option.language === language);
  return engines.find(option => option.indexer === selected) ?? engines.find(option => option.defaultIndexer) ?? null;
}

/**
 * The engine an import form submission sends (ADR 0012). It is always explicit — the engine the picker shows —
 * so registering a path that already exists with a build-running engine never keeps that engine (and its build
 * consent) while the form shows a source-only one. Build execution is allowed only when the displayed engine
 * runs the build and the consent box is ticked.
 */
export function importEngineChoice(indexers: readonly IndexerOption[], language: WorkspaceLanguage, selected: string, allowBuild: boolean, repositoryRoot?: string): ImportEngineChoice {
  const shown = displayedIndexer(indexers, language, selected);
  const root = repositoryRoot === undefined ? {} : { repositoryRoot: repositoryRoot.trim() };
  if (!shown) return { indexer: DEFAULT_INDEXER_BY_LANGUAGE[language], allowBuildExecution: false, ...root };
  return { indexer: shown.indexer, allowBuildExecution: shown.executesTargetBuild && allowBuild, ...root };
}

/** What a registration may carry beyond the path and language; every field omitted keeps the stored value. */
export interface WorkspaceRegistration { indexer?: string; allowBuildExecution?: boolean; repositoryRoot?: string }

/**
 * The `POST /api/workspaces` body. The engine and its consent travel together (ADR 0012); the repository root
 * travels whenever it is given, including empty (clear it: auto-detect), and is left out to keep it (ADR 0015).
 */
export function workspaceRequestBody(path: string, language: WorkspaceLanguage, engine: WorkspaceRegistration = {}) {
  return {
    path,
    language,
    ...(engine.indexer ? { indexer: engine.indexer, allowBuildExecution: !!engine.allowBuildExecution } : {}),
    ...(engine.repositoryRoot !== undefined ? { repositoryRoot: engine.repositoryRoot.trim() } : {}),
  };
}
