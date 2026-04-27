import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
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

type Modal = 'settings' | 'import' | 'add' | 'help' | null;
type ViewMode = 'library' | 'feed' | 'watching';

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [constants, setConstants] = useState<AppConstants>({ current_prompt_version: 1 });

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('library');

  // Describing state: set of repo ids currently being described
  const [describing, setDescribing] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  // Batch describe
  const [batchProgress, setBatchProgress] = useState<BatchDescribeProgress | null>(null);
  const batchRunning = batchProgress !== null;

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' | 'warn' } | null>(null);
  const [keychainError, setKeychainError] = useState<string | null>(null);
  const [patMissing, setPatMissing] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: repos.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 64,
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

  // Initial setup
  useEffect(() => {
    invoke<AppConstants>('get_app_constants').then(setConstants);

    // Check PAT
    invoke<{ pat_set: boolean; pat_masked: string; provider: string; api_key_set: boolean; api_key_masked: string; ollama_url: string }>('get_settings')
      .then((s) => {
        if (!s.pat_set) setPatMissing(true);
      })
      .catch((e) => {
        setKeychainError(`Could not read credentials from keychain — open Settings to re-enter. (${e})`);
      });

    loadRepos();
    loadCategories();
  }, []);

  useEffect(() => {
    loadRepos();
  }, [query, selectedCategory]);

  // Batch describe listener
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<BatchDescribeProgress>('batch-describe:progress', (e) => {
      setBatchProgress(e.payload);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Scroll selected row into view
  useEffect(() => {
    rowVirtualizer.scrollToIndex(selectedIdx, { align: 'auto' });
  }, [selectedIdx]);

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

  // Keybindings
  useKeydown(
    useCallback(
      (e: KeyboardEvent) => {
        // Don't handle when typing in inputs (except search)
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

        // Search: / focuses it
        if (e.key === '/' && !isInput && modal === null) {
          e.preventDefault();
          searchRef.current?.focus();
          return;
        }

        // If search is focused, let it handle its own keys
        if (target === searchRef.current) {
          if (e.key === 'Escape') {
            setQuery('');
            searchRef.current?.blur();
          }
          return;
        }

        // Block remaining keybindings if a modal is open or in an input
        if (modal !== null || isInput) return;

        // Feed/watching views handle their own keys
        if (viewMode === 'feed' || viewMode === 'watching') return;

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
            if (!repo || editingId) break;
            if (e.shiftKey) {
              // shift-D: describe again
              describeRepo(repo);
            } else {
              if (repo.llm_summary) {
                showToast('Already described — press shift-D to regenerate');
              } else {
                describeRepo(repo);
              }
            }
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
            setViewMode('feed');
            break;
          case 'w':
            if (repo && !editingId) toggleWatching(repo);
            break;
          case 'W':
            setViewMode('watching');
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
      [repos, selectedIdx, modal, editingId, describing, batchRunning, viewMode]
    ),
    [repos, selectedIdx, modal, editingId, describing, batchRunning, viewMode]
  );

  async function handleEditSave(notes: string | null, category: string | null) {
    if (!selectedRepo) return;
    try {
      const updated = await invoke<Repo>('update_repo_user_fields', {
        repoId: selectedRepo.id,
        userNotes: notes,
        userCategory: category,
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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)]">
      {/* Traffic-light spacer for macOS overlay titlebar */}
      <div className="flex-shrink-0 h-8" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Keychain error banner */}
      {keychainError && (
        <ToastBanner message={keychainError} type="warn" />
      )}

      {/* Toast */}
      {toast && <ToastBanner message={toast.msg} type={toast.type} />}

      {/* Batch progress */}
      {batchProgress && batchProgress.total > 0 && (
        <BatchProgress progress={batchProgress} />
      )}

      {/* Header toolbar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-[var(--border)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <h1 className="text-sm font-semibold text-[var(--amber)] tracking-wide select-none">eunha</h1>
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => setModal('add')}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--muted)] transition-colors"
          >
            + Add repo
          </button>
          <button
            onClick={() => {
              if (patMissing) {
                showToast('Set your GitHub PAT in Settings first', 'warn');
                setModal('settings');
              } else {
                setModal('import');
              }
            }}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--muted)] transition-colors"
          >
            Import stars
          </button>
          <button
            onClick={() => setModal('settings')}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--muted)] transition-colors"
            title="Settings (,)"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* First-launch interstitial */}
      {patMissing && repos.length === 0 && (
        <div className="flex-shrink-0 border-b border-[var(--border)] bg-[#0f0f14] px-5 py-5 text-center">
          <p className="text-sm text-[var(--text)] mb-3">
            Welcome to eunha. Set up your GitHub token to import stars.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => setModal('settings')}
              className="px-4 py-1.5 text-sm bg-[var(--amber)] text-[#0C0C0E] rounded font-medium hover:opacity-90 transition-opacity"
            >
              Open Settings
            </button>
            <button
              onClick={() => setModal('add')}
              className="px-4 py-1.5 text-sm border border-[var(--border)] text-[var(--muted)] rounded hover:border-[var(--muted)] transition-colors"
            >
              Add a repo manually
            </button>
          </div>
        </div>
      )}

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
      ) : viewMode === 'watching' ? (
        <WatchingView
          onBack={() => setViewMode('library')}
          showToast={showToast}
          onRepoUpdated={(repo) => setRepos((rs) => rs.map((r) => (r.id === repo.id ? repo : r)))}
        />
      ) : (
        <>
          {/* Search + category filter */}
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            categories={categories}
            searchRef={searchRef}
          />

          {/* Repo list */}
          <div ref={listRef} className="flex-1 overflow-y-auto">
            {repos.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-[var(--muted)]">
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

          {/* Bottom panel: edit or detail */}
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
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-1.5 border-t border-[var(--border)] text-xs text-[var(--muted)]">
            <span>{repos.length} repos</span>
            <span>
              <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">w</kbd>
              {' '}watch ·{' '}
              <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">W</kbd>
              {' '}watching ·{' '}
              <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">f</kbd>
              {' '}feed ·{' '}
              <kbd className="px-1 bg-[var(--surface)] border border-[var(--border)] rounded">?</kbd>
              {' '}help
            </span>
          </div>
        </>
      )}

      {/* Modals */}
      {modal === 'settings' && (
        <SettingsModal onClose={() => {
          setModal(null);
          // Re-check PAT status
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
