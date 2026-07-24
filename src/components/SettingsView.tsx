import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ConduitProvider,
  ConnectDialog,
  ConnectionCard,
  ModelSelector,
  useConnections,
} from '@conduit/react';
import { conduit } from '../lib/conduit';
import { Button } from './ui/Button';
import { Kbd } from './ui/Kbd';

interface ImportDbResult {
  repos_added: number;
  repos_skipped: number;
  releases_added: number;
  error: string | null;
}

interface SyncStarsResult {
  added: number;
  removed: number;
  removed_names: string[];
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

type Section = 'app' | 'account' | 'ai' | 'releases' | 'backup';

const SECTIONS: { id: Section; label: string; description: string }[] = [
  { id: 'app', label: 'App', description: 'Menu bar, display' },
  { id: 'account', label: 'Account', description: 'GitHub access' },
  { id: 'ai', label: 'AI', description: 'Provider, key, language' },
  { id: 'releases', label: 'Releases', description: 'Watching defaults' },
  { id: 'backup', label: 'Backup', description: 'Export and import' },
];

interface Props {
  onBack: () => void;
}

export function SettingsView({ onBack }: Props) {
  const [section, setSection] = useState<Section>('app');

  const [pat, setPat] = useState('');
  const [outputLanguage, setOutputLanguage] = useState('English');
  const [defaultReleasePlatform, setDefaultReleasePlatform] = useState<string>('');
  const [showTrayIcon, setShowTrayIcon] = useState(true);
  const [starSyncInterval, setStarSyncInterval] = useState('360');
  const [lastStarSyncAt, setLastStarSyncAt] = useState<string | null>(null);
  const [syncingStars, setSyncingStars] = useState(false);
  const [starSyncMsg, setStarSyncMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [patMasked, setPatMasked] = useState('');
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
      output_language: string;
      default_release_platform?: string;
      show_tray_icon: boolean;
      star_sync_interval_minutes?: string;
      last_star_sync_at?: string | null;
    }>('get_settings')
      .then((s) => {
        setPatMasked(s.pat_masked);
        setOutputLanguage(s.output_language);
        setDefaultReleasePlatform(s.default_release_platform ?? '');
        setShowTrayIcon(s.show_tray_icon);
        setStarSyncInterval(s.star_sync_interval_minutes ?? '360');
        setLastStarSyncAt(s.last_star_sync_at ?? null);
      })
      .catch((e) => setError(`Failed to load settings: ${e}`))
      .finally(() => setLoading(false));
  }, []);

  async function handleSyncNow() {
    if (syncingStars) return;
    setSyncingStars(true);
    setStarSyncMsg(null);
    try {
      const r = await invoke<SyncStarsResult>('sync_stars');
      setLastStarSyncAt(new Date().toISOString());
      setStarSyncMsg({
        text:
          r.added === 0 && r.removed === 0
            ? 'Up to date — no changes.'
            : `Done: ${r.added} added, ${r.removed} removed`,
        error: false,
      });
    } catch (e) {
      setStarSyncMsg({ text: String(e), error: true });
    } finally {
      setSyncingStars(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await invoke<{ keychain_error: string | null }>('save_settings', {
        githubPat: pat || undefined,
        outputLanguage: outputLanguage,
        starSyncIntervalMinutes: starSyncInterval,
      });
      if (result.keychain_error) {
        setError(result.keychain_error);
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2000);
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 h-12 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-muted hover:text-ink text-sm flex items-center gap-1.5"
            title="Back (Esc)"
          >
            ← Back
          </button>
          <span className="text-faint">·</span>
          <h1 className="text-sm font-semibold text-ink">Settings</h1>
        </div>
        <span className="text-xs text-faint flex items-center gap-1">
          press <Kbd>Esc</Kbd> to leave
        </span>
      </div>

      {/* Body — left section nav, right content */}
      <div className="flex flex-1 overflow-hidden">
        <nav className="flex-shrink-0 w-52 border-r border-border bg-panel py-3 overflow-y-auto">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`w-full text-left px-4 py-2 mx-1 rounded transition-colors ${
                section === s.id
                  ? 'bg-elevated text-ink'
                  : 'text-muted hover:text-dim hover:bg-elevated/50'
              }`}
              style={{ width: 'calc(100% - 0.5rem)' }}
            >
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-xs text-faint mt-0.5">{s.description}</div>
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">
            {loading ? (
              <div className="text-sm text-muted py-12 text-center">Loading…</div>
            ) : (
              <>
                {section === 'app' && (
                  <SectionShell
                    title="App"
                    description="Appearance and system integration."
                  >
                    <div className="flex items-center justify-between py-0.5">
                      <div>
                        <div className="text-sm text-ink">Show menu bar icon</div>
                        <div className="text-xs text-muted mt-0.5">
                          Display the crescent orb in the macOS menu bar.
                        </div>
                      </div>
                      <button
                        role="switch"
                        aria-checked={showTrayIcon}
                        onClick={async () => {
                          const next = !showTrayIcon;
                          setShowTrayIcon(next);
                          await invoke('set_tray_visible', { visible: next }).catch(() =>
                            setShowTrayIcon(!next)
                          );
                        }}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                          showTrayIcon ? 'bg-brand' : 'bg-elevated'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            showTrayIcon ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </SectionShell>
                )}

                {section === 'account' && (
                  <SectionShell
                    title="Account"
                    description="Connect your GitHub account so eunha can fetch starred repos and metadata."
                  >
                    <Field label="Personal Access Token">
                      <input
                        type="password"
                        value={pat}
                        onChange={(e) => setPat(e.target.value)}
                        placeholder={patMasked || 'ghp_…'}
                        className={inputCls}
                      />
                      {patMasked ? (
                        <p className="text-xs text-success mt-1.5">
                          Saved: {patMasked} — leave blank to keep current
                        </p>
                      ) : (
                        <p className="text-xs text-muted mt-1.5">
                          Scopes needed: <code>repo</code> (read), <code>read:user</code>
                        </p>
                      )}
                    </Field>

                    <Field label="Star sync">
                      <select
                        value={starSyncInterval}
                        onChange={(e) => setStarSyncInterval(e.target.value)}
                        className={inputCls}
                      >
                        <option value="0">Off</option>
                        <option value="60">Every hour</option>
                        <option value="360">Every 6 hours</option>
                        <option value="1440">Every 24 hours</option>
                      </select>
                      <p className="text-xs text-muted mt-1.5">
                        Periodically mirrors your GitHub star list — new stars are added,
                        unstarred repos are removed (manual repos are kept).
                        {lastStarSyncAt && (
                          <> Last synced {new Date(lastStarSyncAt).toLocaleString()}.</>
                        )}
                      </p>
                    </Field>

                    <div>
                      <div className="flex items-start gap-3">
                        <Button
                          variant="ghost"
                          onClick={handleSyncNow}
                          disabled={syncingStars}
                          className="text-sm shrink-0"
                        >
                          {syncingStars ? 'Syncing…' : 'Sync now'}
                        </Button>
                        <p className="text-xs text-muted pt-1.5">
                          Runs a one-off sync against your GitHub star list.
                        </p>
                      </div>
                      {starSyncMsg && (
                        <div
                          className={`text-sm rounded px-3 py-2 mt-3 border ${
                            starSyncMsg.error
                              ? 'text-danger bg-danger-tint border-danger/30'
                              : 'text-success bg-success-tint border-success/30'
                          }`}
                        >
                          {starSyncMsg.text}
                        </div>
                      )}
                    </div>
                  </SectionShell>
                )}

                {section === 'ai' && (
                  <SectionShell
                    title="AI"
                    description="Connect an AI provider and choose the model used for descriptions."
                  >
                    <ConduitProvider conduit={conduit}>
                      <AiConnections />
                    </ConduitProvider>

                    <Field label="Description language">
                      <select
                        value={outputLanguage}
                        onChange={(e) => setOutputLanguage(e.target.value)}
                        className={inputCls}
                      >
                        {LANGUAGES.map((lang) => (
                          <option key={lang} value={lang}>{lang}</option>
                        ))}
                      </select>
                      <p className="text-xs text-muted mt-1.5">
                        Applies to <em>what</em>, <em>why</em>, and <em>use case</em> fields.
                        Category and tags stay in English. Re-describe existing repos with <Kbd>shift</Kbd> + <Kbd>A</Kbd>.
                      </p>
                    </Field>
                  </SectionShell>
                )}

                {section === 'releases' && (
                  <SectionShell
                    title="Releases"
                    description="Defaults applied to the Watching view."
                  >
                    <Field label="Default release platform">
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
                      <p className="text-xs text-muted mt-1.5">
                        Filters release assets by platform in the Watching view.
                      </p>
                    </Field>
                  </SectionShell>
                )}

                {section === 'backup' && (
                  <SectionShell
                    title="Backup"
                    description="Export your library to a JSON file or merge a backup back in."
                  >
                    <div className="flex flex-col gap-4">
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
                      <div className="text-sm text-success bg-success-tint border border-success/30 rounded px-3 py-2 mt-4">
                        {backupToast}
                      </div>
                    )}
                    {backupError && (
                      <div className="text-sm text-danger bg-danger-tint border border-danger/30 rounded px-3 py-2 mt-4">
                        {backupError}
                      </div>
                    )}
                  </SectionShell>
                )}

                {(error || success) && (
                  <div className="mt-4">
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
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sticky footer — Save applies across all sections, like the modal it replaces. */}
      {section !== 'backup' && (
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-3 border-t border-border bg-panel">
          <button
            onClick={onBack}
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
      )}
    </div>
  );
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="text-sm text-muted mt-1 mb-6">{description}</p>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

/** Connection management for the AI section, backed by Conduit. */
function AiConnections() {
  const { connections, activeId } = useConnections();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      <Field label="Connections">
        {connections === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted">
            No provider connected yet. Connect one to enable AI descriptions.
          </p>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => (
              <ConnectionCard key={c.id} connection={c} active={c.id === activeId} />
            ))}
          </div>
        )}
        <div className="mt-3">
          <Button variant="ghost" onClick={() => setDialogOpen(true)} className="text-sm">
            Connect provider
          </Button>
        </div>
      </Field>

      {activeId && (
        <Field label="Default model">
          <ModelSelector connectionId={activeId} />
        </Field>
      )}

      <ConnectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-ink block mb-1.5">{label}</label>
      {children}
    </div>
  );
}
