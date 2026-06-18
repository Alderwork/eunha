import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { useKeydown } from '../hooks/useKeydown';

const RELEASE_BODY_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'align'],
  },
};

// Show "Read more" if either the raw body is long or contains many lines —
// length alone misses short-but-tall release notes (lots of bullets / headings).
function shouldShowReadMore(body: string): boolean {
  if (body.length > 400) return true;
  const lineBreaks = (body.match(/\n/g) ?? []).length;
  return lineBreaks > 6;
}
import { Kbd } from './ui/Kbd';
import { Repo, WatchedRepoEntry } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReleaseAsset {
  id: number;
  release_id: string;
  name: string;
  download_url: string;
  size_bytes: number | null;
  content_type: string | null;
  platform: string | null;
  arch: string | null;
  file_type: string | null;
}

interface Release {
  id: string;
  repo_id: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
  is_prerelease: boolean;
  fetched_at: string;
  read_at: string | null;
  assets: ReleaseAsset[];
}

type PlatformFilter = 'all' | 'macos' | 'windows' | 'linux';
type FocusPane = 'repos' | 'releases';

interface Props {
  onBack: () => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'warn') => void;
  onRepoUpdated: (repo: Repo) => void;
  onUnreadCountChanged?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function uniquePlatforms(assets: ReleaseAsset[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const a of assets) {
    if (a.platform && !seen.has(a.platform)) {
      seen.add(a.platform);
      result.push(a.platform);
    }
  }
  return result;
}

const PLATFORM_LABELS: Record<string, string> = {
  macos: 'macOS',
  windows: 'Win',
  linux: 'Linux',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WatchingView({ onBack, showToast, onRepoUpdated, onUnreadCountChanged }: Props) {
  const [watchedRepos, setWatchedRepos] = useState<WatchedRepoEntry[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);
  const [selectedReleaseIdx, setSelectedReleaseIdx] = useState(0);
  const [focusPane, setFocusPane] = useState<FocusPane>('repos');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [expandedReleases, setExpandedReleases] = useState<Set<string>>(new Set());
  const repoListRef = useRef<HTMLDivElement>(null);
  const releaseListRef = useRef<HTMLDivElement>(null);
  const gPressedRef = useRef(false);

  const repoVirtualizer = useVirtualizer({
    count: watchedRepos.length,
    getScrollElement: () => repoListRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });


  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadWatchedRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const data = await invoke<WatchedRepoEntry[]>('list_watched_repos_with_unread');
      setWatchedRepos(data);
      setSelectedRepoIdx((i) => Math.min(i, Math.max(data.length - 1, 0)));
    } catch (e) {
      showToast(`Failed to load watched repos: ${e}`, 'error');
    } finally {
      setLoadingRepos(false);
    }
  }, [showToast]);

  const loadReleasesForRepo = useCallback(
    async (repoId: string, filter: PlatformFilter) => {
      setLoadingReleases(true);
      try {
        const data = await invoke<Release[]>('list_releases', {
          repoId,
          unreadOnly: false,
          platformFilter: filter === 'all' ? null : filter,
        });
        setReleases(data);
        setSelectedReleaseIdx(0);
      } catch (e) {
        showToast(`Failed to load releases: ${e}`, 'error');
      } finally {
        setLoadingReleases(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadWatchedRepos();
  }, [loadWatchedRepos]);

  const selectedEntry = watchedRepos[selectedRepoIdx] ?? null;

  useEffect(() => {
    setExpandedReleases(new Set());
    if (selectedEntry) {
      loadReleasesForRepo(selectedEntry.repo.id, platformFilter);
    } else {
      setReleases([]);
    }
  }, [selectedEntry?.repo.id, platformFilter]);

  useEffect(() => {
    repoVirtualizer.scrollToIndex(selectedRepoIdx, { align: 'auto' });
  }, [selectedRepoIdx]);

  useEffect(() => {
    if (focusPane === 'releases' && releaseListRef.current) {
      const cards = releaseListRef.current.querySelectorAll('[data-release-idx]');
      const card = cards[selectedReleaseIdx] as HTMLElement | undefined;
      card?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedReleaseIdx, focusPane]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function handleSync() {
    setSyncing(true);
    try {
      await invoke('sync_releases');
      await loadWatchedRepos();
      if (selectedEntry) {
        await loadReleasesForRepo(selectedEntry.repo.id, platformFilter);
      }
      showToast('Releases synced');
      onUnreadCountChanged?.();
    } catch (e) {
      showToast(`Sync failed: ${e}`, 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function handleMarkRead(release: Release) {
    if (release.read_at !== null) return;
    try {
      await invoke('mark_release_read', { releaseId: release.id });
      setReleases((prev) =>
        prev.map((r) => (r.id === release.id ? { ...r, read_at: new Date().toISOString() } : r))
      );
      setWatchedRepos((prev) =>
        prev.map((e) =>
          e.repo.id === release.repo_id ? { ...e, unread: Math.max(0, e.unread - 1) } : e
        )
      );
      onUnreadCountChanged?.();
    } catch (e) {
      showToast(`Failed to mark read: ${e}`, 'error');
    }
  }

  async function handleMarkAllRead() {
    if (!selectedEntry) return;
    try {
      await invoke('mark_all_releases_read', { repoId: selectedEntry.repo.id });
      setReleases((prev) => prev.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })));
      setWatchedRepos((prev) =>
        prev.map((e) => (e.repo.id === selectedEntry.repo.id ? { ...e, unread: 0 } : e))
      );
      showToast('All releases marked as read');
      onUnreadCountChanged?.();
    } catch (e) {
      showToast(`Failed: ${e}`, 'error');
    }
  }

  async function handleUnwatch() {
    if (!selectedEntry) return;
    try {
      const updated = await invoke<Repo>('toggle_watching', { repoId: selectedEntry.repo.id });
      onRepoUpdated(updated);
      const newRepos = watchedRepos.filter((e) => e.repo.id !== selectedEntry.repo.id);
      setWatchedRepos(newRepos);
      setSelectedRepoIdx((i) => Math.min(i, Math.max(newRepos.length - 1, 0)));
      setReleases([]);
      showToast(`Removed ${selectedEntry.repo.full_name} from watching`);
      onUnreadCountChanged?.();
    } catch (e) {
      showToast(`Failed: ${e}`, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  const selectedRelease = focusPane === 'releases' ? releases[selectedReleaseIdx] ?? null : null;

  useKeydown(
    useCallback(
      (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

        switch (e.key) {
          case 'Tab':
            e.preventDefault();
            setFocusPane((p) => (p === 'repos' ? 'releases' : 'repos'));
            break;
          case 'j':
          case 'ArrowDown':
            e.preventDefault();
            if (focusPane === 'repos') {
              setSelectedRepoIdx((i) => Math.min(i + 1, watchedRepos.length - 1));
            } else {
              setSelectedReleaseIdx((i) => Math.min(i + 1, releases.length - 1));
            }
            break;
          case 'k':
          case 'ArrowUp':
            e.preventDefault();
            if (focusPane === 'repos') {
              setSelectedRepoIdx((i) => Math.max(i - 1, 0));
            } else {
              setSelectedReleaseIdx((i) => Math.max(i - 1, 0));
            }
            break;
          case 'd':
            if (e.ctrlKey) {
              e.preventDefault();
              if (focusPane === 'repos') {
                setSelectedRepoIdx((i) => Math.min(i + 10, watchedRepos.length - 1));
              } else {
                setSelectedReleaseIdx((i) => Math.min(i + 10, releases.length - 1));
              }
            }
            break;
          case 'u':
            if (e.ctrlKey) {
              e.preventDefault();
              if (focusPane === 'repos') {
                setSelectedRepoIdx((i) => Math.max(i - 10, 0));
              } else {
                setSelectedReleaseIdx((i) => Math.max(i - 10, 0));
              }
            }
            break;
          case 'g':
            if (gPressedRef.current) {
              if (focusPane === 'repos') setSelectedRepoIdx(0);
              else setSelectedReleaseIdx(0);
              gPressedRef.current = false;
            } else {
              gPressedRef.current = true;
              setTimeout(() => { gPressedRef.current = false; }, 500);
            }
            break;
          case 'G':
            if (focusPane === 'repos') setSelectedRepoIdx(Math.max(0, watchedRepos.length - 1));
            else setSelectedReleaseIdx(Math.max(0, releases.length - 1));
            break;
          case 'o':
          case ' ':
            e.preventDefault();
            if (focusPane === 'releases' && selectedRelease) {
              openUrl(selectedRelease.html_url);
            } else if (focusPane === 'repos' && selectedEntry) {
              openUrl(`https://github.com/${selectedEntry.repo.full_name}`);
            }
            break;
          case 'r':
            if (!e.shiftKey && selectedRelease && selectedRelease.read_at === null) {
              handleMarkRead(selectedRelease);
            }
            break;
          case 'R':
            handleMarkAllRead();
            break;
          case 's':
            if (!syncing) handleSync();
            break;
          case 'x':
            if (focusPane === 'releases' && selectedRelease) {
              setExpandedReleases((prev) => {
                const next = new Set(prev);
                if (next.has(selectedRelease.id)) next.delete(selectedRelease.id);
                else next.add(selectedRelease.id);
                return next;
              });
            }
            break;
          case 'w':
            handleUnwatch();
            break;
          case '1': setPlatformFilter('all'); break;
          case '2': setPlatformFilter('macos'); break;
          case '3': setPlatformFilter('windows'); break;
          case '4': setPlatformFilter('linux'); break;
          case 'h':
          case 'Escape':
            onBack();
            break;
        }
      },
      [watchedRepos, releases, selectedRepoIdx, selectedReleaseIdx, selectedEntry, selectedRelease, syncing, platformFilter, focusPane, expandedReleases]
    ),
    [watchedRepos, releases, selectedRepoIdx, selectedReleaseIdx, selectedEntry, selectedRelease, syncing, platformFilter, focusPane, expandedReleases]
  );

  // -------------------------------------------------------------------------
  // JSX
  // -------------------------------------------------------------------------

  const filterPills: { label: string; value: PlatformFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'macOS', value: 'macos' },
    { label: 'Win', value: 'windows' },
    { label: 'Linux', value: 'linux' },
  ];

  const totalUnread = watchedRepos.reduce((s, e) => s + e.unread, 0);

  return (
    <div className="flex flex-row flex-1 min-h-0">
      {/* ── Left pane: watched repos ── */}
      <div className="flex-shrink-0 w-52 border-r border-border flex flex-col min-h-0">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-border gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink">Watched</span>
            {totalUnread > 0 && (
              <span className="text-[10px] font-semibold text-bg bg-accent rounded-full px-1.5 leading-4">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-2 py-0.5 rounded text-[11px] bg-surface hover:bg-elevated text-dim hover:text-ink border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? '…' : 'Sync'}
          </button>
        </div>

        {/* Repo list */}
        <div ref={repoListRef} className="flex-1 overflow-y-auto">
          {loadingRepos ? (
            <div className="flex items-center justify-center h-full text-xs text-muted">Loading…</div>
          ) : watchedRepos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-1 px-4 text-center">
              <p className="text-xs text-muted">No watched repos.</p>
              <p className="text-[11px] text-faint">Press <Kbd>w</Kbd> on a library row to watch.</p>
            </div>
          ) : (
            <div style={{ height: repoVirtualizer.getTotalSize(), position: 'relative' }}>
              {repoVirtualizer.getVirtualItems().map((vItem) => {
                const entry = watchedRepos[vItem.index];
                const isSelected = vItem.index === selectedRepoIdx;
                return (
                  <div
                    key={entry.repo.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${vItem.start}px)`,
                      height: 52,
                    }}
                    onClick={() => {
                      setSelectedRepoIdx(vItem.index);
                      setFocusPane('repos');
                    }}
                    className={`flex items-center px-2 gap-2 cursor-pointer border-b transition-colors ${
                      isSelected
                        ? 'bg-elevated border-border'
                        : 'bg-transparent border-border hover:bg-surface'
                    }`}
                  >
                    <div
                      className={`w-0.5 h-5 rounded-full flex-shrink-0 transition-colors ${
                        isSelected ? 'bg-accent' : 'bg-transparent'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-accent truncate leading-snug">
                        {entry.repo.full_name}
                      </p>
                      {entry.repo.language && (
                        <p className="text-[11px] text-faint truncate leading-snug">
                          {entry.repo.language}
                        </p>
                      )}
                    </div>
                    {entry.unread > 0 && (
                      <span className="flex-shrink-0 text-[10px] font-semibold text-bg bg-accent rounded-full px-1.5 leading-4">
                        {entry.unread}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-3 py-1.5 border-t border-border text-[11px] text-faint">
          {watchedRepos.length} repo{watchedRepos.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Right pane: release card timeline ── */}
      <div className="flex flex-col flex-1 min-h-0">
        {!selectedEntry ? (
          <div className="flex items-center justify-center flex-1 text-sm text-muted">
            Select a repo to see its releases.
          </div>
        ) : (
          <>
            {/* Right header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-mono text-accent truncate">
                  {selectedEntry.repo.full_name}
                </span>
                {selectedEntry.unread > 0 && (
                  <span className="text-xs text-accent font-mono flex-shrink-0">
                    {selectedEntry.unread} unread
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {filterPills.map((pill) => (
                  <button
                    key={pill.value}
                    onClick={() => setPlatformFilter(pill.value)}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      platformFilter === pill.value
                        ? 'bg-accent text-white'
                        : 'text-muted hover:text-dim hover:bg-surface'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Release cards */}
            <div ref={releaseListRef} className="flex-1 overflow-y-auto">
              {loadingReleases ? (
                <div className="flex items-center justify-center h-full text-sm text-muted">
                  Loading releases…
                </div>
              ) : releases.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-muted">
                  {platformFilter !== 'all' ? (
                    <p>No releases for {PLATFORM_LABELS[platformFilter] ?? platformFilter}.</p>
                  ) : (
                    <>
                      <p>No releases yet.</p>
                      <p className="text-xs flex items-center gap-1">
                        Press <Kbd>s</Kbd> to sync.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="px-3 py-3 space-y-3">
                  {releases.map((release, idx) => {
                    const isSelected = focusPane === 'releases' && idx === selectedReleaseIdx;
                    const isUnread = release.read_at === null;
                    const platforms = uniquePlatforms(release.assets);
                    const showTitle = release.name && release.name !== release.tag_name;
                    const isExpanded = expandedReleases.has(release.id);

                    return (
                      <div
                        key={release.id}
                        data-release-idx={idx}
                        onClick={() => {
                          setSelectedReleaseIdx(idx);
                          setFocusPane('releases');
                          handleMarkRead(release);
                        }}
                        className={`relative rounded-lg border overflow-hidden cursor-pointer transition-colors ${
                          isSelected ? 'border-accent/50' : 'border-border'
                        }`}
                      >
                        {/* Unread top accent bar */}
                        {isUnread && (
                          <div className="h-0.5 bg-accent" />
                        )}

                        <div className={`px-4 pt-3 pb-4 space-y-3 transition-colors ${
                          isSelected ? 'bg-elevated' : 'bg-panel hover:bg-surface'
                        }`}>
                          {/* Header: tag + time + badges */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-base font-semibold font-mono text-ink leading-none">
                                  {release.tag_name}
                                </span>
                                {release.is_prerelease && (
                                  <span className="px-1.5 py-px rounded-full text-[10px] bg-warn-tint text-warn border border-warn/30 leading-none">
                                    pre-release
                                  </span>
                                )}
                              </div>
                              {showTitle && (
                                <p className="text-sm text-dim leading-snug">{release.name}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                              {platforms.map((p) => (
                                <span
                                  key={p}
                                  className="px-1.5 py-px rounded text-[10px] bg-surface text-muted border border-border leading-none"
                                >
                                  {PLATFORM_LABELS[p] ?? p}
                                </span>
                              ))}
                              <span className="text-[11px] text-faint">{relativeTime(release.published_at)}</span>
                            </div>
                          </div>

                          {/* Body — inner content box like GitHub's gray area */}
                          {release.body && (
                            <div className="rounded-md border border-border bg-bg overflow-hidden relative">
                              <div
                                style={
                                  isExpanded
                                    ? undefined
                                    : {
                                        maxHeight: '12rem',
                                        WebkitMaskImage:
                                          'linear-gradient(to bottom, black 70%, transparent 100%)',
                                        maskImage:
                                          'linear-gradient(to bottom, black 70%, transparent 100%)',
                                      }
                                }
                                className={`px-4 py-3 text-[13px] text-dim leading-relaxed overflow-hidden
                                  [&_h1]:text-ink [&_h1]:font-semibold [&_h1]:text-base [&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:pb-1 [&_h1]:border-b [&_h1]:border-border
                                  [&_h2]:text-ink [&_h2]:font-semibold [&_h2]:text-sm [&_h2]:mt-2.5 [&_h2]:mb-1.5
                                  [&_h3]:text-dim [&_h3]:font-semibold [&_h3]:text-xs [&_h3]:mt-2 [&_h3]:mb-1
                                  [&_p]:my-1.5
                                  [&_strong]:text-ink
                                  [&_a]:text-accent [&_a]:underline
                                  [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5 [&_li]:my-0.5
                                  [&_code]:bg-surface [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px] [&_code]:text-dim
                                  [&_pre]:bg-surface [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:overflow-x-auto [&_pre]:my-2
                                  [&_hr]:border-border [&_hr]:my-2
                                  [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_blockquote]:my-2
                                  [&_img]:max-w-full [&_img]:rounded
                                  [&_table]:w-full [&_table]:my-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink [&_th]:border-b [&_th]:border-border [&_th]:pb-1 [&_td]:py-1 [&_td]:border-b [&_td]:border-border`}
                              >
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeRaw, [rehypeSanitize, RELEASE_BODY_SCHEMA]]}
                                >
                                  {release.body}
                                </ReactMarkdown>
                              </div>
                              {!isExpanded && shouldShowReadMore(release.body) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedReleases((prev) => new Set([...prev, release.id]));
                                  }}
                                  className="block w-full px-4 py-2 border-t border-border bg-bg text-left text-xs text-accent hover:bg-surface transition-colors"
                                >
                                  Read more
                                </button>
                              )}
                              {isExpanded && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedReleases((prev) => {
                                      const next = new Set(prev);
                                      next.delete(release.id);
                                      return next;
                                    });
                                  }}
                                  className="block w-full px-4 py-2 border-t border-border bg-bg text-left text-xs text-muted hover:bg-surface hover:text-dim transition-colors"
                                >
                                  Show less
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right footer */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted">
              <span>{releases.length} release{releases.length !== 1 ? 's' : ''}</span>
              <span className="flex items-center gap-1.5">
                <Kbd>Tab</Kbd> switch pane ·{' '}
                <Kbd>r</Kbd> mark read ·{' '}
                <Kbd>R</Kbd> all read ·{' '}
                <Kbd>x</Kbd> expand ·{' '}
                <Kbd>o</Kbd> open ·{' '}
                <Kbd>w</Kbd> unwatch
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
