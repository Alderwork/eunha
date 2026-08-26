import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FeedGroup, FeedFetchProgress, FeedFetchResult, Repo } from '../types';
import { useKeydown } from '../hooks/useKeydown';
import { Kbd } from './ui/Kbd';
import { Chip } from './ui/Chip';
import { VariantToggle } from './ui/VariantToggle';
import { RepoRowDense } from './repo-views/RepoRowDense';
import { RepoRowComfy } from './repo-views/RepoRowComfy';
import { RepoCardMasonry } from './repo-views/RepoCardMasonry';
import { feedGroupToRepo } from '../lib/adapters';
import { getLibraryRowHeight, ViewVariant } from '../lib/visuals';

interface Props {
  onBack: () => void;
  onRepoAdded: (repo: Repo) => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'warn') => void;
  // Triggers describe on the library copy of a feed item.
  // If the item is not in library yet, App auto-adds it and then describes.
  // Resolves to { wasAdded: true } when the auto-add path ran, so the feed
  // row can be removed from view; throws on failure.
  onDescribe: (repoFullName: string) => Promise<{ wasAdded: boolean }>;
  // Set of repo IDs (== full_name) currently being described — surfaces the
  // spinner on matching feed rows and the top progress bar.
  describing: Set<string>;
  viewVariant: ViewVariant;
  onVariantChange: (v: ViewVariant) => void;
  // Reports the focused feed row to App so the right detail sidebar can mirror it.
  // `fromClick` is true when the change was a mouse click (auto-opens the sidebar).
  onSelectionChange?: (repo: Repo | null, fromClick: boolean) => void;
}

function formatStarredBy(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
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

export function FeedView({ onBack, onRepoAdded, showToast, onDescribe, describing, viewVariant, onVariantChange, onSelectionChange }: Props) {
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const gPressedRef = useRef(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<FeedFetchProgress | null>(null);
  const [lastFetchResult, setLastFetchResult] = useState<FeedFetchResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [hadItems, setHadItems] = useState(false);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const masonryScrollRef = useRef<HTMLDivElement>(null);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;
  const variantRef = useRef(viewVariant);
  variantRef.current = viewVariant;

  const rowVirtualizer = useVirtualizer({
    count: viewVariant === 'masonry' ? 0 : groups.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i: number) =>
      getLibraryRowHeight(
        feedGroupToRepo(groupsRef.current[i]),
        i === selectedIdxRef.current,
        variantRef.current,
      ),
    getItemKey: (i: number) => groupsRef.current[i]?.repo_full_name ?? i,
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

  useEffect(() => {
    if (viewVariant === 'masonry') return;
    rowVirtualizer.measure();
    if (groups.length > 0) {
      rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
    }
  }, [selectedIdx, viewVariant]);

  useEffect(() => {
    if (viewVariant !== 'masonry') return;
    const root = masonryScrollRef.current;
    if (!root) return;
    const card = root.querySelector<HTMLElement>(`[data-masonry-idx="${selectedIdx}"]`);
    card?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, viewVariant, groups.length]);

  // Mirror the focused feed row to App's detail sidebar. Keyboard nav (this
  // effect) doesn't auto-open; row clicks do, via the explicit fromClick=true
  // call below.
  useEffect(() => {
    if (!onSelectionChange) return;
    const group = groups[selectedIdx] ?? null;
    onSelectionChange(group ? feedGroupToRepo(group) : null, false);
  }, [selectedIdx, groups, onSelectionChange]);

  async function handleAdd(group: FeedGroup) {
    if (adding.has(group.repo_full_name)) return;
    setAdding((s) => new Set(s).add(group.repo_full_name));
    try {
      const repo = await invoke<Repo>('add_feed_repo_to_library', {
        repoFullName: group.repo_full_name,
      });
      onRepoAdded(repo);
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

  async function handleDescribe(group: FeedGroup) {
    if (adding.has(group.repo_full_name)) return;
    setAdding((s) => new Set(s).add(group.repo_full_name));
    try {
      const result = await onDescribe(group.repo_full_name);
      if (result.wasAdded) {
        setGroups((gs) => gs.filter((g) => g.repo_full_name !== group.repo_full_name));
        setSelectedIdx((i) => Math.max(0, Math.min(i, groups.length - 2)));
      }
    } catch (e) {
      showToast(`Describe failed: ${e}`, 'error');
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
          case 'd':
            if (e.ctrlKey) {
              e.preventDefault();
              setSelectedIdx((i) => Math.min(i + 10, groups.length - 1));
              break;
            }
            if (group) handleDescribe(group);
            break;
          case 'u':
            if (e.ctrlKey) {
              e.preventDefault();
              setSelectedIdx((i) => Math.max(i - 10, 0));
            }
            break;
          case 'g':
            if (gPressedRef.current) {
              setSelectedIdx(0);
              gPressedRef.current = false;
            } else {
              gPressedRef.current = true;
              setTimeout(() => { gPressedRef.current = false; }, 500);
            }
            break;
          case 'G':
            setSelectedIdx(Math.max(0, groups.length - 1));
            break;
          case 'a':
            if (group && !adding.has(group.repo_full_name)) handleAdd(group);
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
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">Network Stars</span>
              <span className="text-[10px] font-mono text-accent border border-accent/40 px-1 py-0.5 rounded-[2px] leading-none">
                FEED
              </span>
            </div>
            <p className="text-xs text-muted leading-none mt-0.5">
              repos your network starred recently
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VariantToggle value={viewVariant} onChange={onVariantChange} />
          {fetching && (
            <button
              onClick={() => {
                invoke('cancel_feed_fetch');
                setFetching(false);
              }}
              className="text-xs text-muted hover:text-ink px-2 py-1 rounded border border-border hover:border-dim transition-colors"
              title="Cancel fetch"
            >
              Cancel
            </button>
          )}
          <button
            onClick={runFetch}
            disabled={fetching}
            className="text-xs text-muted hover:text-ink px-2 py-1 rounded border border-border hover:border-dim transition-colors disabled:opacity-40"
            title="Refresh feed (r)"
          >
            {fetching ? 'Fetching…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Fetch progress bar */}
      {fetching && fetchProgress && (
        <div className="flex-shrink-0 px-5 py-2 border-b border-border bg-surface">
          <div aria-live="polite" className="flex items-center justify-between text-xs text-muted mb-1">
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
              className="h-0.5 bg-elevated rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-brand transition-all duration-300"
                style={{
                  width: `${(fetchProgress.users_done / fetchProgress.users_total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Describe progress — shown while any feed item's library copy is being described. */}
      {describing.size > 0 && (
        <div
          className="eunha-progress-bar"
          role="progressbar"
          aria-label={`Describing ${describing.size} repo${describing.size !== 1 ? 's' : ''}`}
        />
      )}

      {/* Feed list */}
      {(() => {
        // Empty state — shared across all variants
        if (groups.length === 0) {
          return (
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col items-center justify-center h-full gap-2">
                {fetching ? (
                  <span className="text-sm text-muted">Fetching your network&apos;s activity…</span>
                ) : fetchError ? (
                  <>
                    <span className="text-sm text-muted">Could not reach GitHub.</span>
                    <span className="text-xs text-muted opacity-60 text-center max-w-xs">
                      {fetchError}
                    </span>
                    <span className="text-xs text-muted opacity-60 flex items-center gap-1">
                      Check your connection, then press{' '}
                      <Kbd>r</Kbd>
                      {' '}to retry.
                    </span>
                  </>
                ) : hadItems ? (
                  <>
                    <span className="text-sm text-muted">Inbox cleared.</span>
                    <span className="text-xs text-muted opacity-60 flex items-center gap-1">
                      Press{' '}<Kbd>r</Kbd>{' '}to check for more.
                    </span>
                  </>
                ) : lastFetchResult ? (
                  <>
                    <span className="text-sm text-muted">
                      {lastFetchResult.users_total === 0
                        ? "You don't follow anyone on GitHub yet."
                        : `No new repos since last visit — checked ${lastFetchResult.users_total} users`}
                    </span>
                    <span className="text-xs text-muted opacity-60 flex items-center gap-1">
                      Press{' '}<Kbd>r</Kbd>{' '}to refresh
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted">No new repos from your network.</span>
                )}
              </div>
            </div>
          );
        }

        // Build a per-variant rightExtra so feed metadata fits each layout's right slot.
        const buildRightExtra = (group: FeedGroup, isAdding: boolean) => {
          const time = relativeTime(group.latest_starred_at);
          const starred = formatStarredBy(group.starred_by);
          if (viewVariant === 'comfy') {
            return (
              <>
                {isAdding && <Chip tone="accent">adding…</Chip>}
                <span className="text-xs text-faint">{time}</span>
                <span className="text-xs text-muted truncate max-w-[140px]">{starred}</span>
              </>
            );
          }
          // Dense + Masonry → single inline line
          return (
            <div className="flex items-center gap-2 text-xs">
              {isAdding && <span className="text-accent">adding…</span>}
              <span className="text-faint whitespace-nowrap">{time}</span>
              {starred && (
                <span className="text-muted truncate max-w-[140px]">· {starred}</span>
              )}
            </div>
          );
        };

        if (viewVariant === 'masonry') {
          return (
            <div ref={masonryScrollRef} role="list" className="flex-1 overflow-y-auto px-3.5 pt-3.5 pb-1">
              <div className="eunha-masonry-grid">
                {groups.map((group, i) => {
                  const isSelected = i === selectedIdx;
                  const isAdding = adding.has(group.repo_full_name);
                  const repo = feedGroupToRepo(group);
                  return (
                    <div
                      key={group.repo_full_name}
                      role="listitem"
                      style={{ opacity: isAdding ? 0.6 : 1 }}
                    >
                      <RepoCardMasonry
                        repo={repo}
                        index={i}
                        isSelected={isSelected}
                        isDescribing={describing.has(group.repo_full_name)}
                        currentPromptVersion={0}
                        onClick={() => {
                          setSelectedIdx(i);
                          onSelectionChange?.(repo, true);
                        }}
                        rightExtra={buildRightExtra(group, isAdding)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div ref={listRef} role="list" className="flex-1 overflow-y-auto">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vItem: { index: number; start: number }) => {
                const group = groups[vItem.index];
                const isSelected = vItem.index === selectedIdx;
                const isAdding = adding.has(group.repo_full_name);
                const repo = feedGroupToRepo(group);
                const rightExtra = buildRightExtra(group, isAdding);
                const RowComponent = viewVariant === 'dense' ? RepoRowDense : RepoRowComfy;

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
                      opacity: isAdding ? 0.6 : 1,
                    }}
                  >
                    <RowComponent
                      repo={repo}
                      isSelected={isSelected}
                      isDescribing={describing.has(group.repo_full_name)}
                      currentPromptVersion={0}
                      onClick={() => {
                        setSelectedIdx(vItem.index);
                        onSelectionChange?.(repo, true);
                      }}
                      rightExtra={rightExtra}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Action hint bar */}
      {selectedGroup && (
        <div className={`flex-shrink-0 border-t border-border px-5 py-2 flex gap-4 text-xs text-muted ${
          adding.has(selectedGroup.repo_full_name) ? 'opacity-40' : ''
        }`}>
          <span className="flex items-center gap-1"><Kbd>a</Kbd>{' '}add</span>
          <span className="flex items-center gap-1"><Kbd>d</Kbd>{' '}describe</span>
          <span className="flex items-center gap-1"><Kbd>o</Kbd>{' '}open</span>
          <span className="flex items-center gap-1"><Kbd>x</Kbd>{' '}dismiss</span>
        </div>
      )}

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-border text-xs text-muted">
        <span>{groups.length} items in feed</span>
        <span className="flex items-center gap-1"><Kbd>h</Kbd>{' '}library</span>
      </div>
    </div>
  );
}
