import type { FormEvent } from 'react';
import type { IndexerOption, WorkspaceLanguage } from '../../api/client';
import { displayedIndexer, importEngineChoice, type ImportEngineChoice } from './importEngine';

export interface ImportScreenProps {
  path: string;
  language: WorkspaceLanguage;
  busy: boolean;
  graphOpen: boolean;
  onPathChange: (path: string) => void;
  /** Optional repository root (ADR 0015): the Git repository and the build's upper boundary; empty = auto-detect. */
  repositoryRoot?: string;
  onRepositoryRootChange?: (root: string) => void;
  onLanguageChange: (language: WorkspaceLanguage) => void;
  /** Receives the engine the picker displays, always explicit (ADR 0012). */
  onSubmit: (engine: ImportEngineChoice) => void;
  /** Engines the backend ships (all languages); only the selected language's are offered. */
  indexers?: IndexerOption[];
  /** Selected engine id; empty means the language's default engine. */
  indexer?: string;
  onIndexerChange?: (indexer: string) => void;
  /** Explicit consent that a build-running engine may run this project's build (ADR 0012). */
  allowBuild?: boolean;
  onAllowBuildChange?: (allow: boolean) => void;
  recent?: Array<{ id: string; path: string; language: WorkspaceLanguage; indexer?: string; activeSnapshotId?: string | null; repositoryRoot?: string | null }>;
  onOpenRecent?: (workspace: NonNullable<ImportScreenProps['recent']>[number]) => void;
}

/**
 * The import entry point shared by the welcome and open-project states. The option lists are
 * intentionally capability based: only shipped languages and engines are offered, an engine that
 * cannot run on this machine is shown disabled with its reason, and an engine that runs the
 * project's own build cannot be submitted until the user explicitly allows that.
 */
export function ImportScreen({
  path,
  language,
  busy,
  graphOpen,
  onPathChange,
  repositoryRoot = '',
  onRepositoryRootChange,
  onLanguageChange,
  onSubmit,
  indexers = [],
  indexer = '',
  onIndexerChange,
  allowBuild = false,
  onAllowBuildChange,
  recent = [],
  onOpenRecent,
}: ImportScreenProps) {
  const engines = indexers.filter(option => option.language === language);
  const selected = displayedIndexer(indexers, language, indexer) ?? undefined;
  const needsConsent = !!selected?.executesTargetBuild;
  const blocked = !!selected && !selected.available;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked || (needsConsent && !allowBuild)) return;
    onSubmit(importEngineChoice(indexers, language, indexer, allowBuild, repositoryRoot));
  };

  return (
    <section className={graphOpen ? 'open-project-bar' : 'welcome'}>
      <div>
        <span className="welcome-icon">◈</span>
        <h1>{graphOpen ? 'Open a project' : 'Find your way through the code.'}</h1>
        <p>Explore the structure. Follow a dependency. Understand why it exists.</p>
      </div>
      <form onSubmit={submit}>
        <label>Local repository path
          <input
            aria-label="Local repository path"
            value={path}
            onChange={event => onPathChange(event.target.value)}
            placeholder="/path/to/your/java-project"
            disabled={busy}
          />
        </label>
        <label>Repository root
          <input
            aria-label="Repository root"
            value={repositoryRoot}
            onChange={event => onRepositoryRootChange?.(event.target.value)}
            placeholder="Optional · auto-detect"
            title="When the path above is a module or subdirectory: the directory that holds the Git repository and the build settings. Leave empty to auto-detect."
            disabled={busy}
          />
        </label>
        <label>Language
          <select
            aria-label="Source language"
            value={language}
            onChange={event => onLanguageChange(event.target.value as WorkspaceLanguage)}
            disabled={busy}
          >
            <option value="java">Java</option>
          </select>
        </label>
        {engines.length > 1 && <label>Indexer
          <select
            aria-label="Indexer"
            value={selected?.indexer ?? ''}
            onChange={event => onIndexerChange?.(event.target.value)}
            disabled={busy}
          >
            {engines.map(option => <option
              key={option.indexer}
              value={option.indexer}
              disabled={!option.available}
              title={option.unavailableReason ?? undefined}
            >{option.label}{option.available ? '' : ' — not installed'}</option>)}
          </select>
        </label>}
        {needsConsent && <label className="build-consent">
          <input
            type="checkbox"
            aria-label="Allow this project's build to run"
            checked={allowBuild}
            onChange={event => onAllowBuildChange?.(event.target.checked)}
            disabled={busy}
          />
          Allow this project's Gradle build to run. Its build scripts execute on this machine, in a private copy of the repository.
        </label>}
        <button className="primary" type="submit" disabled={busy || blocked || (needsConsent && !allowBuild)}>
          {busy ? 'Analyzing…' : 'Analyze project'}
        </button>
      </form>
      {blocked && selected?.unavailableReason && <p className="notice">{selected.unavailableReason}</p>}
      <p className="muted">{needsConsent
        ? 'Compiler-accurate analysis. The repository itself stays read-only: Gradle runs in a private copy, reusing dependencies already in your Gradle cache (offline first).'
        : 'Source-only analysis. Your repository is read-only; no Gradle builds or application code are executed.'}</p>
      {recent.length > 0 && <div className="recent-projects">
        <h3>Recent projects</h3>
        {recent.map(workspace => <button
          key={workspace.id}
          type="button"
          disabled={busy}
          onClick={() => onOpenRecent?.(workspace)}
        >
          <span>▱ {workspace.path.split('/').filter(Boolean).pop() || workspace.path}<small>{workspace.path}</small>{workspace.repositoryRoot && <small className="recent-root">Repository root: {workspace.repositoryRoot}</small>}</span>
          <span>Open ↗</span>
        </button>)}
      </div>}
    </section>
  );
}
