import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useVirtualizer } from '@tanstack/react-virtual';

import { Repo, CategoryCount, AppConstants, BatchDescribeProgress, BatchDescribeResult, DigestBatch, Collection, SyncStarsResult, Purpose, UserTag } from './types';
import { useKeydown } from './hooks/useKeydown';
import { RepoRowDense } from './components/repo-views/RepoRowDense';
import { RepoRowComfy } from './components/repo-views/RepoRowComfy';
import { RepoCardMasonry } from './components/repo-views/RepoCardMasonry';
import { SearchBar } from './components/SearchBar';
import { RepoDetailSidebar } from './components/RepoDetailSidebar';
import { EditPanel } from './components/EditPanel';
import { SettingsView } from './components/SettingsView';
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
import { VariantToggle } from './components/ui/VariantToggle';
import { CollectionsSidebar } from './components/CollectionsSidebar';
import { AddToCollectionMenu } from './components/AddToCollectionMenu';
import { OnboardingFlow, type OnboardingCompleteOpts } from './components/onboarding/OnboardingFlow';
import { DigestCard } from './components/DigestCard';
import { getLibraryRowHeight, ViewVariant } from './lib/visuals';
import eunhaLogo from './assets/eunha-orb.png';

type Modal = 'import' | 'add' | 'help' | null;
type ViewMode = 'library' | 'feed' | 'watching' | 'graph' | 'trending' | 'readme' | 'settings';

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [constants, setConstants] = useState<AppConstants>({ current_prompt_version: 1 });
  const [collections, setCollections] = useState<Collection[]>([]);
  const [userTags, setUserTags] = useState<UserTag[]>([]);
  const [purposes, setPurposes] = useState<Purpose[]>([]);

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedPurpose, setSelectedPurpose] = useState<string | null>(null);
  const [showCollectionMenu, setShowCollectionMenu] = useState(false);
  const [aiStatus, setAiStatus] = useState<'undescribed' | 'stale' | 'described' | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('watching');

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
  const [syncing, setSyncing] = useState(false);

  const [onboardingState, setOnboardingState] = useState<'loading' | 'show' | 'done'>('loading');
  const [pendingAddModal, setPendingAddModal] = useState(false);

  const [digest, setDigest] = useState<DigestBatch | null>(null);
  const digestCheckedRef = useRef(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('eunha-theme') as 'dark' | 'light' | null;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('eunha-theme', theme);
  }, [theme]);

  const [viewVariant, setViewVariant] = useState<ViewVariant>(() => {
    const saved = localStorage.getItem('eunha-view-variant') as ViewVariant | null;
    return saved === 'dense' || saved === 'comfy' || saved === 'masonry' ? saved : 'dense';
  });

  useEffect(() => {
    localStorage.setItem('eunha-view-variant', viewVariant);
  }, [viewVariant]);

  // Right-side repo detail sidebar — `i` toggles, click on a repo auto-opens.
  const [detailOpen, setDetailOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('eunha-detail-open');
    return saved === null ? true : saved === '1';
  });
  useEffect(() => {
    localStorage.setItem('eunha-detail-open', detailOpen ? '1' : '0');
  }, [detailOpen]);

  // Selection emitted by feed/trending/graph views. Library uses repos[selectedIdx] directly.
  const [externalSelectedRepo, setExternalSelectedRepo] = useState<Repo | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
        reposRef.current[i],
        i === selectedIdxRef.current,
        variantRef.current,
      ),
    getItemKey: (i) => reposRef.current[i]?.id ?? i,
    overscan: 10,
  });

  function showToast(msg: string, type: 'info' | 'error' | 'warn' = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function loadRepos() {
    try {
      let data: Repo[];
      if (selectedCollection !== null) {
        data = await invoke<Repo[]>('get_collection_repos', {
          collectionId: selectedCollection,
          query: query || null,
          category: selectedCategory,
        });
      } else {
        data = await invoke<Repo[]>('list_repos', {
          query: query || null,
          category: selectedCategory,
          aiStatus,
        });
      }
      const filtered = data.filter((repo) =>
        (!selectedTag || repo.user_tags?.includes(selectedTag)) &&
        (!selectedPurpose || repo.purposes?.includes(selectedPurpose))
      );
      setRepos(filtered);
      setSelectedIdx((i) => Math.min(i, Math.max(filtered.length - 1, 0)));
    } catch (e) {
      console.error(e);
    }
  }

  async function loadCollections() {
    try {
      const data = await invoke<Collection[]>('list_collections');
      setCollections(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadClassificationOptions() {
    try {
      const [tags, savedPurposes] = await Promise.all([
        invoke<UserTag[]>('list_user_tags'), invoke<Purpose[]>('list_purposes'),
      ]);
      setUserTags(tags); setPurposes(savedPurposes);
    } catch { /* optional library filters */ }
  }

  async function toggleReadLater(repo: Repo) {
    try {
      const all = await invoke<Collection[]>('list_collections');
      const rl = all.find((c) => c.is_read_later);
      if (!rl) return;
      const repoCols = await invoke<Collection[]>('get_repo_collections', { repoId: repo.id });
      const inReadLater = repoCols.some((c) => c.is_read_later);
      if (inReadLater) {
        await invoke('remove_repo_from_collection', { collectionId: rl.id, repoId: repo.id });
        showToast('Removed from Read Later');
      } else {
        await invoke('add_repo_to_collection', { collectionId: rl.id, repoId: repo.id });
        showToast('Added to Read Later');
      }
      loadCollections();
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
    invoke<string | null>('get_onboarded_at')
      .then((value) => {
        setOnboardingState(value ? 'done' : 'show');
      })
      .catch(() => {
        setOnboardingState('show');
      });

    invoke<AppConstants>('get_app_constants').then(setConstants);

    invoke<{ pat_set: boolean; default_home?: 'watching' | 'library' }>('get_settings')
      .then((s) => {
        if (!s.pat_set) setPatMissing(true);
        if (s.default_home === 'library') setViewMode('library');
      })
      .catch((e) => {
        setKeychainError(`Could not read credentials from keychain — open Settings to re-enter. (${e})`);
      });

    loadRepos();
    loadCategories();
    loadCollections();
    loadClassificationOptions();
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
  }, [query, selectedCategory, aiStatus, selectedCollection, selectedTag, selectedPurpose]);

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

  // Scheduler-driven star sync (manual sync handles its own result). Quiet
  // when nothing changed.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<SyncStarsResult>('stars:synced', (e) => {
      const r = e.payload;
      if (r.added > 0 || r.removed > 0) {
        showToast(`Star sync: ${r.added} added, ${r.removed} removed`);
        loadRepos();
        loadCategories();
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen('tray:open-settings', () => {
      setSplitPane(null);
      setFocusedSide('left');
      setViewMode('settings');
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    if (viewVariant === 'masonry') return;
    rowVirtualizer.measure();
    rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
  }, [selectedIdx, viewVariant]);

  // Masonry has no virtualizer; scroll the selected card into view directly.
  const masonryScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (viewVariant !== 'masonry') return;
    const root = masonryScrollRef.current;
    if (!root) return;
    const card = root.querySelector<HTMLElement>(`[data-masonry-idx="${selectedIdx}"]`);
    card?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, viewVariant, repos.length]);

  useEffect(() => {
    if (onboardingState === 'done' && pendingAddModal) {
      setModal('add');
      setPendingAddModal(false);
    }
  }, [onboardingState, pendingAddModal]);

  useEffect(() => {
    if (onboardingState !== 'done' || digestCheckedRef.current) return;
    digestCheckedRef.current = true;
    invoke<DigestBatch | null>('get_launch_digest')
      .then((b) => {
        if (b && b.items.length > 0) setDigest(b);
      })
      .catch(() => {});
  }, [onboardingState]);

  const showCategories = (viewMode === 'library' || viewMode === 'watching') && categories.length > 0;

  const selectedRepo = repos[selectedIdx] ?? null;
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

  function openDigest() {
    invoke<DigestBatch | null>('get_current_digest')
      .then((b) => {
        if (b && b.items.length > 0) setDigest(b);
        else showToast('아직 리서핑할 배치가 없어요');
      })
      .catch(() => {});
  }

  async function describeRepoReturning(repo: Repo): Promise<Repo | null> {
    if (describing.has(repo.id)) return null;
    setDescribing((s) => new Set(s).add(repo.id));
    try {
      const updated = await invoke<Repo>('describe_repo', { repoId: repo.id });
      setRepos((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
      loadCategories();
      return updated;
    } catch (e) {
      showToast(`Describe failed — ${e}`, 'error');
      return null;
    } finally {
      setDescribing((s) => {
        const n = new Set(s);
        n.delete(repo.id);
        return n;
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
      showToast(updated.watching ? `Following ${repo.full_name}` : `Unfollowed ${repo.full_name}`);
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

  // Sidebar reflects the focused view's selection. Library/watching pull from
  // App's selectedRepo; readme pulls the active tab's library row; other views
  // push their selection via setExternalSelectedRepo.
  const sidebarRepo: Repo | null = (() => {
    if (focusedView === 'library' || focusedView === 'watching') return selectedRepo;
    if (focusedView === 'readme' && focusedActiveReadmeTabId) {
      return repos.find((r) => r.id === focusedActiveReadmeTabId) ?? null;
    }
    return externalSelectedRepo;
  })();
  const sidebarIsDescribing = sidebarRepo ? describing.has(sidebarRepo.id) : false;

  function setFocusedView(v: ViewMode) {
    // Settings is a full-page workflow — close any open split pane so it has
    // the whole canvas, regardless of which side currently has focus.
    if (v === 'settings') {
      setSplitPane(null);
      setFocusedSide('left');
      setViewMode('settings');
      return;
    }
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

        if (modal !== null || isInput || digest) return;

        // Esc inside the settings page returns to the library and refreshes
        // patMissing so the import button gating stays accurate.
        if (focusedView === 'settings' && e.key === 'Escape') {
          e.preventDefault();
          setViewMode('library');
          invoke<{ pat_set: boolean }>('get_settings')
            .then((s) => setPatMissing(!s.pat_set))
            .catch(() => {});
          return;
        }

        // Re-open digest (shift-R). Works from any view.
        if (e.key === 'R' && !editingId) {
          e.preventDefault();
          openDigest();
          return;
        }

        // Toggle the right repo-detail sidebar (i). Works from any view.
        if (e.key === 'i' && !editingId) {
          e.preventDefault();
          if (detailOpen && sidebarRepo) {
            invoke('record_engagement', { repoId: sidebarRepo.id, eventType: 'view_detail' }).catch(() => {});
          }
          setDetailOpen((v) => !v);
          return;
        }

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

        if (focusedView === 'feed' || focusedView === 'watching' || focusedView === 'graph' || focusedView === 'trending' || focusedView === 'settings') return;

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
            if (repo && !editingId) {
              openUrl(repo.url);
              invoke('record_engagement', { repoId: repo.id, eventType: 'open_browser' }).catch(() => {});
            }
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
          case 'm':
            e.preventDefault();
            if (repo && !editingId) toggleReadLater(repo);
            break;
          case 'M':
            e.preventDefault();
            if (repo && !editingId) setShowCollectionMenu(true);
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
              setDetailOpen(true);
              invoke('record_engagement', { repoId: repo.id, eventType: 'open_readme' }).catch(() => {});
            }
            break;
          case ',':
            setFocusedView('settings');
            break;
          // shift-R is handled globally above (before the non-library early-return guard)
          case '?':
            setModal('help');
            break;
          case 'Escape':
            if (editingId) setEditingId(null);
            break;
        }
      },
      [repos, selectedIdx, modal, editingId, describing, batchRunning, viewMode, readmeTabs, activeReadmeTabId, splitPane, focusedSide, digest]
    ),
    [repos, selectedIdx, modal, editingId, describing, batchRunning, viewMode, readmeTabs, activeReadmeTabId, splitPane, focusedSide, digest]
  );

  async function handleOnboardingComplete(opts: OnboardingCompleteOpts) {
    try {
      await invoke('set_onboarded_at');
    } catch (e) {
      showToast(`Could not save onboarding state — ${e}`, 'error');
    }
    loadRepos();
    loadClassificationOptions();
    if (opts.openAddModal) {
      setPendingAddModal(true);
    }
    setOnboardingState('done');
  }

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

  async function handleSyncStars() {
    if (syncing) return;
    if (patMissing) {
      showToast('Set your GitHub PAT in Settings first', 'warn');
      setFocusedView('settings');
      return;
    }
    setSyncing(true);
    try {
      const r = await invoke<SyncStarsResult>('sync_stars');
      if (r.added === 0 && r.removed === 0) {
        showToast('Stars up to date');
      } else {
        showToast(`Star sync: ${r.added} added, ${r.removed} removed`);
        loadRepos();
        loadCategories();
      }
    } catch (e) {
      showToast(`Star sync failed — ${e}`, 'error');
    } finally {
      setSyncing(false);
    }
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

  if (onboardingState === 'loading') {
    return <div className="h-screen bg-bg" />;
  }
  if (onboardingState === 'show') {
    return <OnboardingFlow onComplete={handleOnboardingComplete} />;
  }

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
        <div data-tauri-drag-region className="flex items-center gap-2 select-none">
          <button
            data-no-drag
            onClick={openDigest}
            title="이번 주 리서핑 (shift-R)"
            className="pointer-events-auto"
          >
            <img src={eunhaLogo} alt="eunha" className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-accent tracking-wide pointer-events-none">eunha</span>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setModal('add')} className="text-xs px-2 py-1">
            + Add repo
          </Button>
          <Button
            onClick={() => {
              if (patMissing) {
                showToast('Set your GitHub PAT in Settings first', 'warn');
                setFocusedView('settings');
              } else {
                setModal('import');
              }
            }}
            className="text-xs px-2 py-1"
          >
            Import stars
          </Button>
          <Button
            onClick={handleSyncStars}
            disabled={syncing}
            className="text-xs px-2 py-1 gap-1.5"
            title="Sync with your GitHub star list (adds new, removes unstarred)"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={syncing ? 'animate-spin' : ''}
            >
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {syncing ? 'Syncing…' : 'Sync'}
          </Button>
          <Button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="text-xs px-2 py-1"
            title="Toggle light/dark theme"
          >
            {theme === 'dark' ? '☀' : '◑'}
          </Button>
          <Button
            onClick={() => setFocusedView('settings')}
            className="text-xs px-2 py-1"
            title="Settings (,)"
          >
            ⚙
          </Button>
        </div>
      </div>

      <main className="eunha-workspace flex flex-row flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="eunha-app-sidebar flex-shrink-0 w-40 border-r border-border bg-panel flex flex-col pt-2 pb-4">
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
                label: 'Following',
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
              <span className="eunha-nav-label flex-1 text-left">{label}</span>
              {badge !== undefined && (
                <span className="eunha-nav-badge bg-accent text-[10px] font-semibold text-bg rounded-full px-1 min-w-[16px] text-center leading-4">
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
              <span className="eunha-nav-label flex-1 text-left">README</span>
              <span className="eunha-nav-badge bg-accent text-[10px] font-semibold text-bg rounded-full px-1 min-w-[16px] text-center leading-4">
                {readmeTabs.length}
              </span>
            </button>
          )}

          {collections.length > 0 && viewMode === 'library' && (
            <>
              <div className="mx-3 my-2 border-t border-border" />
              <CollectionsSidebar
                collections={collections}
                selectedCollection={selectedCollection}
                onCollectionChange={setSelectedCollection}
                onCollectionsChange={loadCollections}
              />
            </>
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
                  setDetailOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setFocusedActiveReadmeTabId(tab.repoId);
                    setFocusedView('readme');
                    setDetailOpen(true);
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
      <div ref={splitContainerRef} className="eunha-split-container flex flex-row flex-1 overflow-hidden">
        {/* LEFT PANE */}
        <div
          style={splitPane ? { width: `${splitRatio * 100}%` } : undefined}
          onClick={splitPane ? () => setFocusedSide('left') : undefined}
          className={`eunha-primary-pane flex flex-col overflow-hidden ${splitPane ? '' : 'flex-1'} ${
            splitPane && focusedSide === 'left' ? 'ring-1 ring-accent ring-inset' : ''
          }`}
        >
          {/* GraphView is always mounted to preserve d3 simulation + avatar cache */}
          <div className={viewMode === 'graph' ? 'flex flex-col flex-1 overflow-hidden' : 'hidden'}>
            <GraphView
              showToast={showToast}
              theme={theme}
              onSelectionChange={(repo, fromClick) => {
                setExternalSelectedRepo(repo);
                if (fromClick) setDetailOpen(true);
              }}
            />
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
              onDescribe={async (fullName) => {
                const existing = reposRef.current.find((r) => r.id === fullName);
                if (existing) {
                  describeRepo(existing);
                  return { wasAdded: false };
                }
                const repo = await invoke<Repo>('add_feed_repo_to_library', { repoFullName: fullName });
                setRepos((rs) => (rs.some((r) => r.id === repo.id) ? rs : [repo, ...rs]));
                loadCategories();
                describeRepo(repo);
                return { wasAdded: true };
              }}
              describing={describing}
              viewVariant={viewVariant}
              onVariantChange={setViewVariant}
              onSelectionChange={(repo, fromClick) => {
                setExternalSelectedRepo(repo);
                if (fromClick) setDetailOpen(true);
              }}
            />
          ) : viewMode === 'graph' ? null : viewMode === 'readme' ? null : viewMode === 'settings' ? (
            <SettingsView
              onBack={() => {
                setViewMode('library');
                invoke<{ pat_set: boolean }>('get_settings')
                  .then((s) => setPatMissing(!s.pat_set))
                  .catch(() => {});
              }}
            />
          ) : viewMode === 'watching' ? (
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
              viewVariant={viewVariant}
              onVariantChange={setViewVariant}
              onSelectionChange={(repo, fromClick) => {
                setExternalSelectedRepo(repo);
                if (fromClick) setDetailOpen(true);
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
                trailing={<VariantToggle value={viewVariant} onChange={setViewVariant} />}
              />
              <div className="flex gap-2 px-3 py-2 border-b border-border bg-panel">
                <select value={selectedTag ?? ''} onChange={(e) => setSelectedTag(e.target.value || null)} className="text-xs bg-bg border border-border rounded px-2 py-1 text-dim">
                  <option value="">All tags</option>{userTags.map(tag => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
                </select>
                <select value={selectedPurpose ?? ''} onChange={(e) => setSelectedPurpose(e.target.value || null)} className="text-xs bg-bg border border-border rounded px-2 py-1 text-dim">
                  <option value="">All purposes</option>{purposes.map(purpose => <option key={purpose.id} value={purpose.name}>{purpose.name}</option>)}
                </select>
                {(selectedTag || selectedPurpose) && <button className="text-xs text-muted hover:text-ink" onClick={() => { setSelectedTag(null); setSelectedPurpose(null); }}>Clear filters</button>}
              </div>

              {describing.size > 0 && (
                <div
                  className="eunha-progress-bar"
                  role="progressbar"
                  aria-label={`Describing ${describing.size} repo${describing.size !== 1 ? 's' : ''}`}
                />
              )}

              {viewVariant === 'masonry' ? (
                <div ref={masonryScrollRef} className="flex-1 overflow-y-auto px-3.5 pt-3.5 pb-1">
                  {repos.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-sm text-muted">
                      {query ? 'No repos match your search.' : 'Your library is empty.'}
                    </div>
                  ) : (
                    <div className="eunha-masonry-grid">
                      {repos.map((repo, i) => (
                        <RepoCardMasonry
                          key={repo.id}
                          repo={repo}
                          index={i}
                          isSelected={i === selectedIdx}
                          isDescribing={describing.has(repo.id)}
                          currentPromptVersion={constants.current_prompt_version}
                          onClick={() => {
                            setSelectedIdx(i);
                            setEditingId(null);
                            setDetailOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div ref={listRef} className="flex-1 overflow-y-auto repo-list-container">
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
                            {viewVariant === 'dense' ? (
                              <RepoRowDense
                                repo={repo}
                                isSelected={vItem.index === selectedIdx}
                                isDescribing={describing.has(repo.id)}
                                currentPromptVersion={constants.current_prompt_version}
                                onClick={() => {
                                  setSelectedIdx(vItem.index);
                                  setEditingId(null);
                                  setDetailOpen(true);
                                }}
                              />
                            ) : (
                              <RepoRowComfy
                                repo={repo}
                                isSelected={vItem.index === selectedIdx}
                                isDescribing={describing.has(repo.id)}
                                currentPromptVersion={constants.current_prompt_version}
                                onClick={() => {
                                  setSelectedIdx(vItem.index);
                                  setEditingId(null);
                                  setDetailOpen(true);
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {selectedRepo && isEditing && (
                <EditPanel
                  repo={selectedRepo}
                  onSave={handleEditSave}
                  onDiscard={() => setEditingId(null)}
                />
              )}

              {/* Status bar */}
              <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-border text-xs text-muted">
                <span>
                  {selectedCollection !== null
                    ? `${repos.length} repos in collection`
                    : `${repos.length} repos`}
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>m</Kbd>{' '}read later ·{' '}
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
              className="eunha-split-gutter w-1 bg-border hover:bg-accent cursor-col-resize flex-shrink-0"
            />
            <div
              onClick={() => setFocusedSide('right')}
              className={`eunha-secondary-pane flex flex-col overflow-hidden flex-1 min-w-0 ${
                focusedSide === 'right' ? 'ring-1 ring-accent ring-inset' : ''
              }`}
            >
              {splitPane.view === 'graph' ? (
                <GraphView
              showToast={showToast}
              theme={theme}
              onSelectionChange={(repo, fromClick) => {
                setExternalSelectedRepo(repo);
                if (fromClick) setDetailOpen(true);
              }}
            />
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
                  onDescribe={async (fullName) => {
                    const existing = reposRef.current.find((r) => r.id === fullName);
                    if (existing) {
                      describeRepo(existing);
                      return { wasAdded: false };
                    }
                    const repo = await invoke<Repo>('add_feed_repo_to_library', { repoFullName: fullName });
                    setRepos((rs) => (rs.some((r) => r.id === repo.id) ? rs : [repo, ...rs]));
                    loadCategories();
                    describeRepo(repo);
                    return { wasAdded: true };
                  }}
                  describing={describing}
                  viewVariant={viewVariant}
                  onVariantChange={setViewVariant}
                  onSelectionChange={(repo, fromClick) => {
                    setExternalSelectedRepo(repo);
                    if (fromClick) setDetailOpen(true);
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
                  viewVariant={viewVariant}
                  onVariantChange={setViewVariant}
                  onSelectionChange={(repo, fromClick) => {
                    setExternalSelectedRepo(repo);
                    if (fromClick) setDetailOpen(true);
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

        {detailOpen && focusedView !== 'settings' && (
          <RepoDetailSidebar
            repo={sidebarRepo}
            isDescribing={sidebarIsDescribing}
            currentPromptVersion={constants.current_prompt_version}
            onOpenUrl={() => sidebarRepo && openUrl(sidebarRepo.url)}
            onClose={() => setDetailOpen(false)}
          />
        )}
      </div>
        </div>
      </main>

      {showCollectionMenu && selectedRepo && (
        <AddToCollectionMenu
          repo={selectedRepo}
          collections={collections}
          onDone={loadCollections}
          onClose={() => setShowCollectionMenu(false)}
        />
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
      {digest && (
        <DigestCard
          batch={digest}
          describing={describing}
          onClose={() => setDigest(null)}
          onOpen={(repo) => openUrl(repo.url)}
          onDescribe={describeRepoReturning}
          onEdit={(repo) => {
            setDigest(null);
            const idx = repos.findIndex((r) => r.id === repo.id);
            if (idx >= 0) {
              setSelectedIdx(idx);
              setEditingId(repo.id);
            } else {
              showToast('목록에서 찾을 수 없는 저장소예요');
            }
          }}
          onAction={(repoId, action) => {
            invoke('record_digest_action', {
              repoId,
              batchDate: digest.batch_date,
              action,
            }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
