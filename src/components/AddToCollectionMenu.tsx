import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Collection, Repo } from '../types';

interface Props {
  repo: Repo;
  collections: Collection[];
  onDone: () => void;
  onClose: () => void;
}

export function AddToCollectionMenu({ repo, collections, onDone, onClose }: Props) {
  const [repoCollectionIds, setRepoCollectionIds] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<Collection[]>('get_repo_collections', { repoId: repo.id })
      .then((cols) => setRepoCollectionIds(new Set(cols.map((c) => c.id))))
      .catch(console.error);
  }, [repo.id]);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  async function toggleCollection(cid: number) {
    try {
      if (repoCollectionIds.has(cid)) {
        await invoke('remove_repo_from_collection', { collectionId: cid, repoId: repo.id });
        setRepoCollectionIds((prev) => { const n = new Set(prev); n.delete(cid); return n; });
      } else {
        await invoke('add_repo_to_collection', { collectionId: cid, repoId: repo.id });
        setRepoCollectionIds((prev) => { const n = new Set(prev); n.add(cid); return n; });
      }
      onDone();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const id = await invoke<number>('create_collection', { name });
      setNewName('');
      setAdding(false);
      await invoke('add_repo_to_collection', { collectionId: id, repoId: repo.id });
      setRepoCollectionIds((prev) => { const n = new Set(prev); n.add(id); return n; });
      onDone();
    } catch (e) {
      console.error(e);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !adding) { onClose(); return; }
    if (e.key === 'Escape' && adding) { setAdding(false); setNewName(''); return; }
    if (e.key === 'Enter' && adding) { e.preventDefault(); handleCreate(); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={handleKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-panel border border-border rounded-lg shadow-xl w-72 max-h-96 flex flex-col">
        <div className="flex items-center justify-between px-4 h-9 border-b border-border">
          <span className="text-xs font-mono uppercase tracking-wider text-faint">
            Collections — {repo.full_name}
          </span>
          <button
            onClick={onClose}
            className="text-faint hover:text-ink leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-elevated"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {collections.map((c) => {
            const checked = repoCollectionIds.has(c.id);
            return (
              <label
                key={c.id}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink hover:bg-elevated/40 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCollection(c.id)}
                  className="accent-[var(--color-brand)]"
                />
                {c.icon && <span className="text-xs">{c.icon}</span>}
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-faint text-xs tabular-nums">{c.repo_count}</span>
              </label>
            );
          })}
        </div>

        <div className="border-t border-border px-3 py-2">
          {adding ? (
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => { setAdding(false); setNewName(''); }}
              placeholder="New collection name…"
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs text-ink placeholder-muted outline-none focus:border-brand"
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full text-xs text-faint hover:text-dim text-left py-1 transition-colors"
            >
              + New collection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
