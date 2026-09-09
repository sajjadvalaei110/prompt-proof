import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api/client';

const DEFAULT_USER_AGENT = 'claude-cli/2.1.119 (external, cli)';

export default function SettingsScreen({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  const [profile, setProfile] = useState({
    baseUrl: '',
    modelId: '',
    apiKey: '',
    contextBudget: 16384,
    outputBudget: 2048,
    timeoutSeconds: 120,
    temperature: 0.2,
    userAgent: DEFAULT_USER_AGENT,
  });

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    dialog.current?.showModal();
    setMessage('');

    apiClient
      .getModelProfiles()
      .then((p) => {
        if (p[0]) {
          setProfile((v) => ({
            ...v,
            ...p[0],
            apiKey: '',
            userAgent: p[0].userAgent?.trim() || DEFAULT_USER_AGENT,
          }));

          setHasKey(!!p[0].hasApiKey);
        }
      })
      .catch((e) => setMessage(e.message));
  }, [isOpen]);

  if (!isOpen) return null;

  async function action(test: boolean) {
    setBusy(true);
    setMessage('');

    try {
      const effectiveProfile = {
        ...profile,
        userAgent: profile.userAgent.trim() || DEFAULT_USER_AGENT,
      };

      if (test) {
        const result =
          await apiClient.testModelConnection(effectiveProfile);

        setMessage(
          result.message ||
            ((result.success || result.chatWorking)
              ? 'Connection verified'
              : 'Connection test failed')
        );
      } else {
        await apiClient.saveModelProfile(effectiveProfile);

        setProfile((p) => ({
          ...p,
          userAgent: effectiveProfile.userAgent,
          apiKey: '',
        }));

        setMessage('Model settings saved for this server session.');
      }
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <div>
          <h2>Model settings</h2>
          <p>Choose where explanation requests are sent.</p>
        </div>

        <button onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </header>

      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          action(false);
        }}
      >
        <label>
          Endpoint URL
          <input
            value={profile.baseUrl}
            placeholder="http://127.0.0.1:1234/v1"
            onChange={(e) =>
              setProfile({
                ...profile,
                baseUrl: e.target.value,
              })
            }
          />
        </label>

        <label>
          Model ID
          <input
            value={profile.modelId}
            placeholder="Model served by your endpoint"
            onChange={(e) =>
              setProfile({
                ...profile,
                modelId: e.target.value,
              })
            }
          />
        </label>

        <label>
          API key {hasKey ? '(configured; leave blank to keep)' : '(optional)'}
          <input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            value={profile.apiKey}
            onChange={(e) =>
              setProfile({
                ...profile,
                apiKey: e.target.value,
              })
            }
          />
        </label>

        <button
          type="button"
          className="text-button"
          onClick={() => setShowKey(!showKey)}
        >
          {showKey ? 'Hide' : 'Show'} key
        </button>

        <label>
          User-Agent header (optional)
          <input
            value={profile.userAgent}
            placeholder={DEFAULT_USER_AGENT}
            onChange={(e) =>
              setProfile({
                ...profile,
                userAgent: e.target.value,
              })
            }
          />
        </label>

        <div className="settings-grid">
          {(
            [
              {
                key: 'contextBudget',
                label: 'Context tokens',
                min: 4096,
                step: 1024,
              },
              {
                key: 'outputBudget',
                label: 'Output tokens',
                min: 256,
                step: 256,
              },
              {
                key: 'timeoutSeconds',
                label: 'Timeout (seconds)',
                min: 5,
                max: 600,
                step: 1,
              },
              {
                key: 'temperature',
                label: 'Temperature',
                min: 0,
                max: 2,
                step: 0.1,
              },
            ] as const
          ).map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                min={f.min}
                max={'max' in f ? f.max : undefined}
                step={f.step}
                value={profile[f.key]}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    [f.key]: Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>

        <p className="muted">
          Source and saved project documents are sent only to this endpoint. A
          context window includes input and output; set both limits to values your model supports.
          Explain all automatically summarizes large projects and splits class drafts
          into resumable batches. Larger output limits leave less room for input.
          Individual explanations report omitted evidence. Keys are kept on the server, never in browser
          storage.
        </p>

        <p role="status" className="form-message">
          {message}
        </p>

        <div className="settings-actions">
          <button
            type="button"
            disabled={busy || !profile.baseUrl}
            onClick={() => action(true)}
          >
            {busy ? 'Working…' : 'Test connection'}
          </button>

          <button
            className="primary"
            disabled={busy || !profile.baseUrl || !profile.modelId}
          >
            Save settings
          </button>
        </div>
      </form>
    </dialog>
  );
}

