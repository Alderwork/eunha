import { useEffect, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SettingsData {
  pat_set: boolean;
  pat_masked: string;
}

interface AiConnection {
  id: string;
  provider: string;
  status: string;
  key_set: boolean;
  defaultModel: string | null;
  meta: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

interface AiConnectionsData {
  active: string | null;
  connections: AiConnection[];
}

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', needsKey: true },
  { id: 'anthropic', label: 'Anthropic', model: 'claude-haiku-4-5-20251001', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter', model: '', needsKey: true },
  { id: 'opencode-go', label: 'OpenCode Go', model: 'deepseek-v4-flash', needsKey: true },
  { id: 'ollama', label: 'Ollama', model: 'llama3', needsKey: false },
] as const;

function providerLabel(id: string) {
  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

export function SettingsWorkspace() {
  const [pat, setPat] = useState('');
  const [savedPat, setSavedPat] = useState('');
  const [connections, setConnections] = useState<AiConnectionsData>({
    active: null,
    connections: [],
  });
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]['id']>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<string>(PROVIDERS[0].model);
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'github' | 'ai' | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const selectedProvider = PROVIDERS.find((item) => item.id === provider)!;
  const existingConnection = connections.connections.find((item) => item.id === provider);
  const needsNewKey = selectedProvider.needsKey && !apiKey.trim() && !existingConnection?.key_set;

  async function loadConnections() {
    setConnections(await invoke<AiConnectionsData>('conduit_list'));
  }

  useEffect(() => {
    void Promise.all([
      invoke<SettingsData>('get_settings'),
      invoke<AiConnectionsData>('conduit_list'),
    ])
      .then(([settings, nextConnections]) => {
        setSavedPat(settings.pat_masked);
        setConnections(nextConnections);
        const active = nextConnections.connections.find((item) => item.id === nextConnections.active);
        if (active && PROVIDERS.some((item) => item.id === active.provider)) {
          setProvider(active.provider as typeof provider);
          setModel(active.defaultModel ?? '');
          setBaseUrl(active.meta?.base_url ?? 'http://localhost:11434');
        }
      })
      .catch((reason) => setMessage({ text: String(reason), error: true }))
      .finally(() => setLoading(false));
  }, []);

  function selectProvider(next: (typeof PROVIDERS)[number]['id']) {
    const match = PROVIDERS.find((item) => item.id === next)!;
    const existing = connections.connections.find((item) => item.id === next);
    setProvider(next);
    setModel(existing?.defaultModel ?? match.model);
    setBaseUrl(existing?.meta?.base_url ?? 'http://localhost:11434');
    setApiKey('');
  }

  async function savePat(event: FormEvent) {
    event.preventDefault();
    if (!pat.trim()) return;
    setSaving('github');
    setMessage(null);
    try {
      const settings = await invoke<SettingsData>('save_settings', {
        githubPat: pat.trim(),
        clearGithubPat: false,
      });
      setSavedPat(settings.pat_masked);
      setPat('');
      setMessage({ text: 'GitHub token saved.', error: false });
    } catch (reason) {
      setMessage({ text: String(reason), error: true });
    } finally {
      setSaving(null);
    }
  }

  async function clearPat() {
    if (!savedPat || !window.confirm('Remove the saved GitHub token?')) return;
    setSaving('github');
    setMessage(null);
    try {
      const settings = await invoke<SettingsData>('save_settings', {
        githubPat: null,
        clearGithubPat: true,
      });
      setPat('');
      setSavedPat(settings.pat_masked);
      setMessage({ text: 'GitHub token removed.', error: false });
    } catch (reason) {
      setMessage({ text: String(reason), error: true });
    } finally {
      setSaving(null);
    }
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault();
    if (needsNewKey) return;
    if (!model.trim()) return;
    setSaving('ai');
    setMessage(null);
    try {
      await invoke('conduit_save', {
        input: {
          provider,
          credentials: apiKey.trim() || null,
          defaultModel: model.trim(),
          meta: provider === 'ollama' ? { base_url: baseUrl.trim() } : null,
        },
      });
      await invoke('conduit_set_active', { id: provider });
      await loadConnections();
      setApiKey('');
      setMessage({ text: providerLabel(provider) + ' settings saved.', error: false });
    } catch (reason) {
      setMessage({ text: String(reason), error: true });
    } finally {
      setSaving(null);
    }
  }

  async function activate(id: string) {
    setMessage(null);
    try {
      await invoke('conduit_set_active', { id });
      await loadConnections();
    } catch (reason) {
      setMessage({ text: String(reason), error: true });
    }
  }

  async function remove(connection: AiConnection) {
    if (!window.confirm('Remove the ' + providerLabel(connection.provider) + ' connection?')) return;
    setMessage(null);
    try {
      await invoke('conduit_delete', { id: connection.id });
      await loadConnections();
    } catch (reason) {
      setMessage({ text: String(reason), error: true });
    }
  }

  return <main className="workroom-settings">
    <header>
      <span className="workroom-index">SETTINGS</span>
      <h1>Connections</h1>
      <p>Credentials stay outside the webview after saving. eunha uses them only to read repository context or contact the provider you select.</p>
    </header>
    {message && <div className={message.error ? 'workroom-inline-error' : 'workroom-inline-success'} role={message.error ? 'alert' : 'status'}>{message.text}</div>}
    <div className="workroom-settings-grid">
      <section>
        <header>
          <span className="workroom-settings-number">01</span>
          <div><h2>GitHub access</h2><p>Optional for public repositories, useful for higher API limits.</p></div>
        </header>
        <form onSubmit={savePat}>
          <label className="workroom-settings-field" htmlFor="github-pat">
            <span>Personal access token</span>
            <input id="github-pat" type="password" autoComplete="new-password" spellCheck={false} value={pat} onChange={(event) => setPat(event.target.value)} placeholder={loading ? 'Reading saved token…' : savedPat || 'github_pat_…'} />
          </label>
          <p className="workroom-settings-note">{savedPat ? 'Saved: ' + savedPat + '. Leave the field empty to keep it.' : 'The token is never returned to React after it is stored.'}</p>
          <div className="workroom-settings-actions"><button className="workroom-primary" disabled={loading || saving !== null || !pat.trim()}>{saving === 'github' ? 'Saving…' : 'Save token'}</button>{savedPat && <button className="workroom-secondary" type="button" onClick={() => void clearPat()} disabled={loading || saving !== null}>Remove saved token</button>}</div>
        </form>
      </section>
      <section>
        <header>
          <span className="workroom-settings-number">02</span>
          <div><h2>AI provider</h2><p>Used only for user-triggered contribution analysis.</p></div>
        </header>
        <div className="workroom-ai-settings">
          {connections.connections.length === 0 ? <div className="workroom-settings-empty"><strong>No AI provider connected.</strong><p>Connect one to build evidence-backed contribution briefs.</p></div> : <div className="workroom-connection-list">{connections.connections.map((connection) => <div key={connection.id} className={connection.id === connections.active ? 'active' : ''}>
            <div><strong>{providerLabel(connection.provider)}</strong><span>{connection.defaultModel ?? 'No model'} · {connection.key_set ? 'key saved' : 'local'}{connection.id === connections.active && <> · <b className="workroom-connection-active">ACTIVE</b></>}</span></div>
            <div>{connection.id !== connections.active && <button type="button" onClick={() => void activate(connection.id)}>Use</button>}<button type="button" onClick={() => void remove(connection)}>Remove</button></div>
          </div>)}</div>}
          <form className="workroom-ai-form" onSubmit={saveConnection}>
            <label className="workroom-settings-field">
              <span>Provider</span>
              <select value={provider} onChange={(event) => selectProvider(event.target.value as typeof provider)}>
                {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            {selectedProvider.needsKey && <label className="workroom-settings-field">
              <span>API key</span>
              <input type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={existingConnection?.key_set ? 'Key saved — leave empty to keep it' : 'Stored in the Rust-owned connection file'} />
            </label>}
            <label className="workroom-settings-field">
              <span>Default model</span>
              <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Model identifier" />
            </label>
            {provider === 'ollama' && <label className="workroom-settings-field">
              <span>Base URL</span>
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434" />
            </label>}
            <button className="workroom-secondary" disabled={loading || saving !== null || !model.trim() || needsNewKey}>{saving === 'ai' ? 'Saving…' : existingConnection ? 'Update provider' : 'Connect provider'}</button>
          </form>
        </div>
      </section>
    </div>
    <aside className="workroom-settings-safety"><strong>Mutation boundary</strong><span>AI connections can summarize evidence. They cannot clone, branch, commit, push, or open a pull request.</span></aside>
  </main>;
}
