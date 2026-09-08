
import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';

interface SettingsScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PresetOption {
  label: string;
  baseUrl: string;
  modelId: string;
}

const PRESETS: Record<string, PresetOption> = {
  'openai-4o': {
    label: 'OpenAI (gpt-4o)',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o',
  },
  'openai-mini': {
    label: 'OpenAI (gpt-4o-mini)',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
  },
  'ollama': {
    label: 'Ollama (qwen2.5-coder)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelId: 'qwen2.5-coder',
  },
  'lmstudio': {
    label: 'LM Studio (local-model)',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelId: 'local-model',
  },
  'custom': {
    label: 'Custom Endpoint',
    baseUrl: '',
    modelId: '',
  },
};

export function SettingsScreen({ isOpen, onClose }: SettingsScreenProps) {
  const [preset, setPreset] = useState<string>('openai-4o');
  const [baseUrl, setBaseUrl] = useState<string>('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [hasConfiguredKey, setHasConfiguredKey] = useState<boolean>(false);
  const [modelId, setModelId] = useState<string>('gpt-4o');
  const [contextBudget, setContextBudget] = useState<number>(8192);
  const [outputBudget, setOutputBudget] = useState<number>(2048);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(60);
  const [temperature, setTemperature] = useState<number>(0.2);

  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    message: string;
  } | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Load active profile from backend or localStorage on mount/open
  useEffect(() => {
    if (!isOpen) return;

    setTestResult(null);
    setSaveStatus(null);

    const loadProfile = async () => {
      try {
        const profiles = await apiClient.getModelProfiles();
        if (Array.isArray(profiles) && profiles.length > 0) {
          const active = profiles[0];
          if (active.baseUrl) setBaseUrl(active.baseUrl);
          if (active.modelId) setModelId(active.modelId);
          setHasConfiguredKey(!!active.hasApiKey);
          if (active.contextBudget) setContextBudget(active.contextBudget);
          if (active.outputBudget) setOutputBudget(active.outputBudget);
          if (active.timeoutSeconds) setTimeoutSeconds(active.timeoutSeconds);
          if (active.temperature !== undefined) setTemperature(active.temperature);

          // Detect matching preset
          const matchingPreset = Object.entries(PRESETS).find(
            ([key, p]) => key !== 'custom' && p.baseUrl === active.baseUrl && p.modelId === active.modelId
          );
          setPreset(matchingPreset ? matchingPreset[0] : 'custom');
          return;
        }
      } catch (err) {
        // Fallback to localStorage
      }

      // Check localStorage if backend returned empty
      const saved = localStorage.getItem('codeatlas_model_settings');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.baseUrl) setBaseUrl(parsed.baseUrl);
          if (parsed.modelId) setModelId(parsed.modelId);
          if (parsed.contextBudget) setContextBudget(parsed.contextBudget);
          if (parsed.outputBudget) setOutputBudget(parsed.outputBudget);
          if (parsed.timeoutSeconds) setTimeoutSeconds(parsed.timeoutSeconds);
          if (parsed.temperature !== undefined) setTemperature(parsed.temperature);

          const matchingPreset = Object.entries(PRESETS).find(
            ([key, p]) => key !== 'custom' && p.baseUrl === parsed.baseUrl && p.modelId === parsed.modelId
          );
          setPreset(matchingPreset ? matchingPreset[0] : 'custom');
        } catch (e) {
          // Ignore parse errors
        }
      }
    };

    loadProfile();
  }, [isOpen]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePresetChange = (presetKey: string) => {
    setPreset(presetKey);
    const chosen = PRESETS[presetKey];
    if (chosen && presetKey !== 'custom') {
      setBaseUrl(chosen.baseUrl);
      setModelId(chosen.modelId);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const payload: any = {
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        timeoutSeconds: Number(timeoutSeconds) || 60,
        temperature: Number(temperature) || 0.2,
      };
      if (apiKey.trim()) {
        payload.apiKey = apiKey.trim();
      }
      const res = await apiClient.testModelConnection(payload);
      if (res.chatWorking || res.reachable) {
        setTestResult({
          success: true,
          latencyMs: res.latencyMs,
          message: `Connected (${res.latencyMs}ms)`,
        });
      } else {
        const errorDetail =
          res.capabilities && res.capabilities.length > 0
            ? res.capabilities.join(', ')
            : 'Failed to reach model endpoint';
        setTestResult({
          success: false,
          latencyMs: res.latencyMs,
          message: errorDetail,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Connection test failed',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const payload: any = {
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        contextBudget: Number(contextBudget) || 8192,
        outputBudget: Number(outputBudget) || 2048,
        timeoutSeconds: Number(timeoutSeconds) || 60,
        temperature: Number(temperature) || 0.2,
      };
      if (apiKey.trim()) {
        payload.apiKey = apiKey.trim();
      }
      await apiClient.saveModelProfile(payload);

      // Save non-sensitive config to localStorage
      localStorage.setItem(
        'codeatlas_model_settings',
        JSON.stringify({
          baseUrl: payload.baseUrl,
          modelId: payload.modelId,
          contextBudget: payload.contextBudget,
          outputBudget: payload.outputBudget,
          timeoutSeconds: payload.timeoutSeconds,
          temperature: payload.temperature,
        })
      );

      if (apiKey.trim()) {
        setHasConfiguredKey(true);
        setApiKey('');
      }

      setSaveStatus('Settings saved successfully!');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus(`Error saving settings: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="settings-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '560px',
          background: '#1e1e2e',
          color: '#e0e0e0',
          borderRadius: '10px',
          border: '1px solid #3d3d5c',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '14px 20px',
            background: '#252538',
            borderBottom: '1px solid #383850',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '15px', color: '#fff' }}>
            <span>⚙</span> Model & LLM Settings
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Provider Preset */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: '#bbb' }}>
              Provider Preset
            </label>
            <select
              value={preset}
              onChange={(e) => handlePresetChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: '#2a2a3e',
                border: '1px solid #484860',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
              }}
            >
              {Object.entries(PRESETS).map(([key, p]) => (
                <option key={key} value={key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: '#bbb' }}>
              Base URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setPreset('custom');
              }}
              placeholder="https://api.openai.com/v1"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                background: '#2a2a3e',
                border: '1px solid #484860',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
              }}
            />
          </div>

          {/* API Key / Token */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: '#bbb' }}>
                API Key / Bearer Token
              </label>
              {hasConfiguredKey && (
                <span style={{ fontSize: '11px', color: '#66bb6a' }}>
                  ✓ Token configured on server
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasConfiguredKey ? '•••••••••••••••• (leave blank to keep)' : 'sk-... or Bearer token'}
                style={{
                  flex: 1,
                  boxSizing: 'border-box',
                  padding: '8px 10px',
                  background: '#2a2a3e',
                  border: '1px solid #484860',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{
                  padding: '8px 12px',
                  background: '#33334d',
                  border: '1px solid #484860',
                  borderRadius: '6px',
                  color: '#ccc',
                  cursor: 'pointer',
                  fontSize: '12px',
                  whiteSpace: 'nowrap',
                }}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Model Name / ID */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: '#bbb' }}>
              Model Name / ID
            </label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setPreset('custom');
              }}
              placeholder="gpt-4o, qwen2.5-coder, etc."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                background: '#2a2a3e',
                border: '1px solid #484860',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '13px',
              }}
            />
          </div>

          {/* Budgets & Parameters Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Context Budget */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', marginBottom: '4px', color: '#aaa' }}>
                Context Budget (tokens)
              </label>
              <input
                type="number"
                value={contextBudget}
                onChange={(e) => setContextBudget(parseInt(e.target.value) || 0)}
                min={512}
                step={512}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  background: '#2a2a3e',
                  border: '1px solid #484860',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
            </div>

            {/* Output Budget */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', marginBottom: '4px', color: '#aaa' }}>
                Max Output Tokens
              </label>
              <input
                type="number"
                value={outputBudget}
                onChange={(e) => setOutputBudget(parseInt(e.target.value) || 0)}
                min={128}
                step={256}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  background: '#2a2a3e',
                  border: '1px solid #484860',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
            </div>

            {/* Timeout */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', marginBottom: '4px', color: '#aaa' }}>
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(parseInt(e.target.value) || 0)}
                min={5}
                max={600}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  background: '#2a2a3e',
                  border: '1px solid #484860',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
            </div>

            {/* Temperature */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', marginBottom: '4px', color: '#aaa' }}>
                Temperature ({temperature})
              </label>
              <input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
                min={0.0}
                max={2.0}
                step={0.05}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  background: '#2a2a3e',
                  border: '1px solid #484860',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px',
                }}
              />
            </div>
          </div>

          {/* Test Connection Section */}
          <div
            style={{
              padding: '12px',
              background: '#242436',
              borderRadius: '8px',
              border: '1px solid #383850',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                style={{
                  padding: '8px 16px',
                  background: isTesting ? '#555' : '#3949ab',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isTesting ? 'wait' : 'pointer',
                  fontWeight: '600',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isTesting ? '⏳ Testing Connection...' : '🔌 Test Connection'}
              </button>

              {testResult && (
                <div
                  style={{
                    fontSize: '12px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: testResult.success ? 'rgba(46, 125, 50, 0.25)' : 'rgba(198, 40, 40, 0.25)',
                    color: testResult.success ? '#81c784' : '#ef9a9a',
                    border: `1px solid ${testResult.success ? '#2e7d32' : '#c62828'}`,
                    maxWidth: '320px',
                    wordBreak: 'break-word',
                  }}
                >
                  <span>{testResult.success ? '✓' : '✕'}</span>
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          </div>

          {saveStatus && (
            <div
              style={{
                fontSize: '12px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: saveStatus.startsWith('Error') ? 'rgba(198, 40, 40, 0.2)' : 'rgba(46, 125, 50, 0.2)',
                color: saveStatus.startsWith('Error') ? '#ef9a9a' : '#81c784',
                border: `1px solid ${saveStatus.startsWith('Error') ? '#c62828' : '#2e7d32'}`,
              }}
            >
              {saveStatus}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            background: '#252538',
            borderTop: '1px solid #383850',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: '#33334d',
              border: '1px solid #484860',
              borderRadius: '6px',
              color: '#ddd',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '8px 20px',
              background: isSaving ? '#555' : '#1e88e5',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: isSaving ? 'wait' : 'pointer',
              fontWeight: '600',
              fontSize: '12px',
            }}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
export default SettingsScreen;

