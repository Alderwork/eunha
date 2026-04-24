import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Provider } from '../types';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [pat, setPat] = useState('');
  const [provider, setProvider] = useState<Provider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [patMasked, setPatMasked] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    invoke<{
      pat_set: boolean;
      pat_masked: string;
      provider: string;
      api_key_set: boolean;
      api_key_masked: string;
      ollama_url: string;
    }>('get_settings').then((s) => {
      setPatMasked(s.pat_masked);
      setApiKeyMasked(s.api_key_masked);
      setProvider(s.provider as Provider);
      setOllamaUrl(s.ollama_url);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await invoke('save_settings', {
        githubPat: pat || undefined,
        llmProvider: provider,
        llmApiKey: apiKey || undefined,
        ollamaUrl: provider === 'ollama' ? ollamaUrl : undefined,
      });
      setSuccess(true);
      setTimeout(onClose, 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg w-[480px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--text)]">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* GitHub PAT */}
          <div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide mb-3">GitHub</div>
            <label className="text-sm text-[var(--text)] block mb-1.5">Personal Access Token</label>
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder={patMasked || 'ghp_…'}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--amber)]"
            />
            <p className="text-xs text-[var(--muted)] mt-1">
              Scopes needed: <code>repo</code> (read), <code>read:user</code>
            </p>
          </div>

          {/* AI Provider */}
          <div>
            <div className="text-xs text-[var(--muted)] uppercase tracking-wide mb-3">AI Provider</div>

            <div className="flex gap-2 mb-3">
              {(['openai', 'anthropic', 'ollama'] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${
                    provider === p
                      ? 'border-[var(--amber)] text-[var(--amber)] bg-[#2a1a08]'
                      : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {provider !== 'ollama' && (
              <div>
                <label className="text-sm text-[var(--text)] block mb-1.5">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyMasked || (provider === 'openai' ? 'sk-…' : 'sk-ant-…')}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--amber)]"
                />
              </div>
            )}

            {provider === 'ollama' && (
              <div>
                <label className="text-sm text-[var(--text)] block mb-1.5">Base URL</label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--amber)]"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-green-400 bg-green-950/30 border border-green-900 rounded px-3 py-2">
              Saved!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-[var(--amber)] text-[#0C0C0E] rounded font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
