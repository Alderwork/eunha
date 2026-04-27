import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FeedGroup, FeedFetchProgress, FeedFetchResult, Repo } from '../types';
import { useKeydown } from '../hooks/useKeydown';

interface Props {
  onBack: () => void;
  onRepoAdded: (repo: Repo) => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'warn') => void;
  onDescribeRepo: (repo: Repo) => void;
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function FeedView({ onBack, onRepoAdded, showToast, onDescribeRepo }: Props) {
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FeedFetchProgress | null>(null);
  const [lastFetchResult, setLastFetchResult] = useState<FeedFetchResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // True once groups has been non-empty this session — distinguishes "inbox cleared" from "nothing found"
  const [hadItems, setHadItems] = useState(false);
  // Track which repos are being added (repo_full_name -> true)
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  async function loadItems(): Promise<FeedGroup[]> {
    try {
      const items = await invoke<FeedGroup[]>('get_feed_items');
      setGroups(items);
      if (items.length > 0) setHadItems(true);
      setSelectedIdx((i) => Math.min(i, Math.max(items.length - 1, 0)));
      return items;
    } catch (e) {
      showToast(`Failed to load feed: ${e}`, 'error');
      return [];
    }
  }

  async function runFetch() {
    if (fetching) return;
    setFetching(true);
    setFetchProgress(null);
    setFetchError(null);
    try {
      const result = await invoke<FeedFetchResult>('fetch_feed');
      setLastFetchResult(result);
      if (result.users_total === 0) {
        showToast("You don't follow anyone on GitHub yet.", 'warn');
      } else if (result.items_found > 0) {
        showToast(`Found ${result.items_found} new repos from your network`);
      }
      if (result.failed_users > 0) {
        showToast(`Feed: ${result.failed_users} user${result.failed_users === 1 ? '' : 's'} could not be fetched`, 'warn');
      }
      if (result.error) {
        showToast(result.error, 'warn');
      }
      await loadItems();
    } catch (e) {
      setFetchError(String(e));
      showToast(`Feed fetch failed: ${e}`, 'error');
    } finally {
      setFetching(false);
      setFetchProgress(null);
    }
  }

  // Load items on mount; auto-fetch if empty
  // NOTE: do NOT call update_last_visited_at here — fetch_feed updates the cutoff
  // at the end of a successful fetch. Calling it on mount before the fetch would set
  // the cutoff to NOW and make the initial auto-fetch find nothing (first-time users
  // would see an empty feed instead of the last 7 days of activity).
  useEffect(() => {
    loadItems().then((items) => {
      if (items.length === 0) runFetch();
    });

    let unlisten: (() => void) | null = null;
    listen<FeedFetchProgress>('feed:progress', (e) => {
      setFetchProgress(e.payload);
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);

  // Scroll selected row into view
  useEffect(() => {
    if (groups.length > 0) {
      rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
    }
  }, [selectedIdx]);

  async function handleAdd(group: FeedGroup) {
    if (adding.has(group.repo_full_name)) return;
    setAdding((s) => new Set(s).add(group.repo_full_name));
    try {
      const repo = await invoke<Repo>('add_feed_repo_to_library', {
        repoFullName: group.repo_full_name,
      });
      onRepoAdded(repo);
      // Auto-dismiss: remove from feed after adding (inbox model — it's been processed)
      setGroups((gs) => gs.filter((g) => g.repo_full_name !== group.repo_full_name));
      setSelectedIdx((i) => Math.max(0, Math.min(i, groups.length - 2)));
      showToast(`Added ${group.repo_full_name} to library`);
    } catch (e) {
      showToast(`Failed to add: ${e}`, 'error');
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(group.repo_full_name);
        return next;
      });
    }
  }

  async function handleAddAndDescribe(group: FeedGroup) {
    if (adding.has(group.repo_full_name)) return;
    setAdding((s) => new Set(s).add(group.repo_full_name));
    try {
      const repo = await invoke<Repo>('add_feed_repo_to_library', {
        repoFullName: group.repo_full_name,
      });
      onRepoAdded(repo);
      // Auto-dismiss after adding
      setGroups((gs) => gs.filter((g) => g.repo_full_name !== group.repo_full_name));
      setSelectedIdx((i) => Math.max(0, Math.min(i, groups.length - 2)));
      showToast(`Added — describing in library…`);
      // Trigger LLM describe via parent callback (switches view to library)
      onDescribeRepo(repo);
    } catch (e) {
      showToast(`Failed: ${e}`, 'error');
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(group.repo_full_name);
        return next;
      });
    }
  }

  async function handleDismiss(group: FeedGroup) {
    try {
      await invoke('dismiss_feed_item', { repoFullName: group.repo_full_name });
      setGroups((gs) => gs.filter((g) => g.repo_full_name !== group.repo_full_name));
      setSelectedIdx((i) => Math.max(0, Math.min(i, groups.length - 2)));
    } catch (e) {
      showToast(`Dismiss failed: ${e}`, 'error');
    }
  }

  useKeydown(
    useCallback(
      (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        const group = groups[selectedIdx] ?? null;

        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIdx((i) => Math.min(i + 1, groups.length - 1));
            break;
          case 'k':
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIdx((i) => Math.max(i - 1, 0));
            break;
          case 'a':
            if (group && !adding.has(group.repo_full_name)) handleAdd(group);
            break;
          case 'd':
            if (group && !adding.has(group.repo_full_name)) handleAddAndDescribe(group);
            break;
          case 'x':
            if (group) handleDismiss(group);
            break;
          case 'o':
            if (group) openUrl(group.repo_url);
            break;
          case 'r':
            runFetch();
            break;
          case 'Escape':
            onBack();
            break;
        }
      },
      [groups, selectedIdx, adding, fetching]
    ),
    [groups, selectedIdx, adding, fetching]
  );

  const selectedGroup = groups[selectedIdx] ?? null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Feed header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            title="Back to library (Esc)"
          >
            ← Library
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">Network Stars</span>
              <span className="text-[10px] font-mono text-[var(--amber)] border border-[var(--amber)] border-opacity-40 px-1 py-0.5 rounded leading-none opacity-70">
                FEED
              </span>
            </div>
            <p className="text-xs text-[var(--muted)] leading-none mt-0.5">
              repos your network starred recently
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fetching && (
            <button
              onClick={() => {
                invoke('cancel_feed_fetch');
                setFetching(false);
              }}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--muted)] transition-colors"
              title="Cancel fetch"
            >
              Cancel
            </button>
          )}
          <button
            onClick={runFetch}
            disabled={fetching}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--muted)] transition-colors disabled:opacity-40"
            title="Refresh feed (r)"
          >
            {fetching ? 'Fetching…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Fetch progress bar */}
      {fetching && fetchProgress && (
        <div className="flex-shrink-0 px-5 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          <div aria-live="polite" className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
            <span>
              {fetchProgress.phase === 'following'
                ? 'Fetching people you follow…'
                : fetchProgress.current_user
                ? `Checking ${fetchProgress.current_user}…`
                : 'Fetching…'}
            </span>
            <span>
              {fetchProgress.users_total > 0
                ? `${fetchProgress.users_done}/${fetchProgress.users_total} users · ${fetchProgress.items_found} found`
                : ''}
            </span>
          </div>
          {fetchProgress.users_total > 0 && (
            <div
              role="progressbar"
              aria-valuenow={fetchProgress.users_done}
              aria-valuemax={fetchProgress.users_total}
              aria-label="Feed fetch progress"
              className="h-0.5 bg-[var(--border)] rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-[var(--amber)] transition-all duration-300"
                style={{
                  width: `${(fetchProgress.users_done / fetchProgress.users_total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Feed list */}
      <div ref={listRef} role="list" className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            {fetching ? (
              <span className="text-sm text-[var(--muted)]">Fetching your network&apos;s activity…</span>
            ) : fetchError ? (
              <>
                <span className="text-sm font-serif text-[var(--muted)]">Could not reach GitHub.</span>
                <span className="text-xs text-[var(--muted)] opacity-60 text-center max-w-xs">
                  {fetchError}
                </span>
                <span className="text-xs text-[var(--muted)] opacity-60">
                  Check your connection, then press{' '}
                  <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono">r</kbd>
                  {' '}to retry.
                </span>
              </>
            ) : hadItems ? (
              <>
                <span className="text-sm font-serif text-[var(--muted)]">Inbox cleared.</span>
                <span className="text-xs text-[var(--muted)] opacity-60">
                  Press{' '}
                  <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono">r</kbd>
                  {' '}to check for more.
                </span>
              </>
            ) : lastFetchResult ? (
              <>
                <span className="text-sm font-serif text-[var(--muted)]">
                  {lastFetchResult.users_total === 0
                    ? "You don't follow anyone on GitHub yet."
                    : `No new repos since last visit — checked ${lastFetchResult.users_total} users`}
                </span>
                <span className="text-xs text-[var(--muted)] opacity-60">
                  Press{' '}
                  <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono">r</kbd>
                  {' '}to refresh
                </span>
              </>
            ) : (
              <span className="text-sm font-serif text-[var(--muted)]">No new repos from your network.</span>
            )}
          </div>
        ) : (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const group = groups[vItem.index];
              const isSelected = vItem.index === selectedIdx;
              const isAdding = adding.has(group.repo_full_name);

              return (
                <div
                  key={group.repo_full_name}
                  role="listitem"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  onClick={() => setSelectedIdx(vItem.index)}
                >
                  <div
                    className={`flex items-start px-5 py-3 border-b border-[var(--border)] cursor-pointer transition-colors ${
                      isSelected ? 'bg-[var(--surface)]' : 'hover:bg-[var(--surface)]'
                    } ${isAdding ? 'opacity-60' : ''}`}
                  >
                    {/* Selection indicator */}
                    <div
                      className={`flex-shrink-0 w-0.5 self-stretch mr-3 rounded-full transition-colors ${
                        isSelected ? 'bg-[var(--amber)]' : 'bg-transparent'
                      }`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm truncate text-[var(--amber)]">
                          {group.repo_full_name}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isAdding && (
                            <span className="text-xs text-[var(--amber)]">adding…</span>
                          )}
                          {group.repo_language && (
                            <span className="text-xs text-[var(--muted)]">
                              {group.repo_language}
                            </span>
                          )}
                        </div>
                      </div>

                      {group.repo_description && (
                        <p className="text-xs text-[var(--text)] mt-0.5 truncate">
                          {group.repo_description}
                        </p>
                      )}

                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-xs text-[var(--muted)]">★ by</span>
                        <span className="text-xs text-[var(--muted)]">
                          {group.starred_by.slice(0, 3).join(', ')}
                          {group.starred_by.length > 3 && ` +${group.starred_by.length - 3}`}
                        </span>
                        <span className="text-xs text-[var(--muted)]">·</span>
                        <span className="text-xs text-[var(--muted)]">
                          {relativeTime(group.latest_starred_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail panel for selected group */}
      {selectedGroup && (
        <div
          aria-label={`Selected: ${selectedGroup.repo_full_name}`}
          className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-4 max-h-48 overflow-y-auto"
        >
          <div className="flex items-start justify-between gap-4 mb-2">
            <span className="font-mono text-sm text-[var(--amber)]">
              {selectedGroup.repo_full_name}
            </span>
            <div className="flex items-center gap-3 flex-shrink-0 text-xs text-[var(--muted)]">
              {selectedGroup.repo_language && <span>{selectedGroup.repo_language}</span>}
              {selectedGroup.repo_stars_count != null && (
                <span>★ {selectedGroup.repo_stars_count.toLocaleString()}</span>
              )}
            </div>
          </div>

          {selectedGroup.repo_description && (
            <p className="text-sm text-[var(--text)] mb-2">{selectedGroup.repo_description}</p>
          )}

          {/* Stargazers — cap at 10 to keep action hints visible */}
          <div className="flex flex-wrap gap-1 mb-3">
            {selectedGroup.starred_by.slice(0, 10).map((user) => (
              <span
                key={user}
                className="text-xs text-[var(--muted)] border border-[var(--border)] px-1.5 py-0.5 rounded"
              >
                {user}
              </span>
            ))}
            {selectedGroup.starred_by.length > 10 && (
              <span className="text-xs text-[var(--muted)] border border-[var(--border)] px-1.5 py-0.5 rounded">
                +{selectedGroup.starred_by.length - 10} more
              </span>
            )}
          </div>

          {/* Action hints — separated from info above */}
          <div className={`border-t border-[var(--border)] pt-2 flex gap-4 text-xs text-[var(--muted)] ${
            adding.has(selectedGroup.repo_full_name) ? 'opacity-40' : ''
          }`}>
            <span>
              <kbd className="px-1 bg-[var(--bg)] border border-[var(--border)] rounded font-mono">a</kbd>
              {' '}add to library
            </span>
            <span>
              <kbd className="px-1 bg-[var(--bg)] border border-[var(--border)] rounded font-mono">d</kbd>
              {' '}add + describe
            </span>
            <span>
              <kbd className="px-1 bg-[var(--bg)] border border-[var(--border)] rounded font-mono">o</kbd>
              {' '}open
            </span>
            <span>
              <kbd className="px-1 bg-[var(--bg)] border border-[var(--border)] rounded font-mono">x</kbd>
              {' '}dismiss
            </span>
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-[var(--border)] text-xs text-[var(--muted)]">
        <span>{groups.length} items in feed</span>
        <span>
          <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">Esc</kbd>
          {' '}back to library
        </span>
      </div>
    </div>
  );
}
