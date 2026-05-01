import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Provider } from '../types';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

interface ImportDbResult {
  repos_added: number;
  repos_skipped: number;
  releases_added: number;
  error: string | null;
}

const LANGUAGES = [
  'Afrikaans', 'Albanian', 'Amharic', 'Arabic', 'Armenian', 'Azerbaijani',
  'Basque', 'Belarusian', 'Bengali', 'Bosnian', 'Bulgarian',
  'Catalan', 'Chinese (Simplified)', 'Chinese (Traditional)', 'Croatian', 'Czech',
  'Danish', 'Dutch',
  'English', 'Estonian',
  'Finnish', 'French',
  'Galician', 'Georgian', 'German', 'Greek', 'Gujarati',
  'Hebrew', 'Hindi', 'Hungarian',
  'Icelandic', 'Indonesian', 'Italian',
  'Japanese',
  'Kannada', 'Kazakh', 'Khmer', 'Korean',
  'Lao', 'Latvian', 'Lithuanian',
  'Macedonian', 'Malay', 'Malayalam', 'Maltese', 'Marathi', 'Mongolian',
  'Nepali', 'Norwegian',
  'Persian', 'Polish', 'Portuguese',
  'Punjabi',
  'Romanian', 'Russian',
  'Serbian', 'Sinhala', 'Slovak', 'Slovenian', 'Somali', 'Spanish', 'Swahili', 'Swedish',
  'Tamil', 'Telugu', 'Thai', 'Turkish',
  'Ukrainian', 'Urdu', 'Uzbek',
  'Vietnamese',
  'Welsh',
  'Yoruba',
  'Zulu',
];

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [pat, setPat] = useState('');
  const [provider, setProvider] = useState<Provider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3');
  const [outputLanguage, setOutputLanguage] = useState('English');
  const [defaultReleasePlatform, setDefaultReleasePlatform] = useState<string>('');
  const [patMasked, setPatMasked] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [backupToast, setBackupToast] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<{
      pat_set: boolean;
      pat_masked: string;
      provider: string;
      api_key_set: boolean;
      api_key_masked: string;
      ollama_url: string;
      ollama_model: string;
      output_language: string;
      default_release_platform?: string;
    }>('get_settings')
      .then((s) => {
        setPatMasked(s.pat_masked);
        setApiKeyMasked(s.api_key_masked);
        setProvider(s.provider as Provider);
        setOllamaUrl(s.ollama_url);
        setOllamaModel(s.ollama_model);
        setOutputLanguage(s.output_language);
        setDefaultReleasePlatform(s.default_release_platform ?? '');
      })
      .catch((e) => setError(`Failed to load settings: ${e}`))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await invoke<{ keychain_error: string | null }>('save_settings', {
        githubPat: pat || undefined,
        llmProvider: provider,
        llmApiKey: apiKey || undefined,
        ollamaUrl: provider === 'ollama' ? ollamaUrl : undefined,
        ollamaModel: provider === 'ollama' ? ollamaModel : undefined,
        outputLanguage: outputLanguage,
        defaultReleasePlatform: defaultReleasePlatform || null,
      });
      if (result.keychain_error) {
        setError(result.keychain_error);
      } else {
        setSuccess(true);
        setTimeout(onClose, 800);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExportLoading(true);
    setBackupToast(null);
    setBackupError(null);
    try {
      const data = await invoke<object>('export_database');
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eunha-backup-${today}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupToast('Library exported successfully.');
    } catch (e) {
      setBackupError(`Export failed: ${e}`);
    } finally {
      setExportLoading(false);
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    setBackupToast(null);
    setBackupError(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed: unknown = JSON.parse(ev.target?.result as string);
        const result = await invoke<ImportDbResult>('import_database', { data: parsed });
        if (result.error) {
          setBackupError(`Import error: ${result.error}`);
        } else {
          setBackupToast(`Imported: ${result.repos_added} repos added, ${result.repos_skipped} skipped`);
        }
      } catch (e) {
        setBackupError(`Import failed: ${e}`);
      } finally {
        setImportLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  }

  const inputCls = 'w-full bg-input border border-border rounded px-3 py-2 text-sm text-ink placeholder-muted outline-none focus:border-brand transition-colors';

  return (
    <Modal onClose={onClose} width="w-[480px]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 className="text-base font-semibold text-ink">Settings</h2>
        <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none">✕</button>
      </div>

      <div className="px-6 py-5 space-y-6">
        {loading && (
          <div className="text-sm text-muted py-4 text-center">Loading…</div>
        )}
        {!loading && <>
        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-3">GitHub</div>
          <label className="text-sm text-ink block mb-1.5">Personal Access Token</label>
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder={patMasked || 'ghp_…'}
            className={inputCls}
          />
          {patMasked ? (
            <p className="text-xs text-success mt-1">
              Saved: {patMasked} — leave blank to keep current
            </p>
          ) : (
            <p className="text-xs text-muted mt-1">
              Scopes needed: <code>repo</code> (read), <code>read:user</code>
            </p>
          )}
        </div>

        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-3">AI Provider</div>

          <div className="flex gap-2 mb-3">
            {(['openai', 'anthropic', 'ollama'] as Provider[]).map((p) => (
              <button
                key={p}
                onClick={() => setProvider(p)}
                className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${
                  provider === p
                    ? 'border-brand text-accent bg-brand-tint'
                    : 'border-border text-muted hover:border-dim'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {provider !== 'ollama' && (
            <div>
              <label className="text-sm text-ink block mb-1.5">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={apiKeyMasked || (provider === 'openai' ? 'sk-…' : 'sk-ant-…')}
                className={inputCls}
              />
              {apiKeyMasked && (
                <p className="text-xs text-success mt-1">
                  Saved: {apiKeyMasked} — leave blank to keep current
                </p>
              )}
            </div>
          )}

          {provider === 'ollama' && (
            <div className="space-y-3">
              <div>
                <label className="text-sm text-ink block mb-1.5">Base URL</label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-sm text-ink block mb-1.5">Model</label>
                <input
                  type="text"
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  placeholder="llama3"
                  className={inputCls}
                />
                <p className="text-xs text-muted mt-1">
                  Must be pulled locally, e.g. <code>ollama pull llama3.2</code>
                </p>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-3">Description Language</div>
          <label className="text-sm text-ink block mb-1.5">LLM output language</label>
          <select
            value={outputLanguage}
            onChange={(e) => setOutputLanguage(e.target.value)}
            className={inputCls}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <p className="text-xs text-muted mt-1">
            Applies to <em>what</em>, <em>why</em>, and <em>use case</em> fields. Category and tags stay in English.
          </p>
          <p className="text-xs text-muted mt-1">
            Changing language affects only new descriptions. Use Shift-A to re-describe existing repos.
          </p>
        </div>

        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-2 mt-4">Release Platform Default</div>
          <label className="text-sm text-ink block mb-1.5">Default release platform</label>
          <select
            value={defaultReleasePlatform}
            onChange={(e) => setDefaultReleasePlatform(e.target.value)}
            className={inputCls}
          >
            <option value="">All</option>
            <option value="macos">macOS</option>
            <option value="windows">Windows</option>
            <option value="linux">Linux</option>
          </select>
          <p className="text-xs text-muted mt-1">
            Filters release assets by platform in the Watching view.
          </p>
        </div>

        {error && (
          <div className="text-sm text-danger bg-danger-tint border border-danger/30 rounded px-3 py-2">
            {error}
          </div>
        )}
        {success && (
          <div className="text-sm text-success bg-success-tint border border-success/30 rounded px-3 py-2">
            Saved!
          </div>
        )}

        <div className="border-t border-border my-4" />

        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-2 mt-4">Backup &amp; Restore</div>

          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <Button
                variant="ghost"
                onClick={handleExport}
                disabled={exportLoading}
                className="text-sm shrink-0"
              >
                {exportLoading ? 'Exporting…' : 'Export library'}
              </Button>
              <p className="text-xs text-muted pt-1.5">
                Saves all repos, categories, and releases to a JSON file.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Button
                variant="ghost"
                onClick={handleImportClick}
                disabled={importLoading}
                className="text-sm shrink-0"
              >
                {importLoading ? 'Importing…' : 'Import library'}
              </Button>
              <p className="text-xs text-muted pt-1.5">
                Merges a JSON backup into your current library.
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelected}
          />

          {backupToast && (
            <div className="text-sm text-success bg-success-tint border border-success/30 rounded px-3 py-2 mt-3">
              {backupToast}
            </div>
          )}
          {backupError && (
            <div className="text-sm text-danger bg-danger-tint border border-danger/30 rounded px-3 py-2 mt-3">
              {backupError}
            </div>
          )}
        </div>
        </>}
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
        <button
          onClick={onClose}
          className="px-4 py-1.5 text-sm text-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving || loading}
          className="text-sm px-4 py-1.5"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
