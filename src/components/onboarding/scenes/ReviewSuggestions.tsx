import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../ui/Button';
import type { ClassificationSuggestion, Purpose } from '../../../types';

/** Review is deliberately local and cheap: GitHub topics/language create the draft.
 * LLM descriptions remain an opt-in action elsewhere in the app. */
export function ReviewSuggestions({ onContinue }: { onContinue: () => void }) {
  const [items, setItems] = useState<ClassificationSuggestion[]>([]);
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [approved, setApproved] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.all([invoke<ClassificationSuggestion[]>('list_classification_suggestions'), invoke<Purpose[]>('list_purposes')]).then(([s, p]) => { setItems(s); setPurposes(p); }).catch(console.error); }, []);
  const item = items[0];
  async function decide(approve: boolean) {
    if (!item || busy) return; setBusy(true);
    try {
      if (approve) {
        const ids = purposes.filter(p => item.suggested_purposes.includes(p.name)).map(p => p.id);
        await invoke('save_repo_classification', { repoId: item.repo.id, tagNames: item.suggested_tags, purposeIds: ids.length ? ids : purposes.slice(0, 1).map(p => p.id) });
        setApproved(n => n + 1);
      } else await invoke('defer_repo_classification', { repoId: item.repo.id });
      setItems(xs => xs.slice(1));
    } finally { setBusy(false); }
  }
  if (!item) return <div className="text-center"><h2 className="text-lg font-semibold text-ink mb-2">Suggestions ready</h2><p className="text-sm text-muted mb-6">{approved ? `${approved} repositories organized.` : 'You can organize your library later.'}</p><Button variant="primary" onClick={onContinue} className="w-full">Continue</Button></div>;
  return <div className="text-center"><h2 className="text-lg font-semibold text-ink mb-2">Review a suggestion</h2><p className="text-sm text-muted mb-4">Approve one bundle to continue. You can edit or defer the rest in your library.</p><div className="text-left rounded border border-border bg-panel p-4 mb-4"><div className="font-medium text-ink">{item.repo.full_name}</div><div className="text-xs text-muted mt-1">{item.repo.description || 'No description'}</div><div className="text-xs text-accent mt-3">{item.suggested_tags.join(' · ') || 'No tags'} · {item.suggested_purposes.join(', ')}</div></div><div className="flex gap-2"><Button onClick={() => decide(false)} disabled={busy} className="flex-1">Defer</Button><Button variant="primary" onClick={() => decide(true)} disabled={busy} className="flex-1">Approve</Button></div>{approved > 0 && <button className="text-xs text-muted mt-4 underline" onClick={onContinue}>Continue with remaining suggestions</button>}</div>;
}
