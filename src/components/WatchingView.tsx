import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Repo, LatestRelease } from '../types';
import { useKeydown } from '../hooks/useKeydown';

interface Props {
  onBack: () => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'warn') => void;
  onRepoUpdated: (repo: Repo) => void;
}

type ReleaseState = LatestRelease | 'loading' | 'no_releases' | 'error';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function WatchingView({ onBack, showToast, onRepoUpdated }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [releases, setReleases] = useState<Record<string, ReleaseState>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: repos.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  async function loadRepos() {
    try {
      const data = await invoke<Repo[]>('list_watching');
      setRepos(data);
      setSelectedIdx((i) => Math.min(i, Math.max(data.length - 1, 0)));
      data.forEach((r) => fetchRelease(r.id));
    } catch (e) {
      showToast(`Failed to load watching list: ${e}`, 'error');
    }
  }

  async function fetchRelease(repoId: string) {
    setReleases((prev) => ({ ...prev, [repoId]: 'loading' }));
    try {
      const release = await invoke<LatestRelease>('get_latest_release', { repoId });
      setReleases((prev) => ({ ...prev, [repoId]: release }));
    } catch (e) {
      const state: ReleaseState = String(e).includes('no_releases') ? 'no_releases' : 'error';
      setReleases((prev) => ({ ...prev, [repoId]: state }));
    }
  }

  async function handleUnwatch(repo: Repo) {
    try {
      const updated = await invoke<Repo>('toggle_watching', { repoId: repo.id });
      onRepoUpdated(updated);
      setRepos((rs) => rs.filter((r) => r.id !== repo.id));
      setSelectedIdx((i) => Math.max(0, Math.min(i, repos.length - 2)));
      showToast(`Removed ${repo.full_name} from watching`);
    } catch (e) {
      showToast(`Failed: ${e}`, 'error');
    }
  }

  useEffect(() => { loadRepos(); }, []);

  useEffect(() => {
    rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
  }, [selectedIdx]);

  const selectedRepo = repos[selectedIdx] ?? null;

  useKeydown(
    useCallback(
      (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIdx((i) => Math.min(i + 1, repos.length - 1));
            break;
          case 'k':
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIdx((i) => Math.max(i - 1, 0));
            break;
          case 'w':
            if (selectedRepo) handleUnwatch(selectedRepo);
            break;
          case 'r':
            if (selectedRepo) openUrl(`${selectedRepo.url}/releases`);
            break;
          case 'o':
            if (selectedRepo) openUrl(selectedRepo.url);
            break;
          case 'Escape':
            onBack();
            break;
        }
      },
      [repos, selectedIdx, selectedRepo]
    ),
    [repos, selectedIdx, selectedRepo]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2 border-b border-[var(--border)]">
        <span className="text-sm text-[var(--text)] font-semibold">Watching</span>
        <span className="text-xs text-[var(--muted)]">
          <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">r</kbd>
          {' '}releases ·{' '}
          <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">w</kbd>
          {' '}unwatch ·{' '}
          <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">Esc</kbd>
          {' '}back
        </span>
      </div>

      {/* List */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {repos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-[var(--muted)]">
            <p>No repos being watched.</p>
            <p className="text-xs">Press <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">w</kbd> on any repo in the library to add it.</p>
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const repo = repos[vItem.index];
              const releaseState = releases[repo.id];
              const isSelected = vItem.index === selectedIdx;

              return (
                <div
                  key={repo.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vItem.start}px)`,
                    height: 64,
                  }}
                  onClick={() => setSelectedIdx(vItem.index)}
                  className={`flex items-center px-5 gap-4 cursor-pointer border-b transition-colors ${
                    isSelected
                      ? 'bg-[#1a1a1e] border-[var(--border)]'
                      : 'bg-transparent border-[var(--border)] hover:bg-[#141416]'
                  }`}
                >
                  <div className={`w-0.5 h-6 rounded-full flex-shrink-0 transition-colors ${isSelected ? 'bg-[var(--amber)]' : 'bg-transparent'}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-[var(--amber)] truncate" style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                        {repo.full_name}
                      </span>
                      {repo.language && (
                        <span className="text-xs text-[var(--muted)] flex-shrink-0">{repo.language}</span>
                      )}
                    </div>
                    <p className="text-[13px] text-[#b0b0ac] truncate leading-tight mt-0.5">
                      {repo.llm_what ?? repo.description ?? ''}
                    </p>
                  </div>

                  {/* Release badge */}
                  <div className="flex-shrink-0 text-right">
                    {releaseState === 'loading' && (
                      <span className="text-xs text-[var(--muted)]">···</span>
                    )}
                    {releaseState === 'no_releases' && (
                      <span className="text-xs text-[var(--muted)]">no releases</span>
                    )}
                    {releaseState === 'error' && (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                    {releaseState && typeof releaseState === 'object' && (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-xs font-mono text-[var(--amber)]">{releaseState.tag_name}</span>
                        <span className="text-[11px] text-[var(--muted)]">{relativeTime(releaseState.published_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-[var(--border)] text-xs text-[var(--muted)]">
        <span>{repos.length} watching</span>
        <span>
          <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">W</kbd>
          {' '}to open from library
        </span>
      </div>
    </div>
  );
}
