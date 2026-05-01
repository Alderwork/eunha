import { useState, useEffect, useRef } from 'react';
import { Repo } from '../types';
import { Kbd } from './ui/Kbd';

const CATEGORIES = [
  'CLI Tool', 'Library', 'Framework', 'Service',
  'Learning Resource', 'Template', 'Other',
];

interface Props {
  repo: Repo;
  onSave: (notes: string | null, category: string | null, locked: boolean) => void;
  onDiscard: () => void;
}

export function EditPanel({ repo, onSave, onDiscard }: Props) {
  const [notes, setNotes] = useState(repo.user_notes ?? '');
  const [category, setCategory] = useState(repo.user_category ?? '');
  const [locked, setLocked] = useState(repo.category_locked);
  const isDirtyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNotes(repo.user_notes ?? '');
    setCategory(repo.user_category ?? '');
    setLocked(repo.category_locked);
    isDirtyRef.current = false;
  }, [repo.id]);

  function handleChange() {
    isDirtyRef.current = true;
  }

  function save() {
    if (isDirtyRef.current) {
      onSave(notes || null, category || null, locked);
    } else {
      onDiscard();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDiscard();
    }
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        save();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notes, category, locked]);

  return (
    <div
      ref={panelRef}
      className="flex-shrink-0 border-t border-brand bg-bg px-5 py-4"
      style={{ minHeight: 200 }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-accent uppercase tracking-wide">
          Editing — {repo.full_name}
        </span>
        <div className="flex gap-3 text-xs text-muted">
          <span><Kbd>Esc</Kbd> discard</span>
          <span>click outside to save</span>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted block mb-1">Category override</label>
          <div className="flex items-center gap-3">
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); handleChange(); }}
              className="bg-input border border-border rounded px-3 py-1.5 text-sm text-ink outline-none focus:border-brand w-48"
            >
              <option value="">— use LLM category —</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => { setLocked(e.target.checked); handleChange(); }}
                className="accent-[var(--color-brand)]"
              />
              Lock — AI won't override
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); handleChange(); }}
            placeholder="Personal notes about this repo…"
            rows={3}
            className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-ink placeholder-muted outline-none focus:border-brand resize-none"
          />
        </div>
      </div>
    </div>
  );
}
