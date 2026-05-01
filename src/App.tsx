import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Repo, CategoryCount, AppConstants, BatchDescribeProgress, BatchDescribeResult } from './types';
import { useKeydown } from './hooks/useKeydown';
import { RepoRow } from './components/RepoRow';
import { SearchBar } from './components/SearchBar';
import { DetailPanel } from './components/DetailPanel';
import { EditPanel } from './components/EditPanel';
import { SettingsModal } from './components/SettingsModal';
import { ImportModal } from './components/ImportModal';
import { AddRepoModal } from './components/AddRepoModal';
import { KeybindingHelp } from './components/KeybindingHelp';
import { ToastBanner } from './components/ToastBanner';
import { BatchProgress } from './components/BatchProgress';
import { FeedView } from './components/FeedView';
import { WatchingView } from './components/WatchingView';
import { GraphView } from './components/GraphView';
import { TrendingView } from './components/TrendingView';
import { ReadmeView, ReadmeTab } from './components/ReadmeView';
import { CategorySidebar } from './components/CategorySidebar';
import { Button } from './components/ui/Button';
import { Kbd } from './components/ui/Kbd';
import { getRowHeight } from './lib/visuals';
import eunhaLogo from './assets/eunha-orb.png';

type Modal = 'settings' | 'import' | 'add' | 'help' | null;
type ViewMode = 'library' | 'feed' | 'watching' | 'graph' | 'trending' | 'readme';

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [constants, setConstants] = useState<AppConstants>({ current_prompt_version: 1 });

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<'undescribed' | 'stale' | 'described' | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('library');

  const [describing, setDescribing] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [readmeTabs, setReadmeTabs] = useState<ReadmeTab[]>([]);
  const [activeReadmeTabId, setActiveReadmeTabId] = useState<string | null>(null);

  // Split view: when non-null, a second pane is shown to the right.
  // Left pane state is `viewMode` + `activeReadmeTabId`. Right pane state is `splitPane`.
  const [splitPane, setSplitPane] = useState<{ view: ViewMode; activeReadmeTabId: string | null } | null>(null);
  const [focusedSide, setFocusedSide] = useState<'left' | 'right'>('left');
  const [splitRatio, setSplitRatio] = useState(0.5);
  const readmeLeftScrollRef = useRef<HTMLDivElement | null>(null);
  const readmeRightScrollRef = useRef<HTMLDivElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  function handleGutterMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - rect.left;
      const ratio = Math.max(0.15, Math.min(0.85, x / rect.width));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const [batchProgress, setBatchProgress] = useState<BatchDescribeProgress | null>(null);
  const batchRunning = batchProgress !== null;

  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadFeedCount, setUnreadFeedCount] = useState(0);

  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' | 'warn' } | null>(null);
  const [keychainError, setKeychainError] = useState<string | null>(null);
  const [patMissing, setPatMissing] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('eunha-theme') as 'dark' | 'light' | null;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('eunha-theme', theme);
  }, [theme]);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const gPressedRef = useRef(false);
  const reposRef = useRef(repos);
  reposRef.current = repos;
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;

  const rowVirtualizer = useVirtualizer({
    count: repos.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => getRowHeight(reposRef.current[i], i === selectedIdxRef.current),
    getItemKey: (i) => reposRef.current[i]?.id ?? i,
    overscan: 10,
  });

  function showToast(msg: string, type: 'info' | 'error' | 'warn' = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadRepos() {
    try {
      const data = await invoke<Repo[]>('list_repos', {
        query: query || null,
        category: selectedCategory,
        aiStatus,
      });
      setRepos(data);
      setSelectedIdx((i) => Math.min(i, Math.max(data.length - 1, 0)));
    } catch (e) {
      console.error(e);
    }
  }

  async function loadCategories() {
    try {
      const cats = await invoke<CategoryCount[]>('get_categories');
      setCategories(cats);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadUnreadCount() {
    try {
      const count = await invoke<number>('get_unread_release_count');
      setUnreadCount(count);
    } catch {
      // non-critical
    }
  }

  async function loadFeedUnreadCount() {
    try {
      const count = await invoke<number>('get_feed_unread_count');
      setUnreadFeedCount(count);
    } catch {
      // non-critical
    }
  }

  useEffect(() => {
    invoke<AppConstants>('get_app_constants').then(setConstants);

    invoke<{ pat_set: boolean; pat_masked: string; provider: string; api_key_set: boolean; api_key_masked: string; ollama_url: string }>('get_settings')
      .then((s) => {
        if (!s.pat_set) setPatMissing(true);
      })
      .catch((e) => {
        setKeychainError(`Could not read credentials from keychain — open Settings to re-enter. (${e})`);
      });

    loadRepos();
    loadCategories();
    loadUnreadCount();
    loadFeedUnreadCount();
    invoke('backfill_owner_avatars').then(() => loadRepos()).catch(() => {});

    invoke<{ checked: number; new_releases: number; failed_repos: string[] }>('sync_releases')
      .then((r) => {
        if (r.new_releases > 0) {
          showToast(`Synced ${r.new_releases} new release${r.new_releases !== 1 ? 's' : ''}`);
          loadUnreadCount();
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRepos();
  }, [query, selectedCategory, aiStatus]);

  useEffect(() => {
    loadFeedUnreadCount();
  }, [viewMode]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<BatchDescribeProgress>('batch-describe:progress', (e) => {
      setBatchProgress(e.payload);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    rowVirtualizer.measure();
    rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
  }, [selectedIdx]);

  const showCategories = (viewMode === 'library' || viewMode === 'watching') && categories.length > 0;

  const selectedRepo = repos[selectedIdx] ?? null;
  const isDescribing = selectedRepo ? describing.has(selectedRepo.id) : false;
  const isEditing = selectedRepo ? editingId === selectedRepo.id : false;

  async function describeRepo(repo: Repo) {
    if (describing.has(repo.id)) return;
    setDescribing((s) => new Set(s).add(repo.id));
    try {
      const updated = await invoke<Repo>('describe_repo', { repoId: repo.id });
      setRepos((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      loadCategories();
    } catch (e) {
      showToast(`Describe failed — ${e}`, 'error');
    } finally {
      setDescribing((s) => {
        const next = new Set(s);
        next.delete(repo.id);
        return next;
      });
    }
  }

  async function runBatchDescribe() {
    if (batchRunning) return;
    setBatchProgress({ current: 0, total: 0, repo_id: '', failed: 0 });
    try {
      const result = await invoke<BatchDescribeResult>('batch_describe');
      showToast(
        `Described ${result.described}/${result.total} repos${result.failed > 0 ? ` (${result.failed} failed)` : ''}`,
        result.failed > 0 ? 'warn' : 'info'
      );
      await loadRepos();
      await loadCategories();
    } catch (e) {
      showToast(`Batch describe failed: ${e}`, 'error');
    } finally {
      setBatchProgress(null);
    }
  }

  async function toggleWatching(repo: Repo) {
    try {
      const updated = await invoke<Repo>('toggle_watching', { repoId: repo.id });
      setRepos((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      showToast(updated.watching ? `Watching ${repo.full_name}` : `Unwatched ${repo.full_name}`);
    } catch (e) {
      showToast(`Failed: ${e}`, 'error');
    }
  }

  function closeReadmeTab(tabId: string) {
    const idx = readmeTabs.findIndex((t) => t.repoId === tabId);
    if (idx < 0) return;
    const remaining = readmeTabs.filter((t) => t.repoId !== tabId);
    setReadmeTabs(remaining);

    // Drop the tab from any pane that was showing it.
    const fallbackTabId = remaining.length === 0
      ? null
      : remaining[Math.min(idx, remaining.length - 1)].repoId;

    if (activeReadmeTabId === tabId) {
      setActiveReadmeTabId(fallbackTabId);
      if (fallbackTabId === null && viewMode === 'readme') setViewMode('library');
    }
    if (splitPane && splitPane.activeReadmeTabId === tabId) {
      const newSplit = { ...splitPane, activeReadmeTabId: fallbackTabId };
      if (fallbackTabId === null && splitPane.view === 'readme') newSplit.view = 'library';
      setSplitPane(newSplit);
    }
  }

  // Focus-aware accessors: act on whichever pane has keyboard focus.
  const focusedView: ViewMode = focusedSide === 'right' && splitPane ? splitPane.view : viewMode;
  const focusedActiveReadmeTabId = focusedSide === 'right' && splitPane ? splitPane.activeReadmeTabId : activeReadmeTabId;

  function setFocusedView(v: ViewMode) {
    // Library only renders fully on the left pane. Choosing it from the right hops focus.
    if (v === 'library' && focusedSide === 'right') {
      setFocusedSide('left');
      setViewMode('library');
      return;
    }
    if (focusedSide === 'right' && splitPane) {
      setSplitPane({ ...splitPane, view: v });
    } else {
      setViewMode(v);
    }
  }

  function setFocusedActiveReadmeTabId(id: string | null) {
    if (focusedSide === 'right' && splitPane) {
      setSplitPane({ ...splitPane, activeReadmeTabId: id });
    } else {
      setActiveReadmeTabId(id);
    }
  }

  function toggleSplit() {
    if (splitPane) {
      setSplitPane(null);
      setFocusedSide('left');
    } else {
      // Library is left-only; pick a sensible right-pane default if left is showing library.
      const initialView: ViewMode = viewMode === 'library'
        ? (readmeTabs.length > 0 ? 'readme' : 'graph')
        : viewMode;
      const initialTab = initialView === 'readme'
        ? (activeReadmeTabId ?? readmeTabs[0]?.repoId ?? null)
        : null;
      setSplitPane({ view: initialView, activeReadmeTabId: initialTab });
      setFocusedSide('right');
    }
  }

  function scrollFocusedReadme(deltaY: number) {
    const ref = focusedSide === 'right' ? readmeRightScrollRef : readmeLeftScrollRef;
    ref.current?.scrollBy({ top: deltaY, behavior: 'auto' });
  }

  function scrollFocusedReadmeTo(top: number) {
    const ref = focusedSide === 'right' ? readmeRightScrollRef : readmeLeftScrollRef;
    ref.current?.scrollTo({ top, behavior: 'auto' });
  }

  useKeydown(
    useCallback(
      (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

        if (e.key === '/' && !isInput && modal === null) {
          e.preventDefault();
          searchRef.current?.focus();
          return;
        }

        if (target === searchRef.current) {
          if (e.key === 'Escape') {
            setQuery('');
            searchRef.current?.blur();
          }
          return;
        }

        if (modal !== null || isInput) return;

        // Toggle split pane (\). Closes the right pane if open, opens it cloning left's view if not.
        if (e.key === '\\' && !editingId) {
          e.preventDefault();
          toggleSplit();
          return;
        }

        // h/l: when split is active, switch focus between panes; otherwise cycle viewMode.
        if (e.key === 'h' && !editingId) {
          e.preventDefault();
          if (splitPane) {
            setFocusedSide('left');
          } else {
            const cycle: ViewMode[] = ['library', 'watching', 'feed', 'graph', 'trending'];
            if (readmeTabs.length > 0) cycle.push('readme');
            const idx = cycle.indexOf(viewMode);
            if (idx > 0) setViewMode(cycle[idx - 1]);
          }
          return;
        }
        if (e.key === 'l' && !editingId) {
          e.preventDefault();
          if (splitPane) {
            setFocusedSide('right');
          } else {
            const cycle: ViewMode[] = ['library', 'watching', 'feed', 'graph', 'trending'];
            if (readmeTabs.length > 0) cycle.push('readme');
            const idx = cycle.indexOf(viewMode);
            if (idx >= 0 && idx < cycle.length - 1) setViewMode(cycle[idx + 1]);
          }
          return;
        }

        if (focusedView === 'readme') {
          if (e.key === 'Escape') { e.preventDefault(); setFocusedView('library'); return; }
          if (e.key === 'x') {
            e.preventDefault();
            if (focusedActiveReadmeTabId) closeReadmeTab(focusedActiveReadmeTabId);
            return;
          }
          if (e.key === ']' && readmeTabs.length > 1) {
            e.preventDefault();
            const idx = readmeTabs.findIndex((t) => t.repoId === focusedActiveReadmeTabId);
            const next = readmeTabs[(idx + 1) % readmeTabs.length];
            setFocusedActiveReadmeTabId(next.repoId);
            return;
          }
          if (e.key === '[' && readmeTabs.length > 1) {
            e.preventDefault();
            const idx = readmeTabs.findIndex((t) => t.repoId === focusedActiveReadmeTabId);
            const next = readmeTabs[(idx - 1 + readmeTabs.length) % readmeTabs.length];
            setFocusedActiveReadmeTabId(next.repoId);
            return;
          }
          if (e.key === 'o') {
            e.preventDefault();
            const tab = readmeTabs.find((t) => t.repoId === focusedActiveReadmeTabId);
            if (tab) openUrl(tab.repoUrl);
            return;
          }
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const idx = parseInt(e.key, 10) - 1;
            if (idx < readmeTabs.length) setFocusedActiveReadmeTabId(readmeTabs[idx].repoId);
            return;
          }
          // Vim-style content scrolling within the focused README pane.
          if (e.key === 'j') { e.preventDefault(); scrollFocusedReadme(60); return; }
          if (e.key === 'k') { e.preventDefault(); scrollFocusedReadme(-60); return; }
          if (e.ctrlKey && e.key === 'd') { e.preventDefault(); scrollFocusedReadme(window.innerHeight / 2); return; }
          if (e.ctrlKey && e.key === 'u') { e.preventDefault(); scrollFocusedReadme(-window.innerHeight / 2); return; }
          if (e.key === 'G') { e.preventDefault(); scrollFocusedReadmeTo(Number.MAX_SAFE_INTEGER); return; }
          if (e.key === 'g') {
            if (gPressedRef.current) {
              scrollFocusedReadmeTo(0);
              gPressedRef.current = false;
            } else {
              gPressedRef.current = true;
              setTimeout(() => { gPressedRef.current = false; }, 500);
            }
            return;
          }
          return;
        }

        if (focusedView === 'feed' || focusedView === 'watching' || focusedView === 'graph' || focusedView === 'trending') return;

        const repo = repos[selectedIdx];

        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            e.preventDefault();
            setSelectedIdx((i) => Math.min(i + 1, repos.length - 1));
            setEditingId(null);
            break;
          case 'k':
          case 'ArrowUp':
            e.preventDefault();
            setSelectedIdx((i) => Math.max(i - 1, 0));
            setEditingId(null);
            break;
          case 'd':
            if (e.ctrlKey) {
              e.preventDefault();
              setSelectedIdx((i) => Math.min(i + 10, repos.length - 1));
              break;
            }
            if (!repo || editingId) break;
            if (e.shiftKey) {
              describeRepo(repo);
            } else {
              if (repo.llm_summary) {
                showToast('Already described — press shift-D to regenerate');
              } else {
                describeRepo(repo);
              }
            }
            break;
          case 'u':
            if (e.ctrlKey) {
              e.preventDefault();
              setSelectedIdx((i) => Math.max(i - 10, 0));
            }
            break;
          case 'g':
            if (!editingId) {
              if (gPressedRef.current) {
                setSelectedIdx(0);
                gPressedRef.current = false;
              } else {
                gPressedRef.current = true;
                setTimeout(() => { gPressedRef.current = false; }, 500);
              }
            }
            break;
          case 'G':
            if (!editingId) setSelectedIdx(Math.max(0, repos.length - 1));
            break;
          case 'D':
            if (!repo || editingId) break;
            describeRepo(repo);
            break;
          case 'A':
            if (!editingId) runBatchDescribe();
            break;
          case 'o':
            if (repo && !editingId) openUrl(repo.url);
            break;
          case 'e':
            if (repo && !editingId) setEditingId(repo.id);
            break;
          case 'f':
            setFocusedView('feed');
            break;
          case 'w':
            if (repo && !editingId) toggleWatching(repo);
            break;
          case 'W':
            setFocusedView('watching');
            break;
          case 't':
            setFocusedView('trending');
            break;
          case 'r':
            e.preventDefault();
            if (repo && !editingId) {
              setReadmeTabs((tabs) =>
                tabs.some((t) => t.repoId === repo.id)
                  ? tabs
                  : [...tabs, { repoId: repo.id, repoFullName: repo.full_name, repoUrl: repo.url }]
              );
              setFocusedActiveReadmeTabId(repo.id);
              setFocusedView('readme');
            }
            break;
          case ',':
            setModal('settings');
            break;
          case '?':
            setModal('help');
            break;
          case 'Escape':
            if (editingId) setEditingId(null);
            break;
        }
      },
      [repos, selectedIdx, modal, editingId, describing, batchRunning, viewMode, readmeTabs, activeReadmeTabId, splitPane, focusedSide]
    ),
    [repos, selectedIdx, modal, editingId, describing, batchRunning, viewMode, readmeTabs, activeReadmeTabId, splitPane, focusedSide]
  );

  async function handleEditSave(notes: string | null, category: string | null, locked: boolean) {
    if (!selectedRepo) return;
    try {
      await invoke<Repo>('update_repo_user_fields', {
        repoId: selectedRepo.id,
        userNotes: notes,
        userCategory: category,
      });
      const updated = await invoke<Repo>('set_category_lock', {
        repoId: selectedRepo.id,
        locked,
      });
      setRepos((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      loadCategories();
    } catch (e) {
      showToast(`Save failed: ${e}`, 'error');
    }
    setEditingId(null);
  }

  function handleImportDone() {
    loadRepos();
    loadCategories();
  }

  const handleDragRegionMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, a, [data-no-drag]')) return;
    if (e.detail === 2) {
      getCurrentWindow().toggleMaximize();
    } else {
      getCurrentWindow().startDragging();
    }
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      {/* Traffic-light spacer for macOS overlay titlebar */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragRegionMouseDown}
        className="flex-shrink-0 h-8"
      />

      {keychainError && <ToastBanner message={keychainError} type="warn" />}
      {toast && <ToastBanner message={toast.msg} type={toast.type} />}
      {batchProgress && batchProgress.total > 0 && (
        <BatchProgress progress={batchProgress} />
      )}

      {/* Header toolbar */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragRegionMouseDown}
        className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-border"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 select-none pointer-events-none">
          <img src={eunhaLogo} alt="eunha" className="w-5 h-5" />
          <span className="text-sm font-semibold text-accent tracking-wide">eunha</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setModal('add')} className="text-xs px-2 py-1">
            + Add repo
          </Button>
          <Button
            onClick={() => {
              if (patMissing) {
                showToast('Set your GitHub PAT in Settings first', 'warn');
                setModal('settings');
              } else {
                setModal('import');
              }
            }}
            className="text-xs px-2 py-1"
          >
            Import stars
          </Button>
          <Button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="text-xs px-2 py-1"
            title="Toggle light/dark theme"
          >
            {theme === 'dark' ? '☀' : '◑'}
          </Button>
          <Button
            onClick={() => setModal('settings')}
            className="text-xs px-2 py-1"
            title="Settings (,)"
          >
            ⚙
          </Button>
        </div>
      </div>

      {/* First-launch interstitial */}
      {patMissing && repos.length === 0 && (
        <div className="flex-shrink-0 border-b border-border bg-panel px-5 py-5 text-center">
          <p className="text-sm text-ink mb-3">
            Welcome to eunha. Set up your GitHub token to import stars.
          </p>
          <div className="flex justify-center gap-3">
            <Button
              variant="primary"
              onClick={() => setModal('settings')}
              className="text-sm px-4 py-1.5"
            >
              Open Settings
            </Button>
            <Button
              onClick={() => setModal('add')}
              className="text-sm px-4 py-1.5"
            >
              Add a repo manually
            </Button>
          </div>
        </div>
      )}

      <main className="flex flex-row flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="flex-shrink-0 w-40 border-r border-border bg-panel flex flex-col pt-2 pb-4">
          {(
            [
              {
                key: 'library' as ViewMode,
                label: 'Library',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                  </svg>
                ),
              },
              {
                key: 'watching' as ViewMode,
                label: 'Watching',
                badge: unreadCount > 0 ? unreadCount : undefined,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                ),
              },
              {
                key: 'feed' as ViewMode,
                label: 'Feed',
                badge: unreadFeedCount > 0 ? unreadFeedCount : undefined,
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                ),
              },
              {
                key: 'graph' as ViewMode,
                label: 'Graph',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                ),
              },
              {
                key: 'trending' as ViewMode,
                label: 'Trending',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
                  </svg>
                ),
              },
            ] as { key: ViewMode; label: string; icon: React.ReactNode; badge?: number }[]
          ).map(({ key, label, icon, badge }) => (
            <button
              key={key}
              onClick={() => setFocusedView(key)}
              className={`flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded text-sm font-medium transition-colors select-none ${
                focusedView === key
                  ? 'bg-elevated text-accent'
                  : 'text-muted hover:text-dim hover:bg-elevated/50'
              }`}
            >
              {icon}
              <span className="flex-1 text-left">{label}</span>
              {badge !== undefined && (
                <span className="bg-accent text-[10px] font-semibold text-bg rounded-full px-1 min-w-[16px] text-center leading-4">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          ))}

          {readmeTabs.length > 0 && (
            <button
              onClick={() => setFocusedView('readme')}
              className={`flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded text-sm font-medium transition-colors select-none ${
                focusedView === 'readme'
                  ? 'bg-elevated text-accent'
                  : 'text-muted hover:text-dim hover:bg-elevated/50'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              <span className="flex-1 text-left">README</span>
              <span className="bg-accent text-[10px] font-semibold text-bg rounded-full px-1 min-w-[16px] text-center leading-4">
                {readmeTabs.length}
              </span>
            </button>
          )}

          {showCategories && (
            <>
              <div className="mx-3 my-2 border-t border-border" />
              <CategorySidebar
                categories={categories}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
              />
            </>
          )}
        </aside>

        {/* Main content */}
        <div className="flex flex-col flex-1 overflow-hidden">
      {/* Global README tab strip — visible across all views */}
      {readmeTabs.length > 0 && (
        <div className="flex-shrink-0 flex items-stretch border-b border-border bg-panel overflow-x-auto">
          {readmeTabs.map((tab) => {
            const isActive =
              (viewMode === 'readme' && tab.repoId === activeReadmeTabId) ||
              (splitPane?.view === 'readme' && tab.repoId === splitPane.activeReadmeTabId);
            return (
              <div
                key={tab.repoId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setFocusedActiveReadmeTabId(tab.repoId);
                  setFocusedView('readme');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setFocusedActiveReadmeTabId(tab.repoId);
                    setFocusedView('readme');
                  }
                }}
                className={`flex items-center gap-2 pl-3 pr-2 py-2 border-r border-border cursor-pointer min-w-0 select-none ${
                  isActive
                    ? 'bg-bg text-ink'
                    : 'text-muted hover:text-dim hover:bg-elevated/50'
                }`}
              >
                <span className="text-xs font-medium truncate max-w-[220px]">{tab.repoFullName}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeReadmeTab(tab.repoId); }}
                  className="text-faint hover:text-ink shrink-0 leading-none w-4 h-4 flex items-center justify-center rounded hover:bg-elevated"
                  aria-label={`Close ${tab.repoFullName}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div ref={splitContainerRef} className="flex flex-row flex-1 overflow-hidden">
        {/* LEFT PANE */}
        <div
          style={splitPane ? { width: `${splitRatio * 100}%` } : undefined}
          onClick={splitPane ? () => setFocusedSide('left') : undefined}
          className={`flex flex-col overflow-hidden ${splitPane ? '' : 'flex-1'} ${
            splitPane && focusedSide === 'left' ? 'ring-1 ring-accent ring-inset' : ''
          }`}
        >
          {/* GraphView is always mounted to preserve d3 simulation + avatar cache */}
          <div className={viewMode === 'graph' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <GraphView showToast={showToast} theme={theme} />
          </div>
          {/* ReadmeView is always mounted so its per-tab content cache persists across view switches */}
          <div className={viewMode === 'readme' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <ReadmeView tabs={readmeTabs} activeTabId={activeReadmeTabId} scrollContainerRef={readmeLeftScrollRef} />
          </div>
          {viewMode === 'feed' ? (
            <FeedView
              onBack={() => setViewMode('library')}
              onRepoAdded={(repo) => {
                setRepos((rs) => {
                  if (rs.some((r) => r.id === repo.id)) return rs;
                  return [repo, ...rs];
                });
                loadCategories();
              }}
              showToast={showToast}
              onDescribeRepo={(repo) => {
                setViewMode('library');
                describeRepo(repo);
              }}
            />
          ) : viewMode === 'graph' ? null : viewMode === 'readme' ? null : viewMode === 'watching' ? (
            <WatchingView
              onBack={() => setViewMode('library')}
              showToast={showToast}
              onRepoUpdated={(repo) => setRepos((rs) => rs.map((r) => (r.id === repo.id ? repo : r)))}
              onUnreadCountChanged={loadUnreadCount}
            />
          ) : viewMode === 'trending' ? (
            <TrendingView
              onBack={() => setViewMode('library')}
              showToast={showToast}
              onRepoAdded={(repo) => {
                setRepos((rs) => {
                  if (rs.some((r) => r.id === repo.id)) return rs;
                  return [repo, ...rs];
                });
                loadCategories();
              }}
            />
          ) : (
            <>
              <SearchBar
                query={query}
                onQueryChange={setQuery}
                searchRef={searchRef}
                aiStatus={aiStatus}
                onAiStatusChange={setAiStatus}
              />

              <div ref={listRef} className="flex-1 overflow-y-auto">
                {repos.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted">
                    {query ? 'No repos match your search.' : 'Your library is empty.'}
                  </div>
                ) : (
                  <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                    {rowVirtualizer.getVirtualItems().map((vItem) => {
                      const repo = repos[vItem.index];
                      return (
                        <div
                          key={repo.id}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${vItem.start}px)`,
                          }}
                        >
                          <RepoRow
                            repo={repo}
                            isSelected={vItem.index === selectedIdx}
                            currentPromptVersion={constants.current_prompt_version}
                            onClick={() => {
                              setSelectedIdx(vItem.index);
                              setEditingId(null);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {selectedRepo && (
                isEditing ? (
                  <EditPanel
                    repo={selectedRepo}
                    onSave={handleEditSave}
                    onDiscard={() => setEditingId(null)}
                  />
                ) : (
                  <DetailPanel
                    repo={selectedRepo}
                    isDescribing={isDescribing}
                    currentPromptVersion={constants.current_prompt_version}
                  />
                )
              )}

              {/* Status bar */}
              <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-border text-xs text-muted">
                <span>{repos.length} repos</span>
                <span className="flex items-center gap-1">
                  <Kbd>w</Kbd>{' '}watch ·{' '}
                  <Kbd>?</Kbd>{' '}help
                </span>
              </div>
            </>
          )}
        </div>

        {/* RESIZE GUTTER + RIGHT PANE */}
        {splitPane && (
          <>
            <div
              onMouseDown={handleGutterMouseDown}
              className="w-1 bg-border hover:bg-accent cursor-col-resize flex-shrink-0"
            />
            <div
              onClick={() => setFocusedSide('right')}
              className={`flex flex-col overflow-hidden flex-1 min-w-0 ${
                focusedSide === 'right' ? 'ring-1 ring-accent ring-inset' : ''
              }`}
            >
              {splitPane.view === 'graph' ? (
                <GraphView showToast={showToast} theme={theme} />
              ) : splitPane.view === 'readme' ? (
                <ReadmeView
                  tabs={readmeTabs}
                  activeTabId={splitPane.activeReadmeTabId}
                  scrollContainerRef={readmeRightScrollRef}
                />
              ) : splitPane.view === 'feed' ? (
                <FeedView
                  onBack={() => { setSplitPane(null); setFocusedSide('left'); }}
                  onRepoAdded={(repo) => {
                    setRepos((rs) => {
                      if (rs.some((r) => r.id === repo.id)) return rs;
                      return [repo, ...rs];
                    });
                    loadCategories();
                  }}
                  showToast={showToast}
                  onDescribeRepo={(repo) => {
                    setSplitPane(null);
                    setFocusedSide('left');
                    setViewMode('library');
                    describeRepo(repo);
                  }}
                />
              ) : splitPane.view === 'watching' ? (
                <WatchingView
                  onBack={() => { setSplitPane(null); setFocusedSide('left'); }}
                  showToast={showToast}
                  onRepoUpdated={(repo) => setRepos((rs) => rs.map((r) => (r.id === repo.id ? repo : r)))}
                  onUnreadCountChanged={loadUnreadCount}
                />
              ) : splitPane.view === 'trending' ? (
                <TrendingView
                  onBack={() => { setSplitPane(null); setFocusedSide('left'); }}
                  showToast={showToast}
                  onRepoAdded={(repo) => {
                    setRepos((rs) => {
                      if (rs.some((r) => r.id === repo.id)) return rs;
                      return [repo, ...rs];
                    });
                    loadCategories();
                  }}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted px-6 text-center">
                  Library is shown on the left pane. Press <span className="font-mono text-accent mx-1">h</span> to focus it, or <span className="font-mono text-accent mx-1">\</span> to close split.
                </div>
              )}
            </div>
          </>
        )}
      </div>
        </div>
      </main>

      {modal === 'settings' && (
        <SettingsModal onClose={() => {
          setModal(null);
          invoke<{ pat_set: boolean }>('get_settings')
            .then((s) => setPatMissing(!s.pat_set))
            .catch(() => {});
        }} />
      )}
      {modal === 'import' && (
        <ImportModal
          onClose={() => setModal(null)}
          onDone={handleImportDone}
        />
      )}
      {modal === 'add' && (
        <AddRepoModal
          onClose={() => setModal(null)}
          onAdded={(repo) => {
            setRepos((rs) => [repo, ...rs]);
            setSelectedIdx(0);
            setModal(null);
            loadCategories();
          }}
        />
      )}
      {modal === 'help' && (
        <KeybindingHelp onClose={() => setModal(null)} />
      )}
    </div>
  );
}
