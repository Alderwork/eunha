import { useState, useEffect, useRef } from 'react';
import { Repo } from '../types';

const CATEGORIES = [
  'CLI Tool', 'Library', 'Framework', 'Service',
  'Learning Resource', 'Template', 'Other',
];

interface Props {
  repo: Repo;
  onSave: (notes: string | null, category: string | null) => void;
  onDiscard: () => void;
}

export function EditPanel({ repo, onSave, onDiscard }: Props) {
  const [notes, setNotes] = useState(repo.user_notes ?? '');
  const [category, setCategory] = useState(repo.user_category ?? '');
  const isDirtyRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNotes(repo.user_notes ?? '');
    setCategory(repo.user_category ?? '');
    isDirtyRef.current = false;
  }, [repo.id]);

  function handleChange() {
    isDirtyRef.current = true;
  }

  function save() {
    if (isDirtyRef.current) {
      onSave(notes || null, category || null);
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

  // Save on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        save();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notes, category]);

  return (
    <div
      ref={panelRef}
      className="flex-shrink-0 border-t border-[var(--amber)] bg-[#0f0f12] px-5 py-4"
      style={{ minHeight: 200 }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--amber)] uppercase tracking-wide">
          Editing — {repo.full_name}
        </span>
        <div className="flex gap-3 text-xs text-[var(--muted)]">
          <span>
            <kbd className="px-1 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded">Esc</kbd>
            {' '}discard
          </span>
          <span>click outside to save</span>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-[var(--muted)] block mb-1">Category override</label>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); handleChange(); }}
            className="bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--amber)] w-48"
          >
            <option value="">— use LLM category —</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-[var(--muted)] block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); handleChange(); }}
            placeholder="Personal notes about this repo…"
            rows={3}
            className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--amber)] resize-none"
          />
        </div>
      </div>
    </div>
  );
}
