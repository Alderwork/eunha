import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { Repo } from '../types';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

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
    <Modal onClose={onClose} width="w-[480px]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 className="text-base font-semibold text-ink">Add repo</h2>
        <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none">✕</button>
      </div>

      <form onSubmit={handleSubmit} className="px-6 py-5">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          placeholder="owner/repo or GitHub URL"
          className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-ink placeholder-muted outline-none focus:border-brand transition-colors"
        />

        <div className="text-xs text-muted mt-2 space-y-0.5">
          <div>Accepts: <code>owner/repo</code> · <code>https://github.com/owner/repo</code></div>
        </div>

        {error && (
          <div className="text-sm text-danger mt-3 bg-danger-tint border border-danger/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <Button
            variant="primary"
            type="submit"
            disabled={loading || !input.trim()}
            className="text-sm px-4 py-1.5"
          >
            {loading ? 'Adding…' : 'Add repo'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
