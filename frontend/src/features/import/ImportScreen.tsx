
import type { FormEvent } from 'react';
import type { WorkspaceLanguage } from '../../api/client';

export interface ImportScreenProps {
  path: string;
  language: WorkspaceLanguage;
  busy: boolean;
  graphOpen: boolean;
  onPathChange: (path: string) => void;
  onLanguageChange: (language: WorkspaceLanguage) => void;
  onSubmit: () => void;
  recent?: Array<{ id: string; path: string; language: WorkspaceLanguage; activeSnapshotId?: string | null }>;
  onOpenRecent?: (workspace: NonNullable<ImportScreenProps['recent']>[number]) => void;
}

/**
 * The import entry point shared by the welcome and open-project states. The option list is
 * intentionally capability based: Java is the only adapter shipped in Phase 1, so the UI cannot
 * promise a language that the backend would reject.
 */
export function ImportScreen({
  path,
  language,
  busy,
  graphOpen,
  onPathChange,
  onLanguageChange,
  onSubmit,
  recent = [],
  onOpenRecent,
}: ImportScreenProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
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
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Analyzing…' : 'Analyze project'}
        </button>
      </form>
      <p className="muted">Source-only analysis. Your repository is read-only; no Gradle builds or application code are executed.</p>
      {recent.length > 0 && <div className="recent-projects">
        <h3>Recent projects</h3>
        {recent.map(workspace => <button
          key={workspace.id}
          type="button"
          disabled={busy}
          onClick={() => onOpenRecent?.(workspace)}
        >
          <span>▱ {workspace.path.split('/').filter(Boolean).pop() || workspace.path}<small>{workspace.path}</small></span>
          <span>Open ↗</span>
        </button>)}
      </div>}
    </section>
  );
}
