import type { FormEvent } from 'react';
import type { IndexerOption, WorkspaceLanguage } from '../../api/client';
import { displayedIndexer, importEngineChoice, type ImportEngineChoice } from './importEngine';

export interface ImportScreenProps {
  path: string;
  language: WorkspaceLanguage;
  busy: boolean;
  graphOpen: boolean;
  onPathChange: (path: string) => void;
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
  recent?: Array<{ id: string; path: string; language: WorkspaceLanguage; indexer?: string; activeSnapshotId?: string | null; designOnly?: boolean; name?: string | null }>;
  onOpenRecent?: (workspace: NonNullable<ImportScreenProps['recent']>[number]) => void;
  /** Opens an exported map with no code (ADR 0016): it becomes a new design-only project. */
  onImportMap?: (file: File) => void;
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
  onLanguageChange,
  onSubmit,
  indexers = [],
  indexer = '',
  onIndexerChange,
  allowBuild = false,
  onAllowBuildChange,
  recent = [],
  onOpenRecent,
  onImportMap,
}: ImportScreenProps) {
  const engines = indexers.filter(option => option.language === language);
  const selected = displayedIndexer(indexers, language, indexer) ?? undefined;
  const needsConsent = !!selected?.executesTargetBuild;
  const blocked = !!selected && !selected.available;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked || (needsConsent && !allowBuild)) return;
    onSubmit(importEngineChoice(indexers, language, indexer, allowBuild));
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
      {onImportMap && <div className="import-map-option">
        <label className={`file-button import-map-button${busy ? ' disabled' : ''}`} title="Open a map exported from Code Atlas, exactly as it was, as a new project with no source folder">
          <span>⇪ Import an exported map</span>
          <input type="file" accept=".md,.markdown,.txt" aria-label="Import an exported map" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onImportMap(file); }}/>
        </label>
        <small>No code needed: you see the map as it was exported, and can keep designing on it.</small>
      </div>}
      {recent.length > 0 && <div className="recent-projects">
        <h3>Recent projects</h3>
        {recent.map(workspace => <button
          key={workspace.id}
          type="button"
          disabled={busy}
          onClick={() => onOpenRecent?.(workspace)}
        >
          {workspace.designOnly
            ? <span>✎ {workspace.name || 'Imported design'}<small>Design only · no source folder</small></span>
            : <span>▱ {workspace.path.split('/').filter(Boolean).pop() || workspace.path}<small>{workspace.path}</small></span>}
          <span>Open ↗</span>
        </button>)}
      </div>}
    </section>
  );
}
