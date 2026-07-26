import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../../ui/Button';
import type { Repo } from '../../../types';

export function FollowRecentStars({ onContinue }: { onContinue: () => void }) {
  const [repos, setRepos] = useState<Repo[]>([]); const [selected, setSelected] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false);
  useEffect(() => { invoke<Repo[]>('list_recent_star_candidates').then(setRepos).catch(console.error); }, []);
  async function finish() { setBusy(true); try { await Promise.all(repos.filter(r => selected.has(r.id) && !r.watching).map(r => invoke('toggle_watching', { repoId: r.id }))); onContinue(); } finally { setBusy(false); } }
  return <div className="text-center"><h2 className="text-lg font-semibold text-ink mb-2">Follow recent projects?</h2><p className="text-sm text-muted mb-4">Select only projects whose releases you want Eunha to track.</p><div className="max-h-52 overflow-auto text-left rounded border border-border mb-4">{repos.map(r => <label key={r.id} className="flex gap-2 px-3 py-2 text-sm border-b border-border last:border-0"><input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected(s => { const n=new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}/><span>{r.full_name}</span></label>)}</div><Button variant="primary" onClick={finish} disabled={busy} className="w-full">{selected.size ? `Follow ${selected.size} project${selected.size === 1 ? '' : 's'}` : 'Skip for now'}</Button></div>;
}
