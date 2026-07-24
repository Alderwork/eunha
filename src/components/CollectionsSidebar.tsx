import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Collection } from '../types';

interface Props {
  collections: Collection[];
  selectedCollection: number | null;
  onCollectionChange: (id: number | null) => void;
  onCollectionsChange: () => void;
}

export function CollectionsSidebar({
  collections,
  selectedCollection,
  onCollectionChange,
  onCollectionsChange,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await invoke('create_collection', { name });
      setNewName('');
      setAdding(false);
      onCollectionsChange();
    } catch (e) {
      console.error(e);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setAdding(false); setNewName(''); }
    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
  }

  return (
    <nav className="overflow-y-auto flex-shrink-0" aria-label="Collections">
      <ul className="py-1">
        {collections.map((c) => {
          const isActive = selectedCollection === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onCollectionChange(isActive ? null : c.id)}
                className={[
                  'relative w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'text-accent bg-elevated before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent'
                    : 'text-muted hover:text-dim hover:bg-elevated/40',
                ].join(' ')}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {c.icon && <span className="text-[11px]">{c.icon}</span>}
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="text-faint text-[11px] tabular-nums ml-2 flex-shrink-0">{c.repo_count}</span>
              </button>
            </li>
          );
        })}

        {adding ? (
          <li className="px-3 py-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => { setAdding(false); setNewName(''); }}
              placeholder="Collection name…"
              className="w-full bg-input border border-border rounded px-2 py-1 text-xs text-ink placeholder-muted outline-none focus:border-brand"
            />
          </li>
        ) : (
          <li>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-faint hover:text-dim hover:bg-elevated/40 transition-colors"
            >
              <span className="text-[11px]">+</span>
              <span>New collection</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
