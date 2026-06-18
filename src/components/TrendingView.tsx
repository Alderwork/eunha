import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Repo } from '../types';
import { useKeydown } from '../hooks/useKeydown';
import { Kbd } from './ui/Kbd';
import { Chip } from './ui/Chip';
import { VariantToggle } from './ui/VariantToggle';
import { RepoRowDense } from './repo-views/RepoRowDense';
import { RepoRowComfy } from './repo-views/RepoRowComfy';
import { RepoCardMasonry } from './repo-views/RepoCardMasonry';
import { trendingRepoToRepo } from '../lib/adapters';
import { getLibraryRowHeight, ViewVariant } from '../lib/visuals';

function formatStarCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export interface TrendingRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stars_today: number | null;
  total_stars: number | null;
  url: string;
}

type TimeRange = 'daily' | 'weekly' | 'monthly';

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  daily: 'Today',
  weekly: 'This Week',
  monthly: 'This Month',
};

const POPULAR_LANGUAGES = [
  'All',
  'TypeScript',
  'JavaScript',
  'Python',
  'Rust',
  'Go',
  'Java',
  'C++',
  'C',
  'Swift',
  'Kotlin',
  'Ruby',
  'PHP',
];

interface Props {
  onBack: () => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'warn') => void;
  onRepoAdded: (repo: Repo) => void;
  viewVariant: ViewVariant;
  onVariantChange: (v: ViewVariant) => void;
  onSelectionChange?: (repo: Repo | null, fromClick: boolean) => void;
}

export function TrendingView({ onBack, showToast, onRepoAdded, viewVariant, onVariantChange, onSelectionChange }: Props) {
  const [repos, setRepos] = useState<TrendingRepo[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('daily');
  const [language, setLanguage] = useState<string>('All');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const masonryScrollRef = useRef<HTMLDivElement>(null);
  const gPressedRef = useRef(false);

  const reposRef = useRef(repos);
  reposRef.current = repos;
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;
  const variantRef = useRef(viewVariant);
  variantRef.current = viewVariant;

  const rowVirtualizer = useVirtualizer({
    count: viewVariant === 'masonry' ? 0 : repos.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) =>
      getLibraryRowHeight(
        trendingRepoToRepo(reposRef.current[i]),
        i === selectedIdxRef.current,
        variantRef.current,
      ),
    getItemKey: (i) => reposRef.current[i]?.full_name ?? i,
    overscan: 10,
  });

  async function loadTrending() {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<TrendingRepo[]>('fetch_trending', {
        timeRange,
        language: language === 'All' ? null : language,
      });
      setRepos(data);
      setSelectedIdx(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrending();
  }, [timeRange, language]);

  useEffect(() => {
    if (viewVariant === 'masonry') return;
    rowVirtualizer.measure();
    if (repos.length > 0) {
      rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
    }
  }, [selectedIdx, viewVariant]);

  useEffect(() => {
    if (viewVariant !== 'masonry') return;
    const root = masonryScrollRef.current;
    if (!root) return;
    const card = root.querySelector<HTMLElement>(`[data-masonry-idx="${selectedIdx}"]`);
    card?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, viewVariant, repos.length]);

  // Mirror the focused trending row to App's detail sidebar. Keyboard nav
  // doesn't auto-open; row clicks do (fromClick=true at the call site).
  useEffect(() => {
    if (!onSelectionChange) return;
    const trending = repos[selectedIdx] ?? null;
    onSelectionChange(trending ? trendingRepoToRepo(trending) : null, false);
  }, [selectedIdx, repos, onSelectionChange]);

  async function handleAdd(repo: TrendingRepo) {
    if (adding.has(repo.full_name)) return;
    setAdding((s) => new Set(s).add(repo.full_name));
    try {
      const added = await invoke<Repo>('add_repo', { input: repo.full_name });
      onRepoAdded(added);
      showToast(`Added ${repo.full_name} to library`);
    } catch (e) {
      showToast(`Failed to add: ${e}`, 'error');
    } finally {
      setAdding((s) => {
        const next = new Set(s);
        next.delete(repo.full_name);
        return next;
      });
    }
  }

  const selectedRepo = repos[selectedIdx] ?? null;

  useKeydown(
    useCallback(
      (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

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
            setSelectedIdx(Math.max(0, repos.length - 1));
            break;
          case 'o':
            if (selectedRepo) openUrl(selectedRepo.url);
            break;
          case 'a':
            if (selectedRepo && !adding.has(selectedRepo.full_name)) handleAdd(selectedRepo);
            break;
          case 'h':
          case 'Escape':
            onBack();
            break;
        }
      },
      [repos, selectedIdx, selectedRepo, adding]
    ),
    [repos, selectedIdx, selectedRepo, adding]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2 border-b border-border gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Trending</span>
          <span className="text-[10px] font-mono text-accent border border-accent/40 px-1 py-0.5 rounded-[2px] leading-none">
            GITHUB
          </span>
          <p className="text-xs text-muted ml-2">popular repos right now</p>
        </div>
        <VariantToggle value={viewVariant} onChange={onVariantChange} />
      </div>

      {/* Filter bar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2 border-b border-border">
        <div className="flex items-center gap-1">
          {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                timeRange === range
                  ? 'bg-brand text-white'
                  : 'text-muted hover:text-ink hover:bg-surface border border-border'
              }`}
            >
              {TIME_RANGE_LABELS[range]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-muted">Language:</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="text-xs bg-surface border border-border text-ink rounded px-2 py-1 focus:outline-none focus:border-brand cursor-pointer"
          >
            {POPULAR_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {(() => {
        if (loading) {
          return (
            <div className="flex-1 overflow-y-auto flex items-center justify-center">
              <span className="text-sm text-muted">Loading trending repos…</span>
            </div>
          );
        }
        if (error) {
          return (
            <div className="flex-1 overflow-y-auto flex items-center justify-center">
              <span className="text-sm text-danger">{error}</span>
            </div>
          );
        }
        if (repos.length === 0) {
          return (
            <div className="flex-1 overflow-y-auto flex items-center justify-center">
              <span className="text-sm text-muted">No trending repos found.</span>
            </div>
          );
        }

        const buildRightExtra = (tRepo: TrendingRepo, isAdding: boolean) => {
          const trendText = tRepo.stars_today != null
            ? `+${tRepo.stars_today.toLocaleString()} today`
            : tRepo.total_stars != null
              ? `★ ${formatStarCount(tRepo.total_stars)}`
              : '—';
          const trendClass = tRepo.stars_today != null ? 'text-warn' : 'text-faint';

          if (viewVariant === 'comfy') {
            return (
              <>
                {isAdding && <Chip tone="accent">adding…</Chip>}
                <span className={`text-xs font-mono ${trendClass}`}>{trendText}</span>
                {tRepo.stars_today != null && tRepo.total_stars != null && (
                  <span className="text-[10.5px] font-mono text-faint">
                    ★ {formatStarCount(tRepo.total_stars)}
                  </span>
                )}
              </>
            );
          }

          return (
            <div className="flex items-center gap-2 text-xs">
              {isAdding && <span className="text-accent">adding…</span>}
              <span className={`font-mono whitespace-nowrap ${trendClass}`}>{trendText}</span>
            </div>
          );
        };

        if (viewVariant === 'masonry') {
          return (
            <div ref={masonryScrollRef} role="list" className="flex-1 overflow-y-auto px-3.5 pt-3.5 pb-1">
              <div className="eunha-masonry-grid">
                {repos.map((tRepo, i) => {
                  const isSelected = i === selectedIdx;
                  const isAdding = adding.has(tRepo.full_name);
                  const repo = trendingRepoToRepo(tRepo);
                  return (
                    <div
                      key={tRepo.full_name}
                      role="listitem"
                      style={{ opacity: isAdding ? 0.6 : 1 }}
                    >
                      <RepoCardMasonry
                        repo={repo}
                        index={i}
                        isSelected={isSelected}
                        currentPromptVersion={0}
                        onClick={() => {
                          setSelectedIdx(i);
                          onSelectionChange?.(repo, true);
                        }}
                        rightExtra={buildRightExtra(tRepo, isAdding)}
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
              {rowVirtualizer.getVirtualItems().map((vItem) => {
                const tRepo = repos[vItem.index];
                const isSelected = vItem.index === selectedIdx;
                const isAdding = adding.has(tRepo.full_name);
                const repo = trendingRepoToRepo(tRepo);
                const rightExtra = buildRightExtra(tRepo, isAdding);
                const RowComponent = viewVariant === 'dense' ? RepoRowDense : RepoRowComfy;

                return (
                  <div
                    key={tRepo.full_name}
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

      {/* Status bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-border text-xs text-muted">
        <span>{loading ? 'Loading…' : `${repos.length} repos`}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><Kbd>a</Kbd>{' '}add to library</span>
          <span className="flex items-center gap-1"><Kbd>o</Kbd>{' '}open</span>
          <span className="flex items-center gap-1"><Kbd>h</Kbd>{' '}back</span>
        </span>
      </div>
    </div>
  );
}
