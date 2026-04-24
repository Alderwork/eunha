import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ImportResult, ImportProgress } from '../types';

interface Props {
  onClose: () => void;
  onDone: () => void;
}

type Phase = 'running' | 'done' | 'error';

export function ImportModal({ onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('running');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<ImportProgress>('import:progress', (event) => {
      setProgress(event.payload);
    }).then((fn) => { unlisten = fn; });

    invoke<ImportResult>('import_stars')
      .then((r) => {
        setResult(r);
        setPhase('done');
        onDone();
      })
      .catch((e) => {
        setError(String(e));
        setPhase('error');
      });

    return () => { unlisten?.(); };
  }, []);

  function handleCancel() {
    invoke('cancel_import');
  }

  const totalPages = progress?.total_pages;
  const currentPage = progress?.page ?? 0;
  const progressPct = totalPages ? Math.round((currentPage / totalPages) * 100) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg w-[420px] shadow-2xl p-6">
        <h2 className="text-base font-semibold text-[var(--text)] mb-4">
          {phase === 'running' ? 'Importing from GitHub Stars' :
           phase === 'done' ? (result?.cancelled ? 'Import cancelled' : 'Import complete') :
           'Import failed'}
        </h2>

        {phase === 'running' && (
          <>
            <p className="text-sm text-[var(--muted)] mb-3">
              {progress ? `Fetching page ${progress.page}${totalPages ? ` of ${totalPages}` : ''}…` : 'Starting…'}
            </p>

            {/* Progress bar */}
            <div className="h-1.5 bg-[var(--border)] rounded-full overflow-hidden mb-2">
              {progressPct !== null ? (
                <div
                  className="h-full bg-[var(--amber)] rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              ) : (
                <div className="h-full bg-[var(--amber)] rounded-full animate-pulse w-1/3" />
              )}
            </div>

            {progress && (
              <p className="text-xs text-[var(--muted)] mb-4">
                {progress.repos_fetched} repos fetched
              </p>
            )}

            <button
              onClick={handleCancel}
              className="text-sm text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-4 py-1.5 rounded transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {phase === 'done' && result && (
          <>
            <div className="text-sm text-[var(--text)] space-y-1 mb-4">
              {result.cancelled ? (
                <p>Cancelled — imported <strong>{result.imported}</strong> repos ({result.pages_fetched} pages fetched)</p>
              ) : (
                <>
                  <p>Imported <strong>{result.imported}</strong> repos</p>
                  {result.already_exists > 0 && (
                    <p className="text-[var(--muted)]">{result.already_exists} already in your library</p>
                  )}
                  {result.error && (
                    <p className="text-yellow-500">Partial import: {result.error}</p>
                  )}
                </>
              )}
            </div>
            <button
              onClick={onClose}
              className="bg-[var(--amber)] text-[#0C0C0E] px-4 py-1.5 rounded text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="text-sm text-red-400 mb-4">{error}</p>
            <button
              onClick={onClose}
              className="text-sm text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)] px-4 py-1.5 rounded transition-colors"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
