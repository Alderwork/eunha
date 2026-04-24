import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { Repo } from '../types';

interface Props {
  onClose: () => void;
  onAdded: (repo: Repo) => void;
}

export function AddRepoModal({ onClose, onAdded }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    // Pre-fill from clipboard if it's a GitHub URL
    readText()
      .then((text) => {
        if (text && (text.includes('github.com') || /^[\w-]+\/[\w.-]+$/.test(text.trim()))) {
          setInput(text.trim());
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const repo = await invoke<Repo>('add_repo', { input: input.trim() });
      onAdded(repo);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg w-[480px] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--text)]">Add repo</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(null); }}
            placeholder="owner/repo or GitHub URL"
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--amber)] transition-colors"
          />

          <div className="text-xs text-[var(--muted)] mt-2 space-y-0.5">
            <div>Accepts: <code>owner/repo</code> · <code>https://github.com/owner/repo</code></div>
          </div>

          {error && (
            <div className="text-sm text-red-400 mt-3 bg-red-950/30 border border-red-900 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-1.5 text-sm bg-[var(--amber)] text-[#0C0C0E] rounded font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Adding…' : 'Add repo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
