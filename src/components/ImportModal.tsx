import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ImportResult, ImportProgress } from '../types';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

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
    <Modal onClose={onClose} width="w-[420px]">
      <div className="p-6">
        <h2 className="text-base font-semibold text-ink mb-4">
          {phase === 'running' ? 'Importing from GitHub Stars' :
           phase === 'done' ? (result?.cancelled ? 'Import cancelled' : 'Import complete') :
           'Import failed'}
        </h2>

        {phase === 'running' && (
          <>
            <p className="text-sm text-muted mb-3">
              {progress ? `Fetching page ${progress.page}${totalPages ? ` of ${totalPages}` : ''}…` : 'Starting…'}
            </p>

            <div className="h-1.5 bg-surface rounded-full overflow-hidden mb-2">
              {progressPct !== null ? (
                <div
                  className="h-full bg-brand rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              ) : (
                <div className="h-full bg-brand rounded-full animate-pulse w-1/3" />
              )}
            </div>

            {progress && (
              <p className="text-xs text-muted mb-4">
                {progress.repos_fetched} repos fetched
              </p>
            )}

            <button
              onClick={handleCancel}
              className="text-sm text-muted hover:text-ink border border-border px-4 py-1.5 rounded transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {phase === 'done' && result && (
          <>
            <div className="text-sm text-ink space-y-1 mb-4">
              {result.cancelled ? (
                <p>Cancelled — imported <strong>{result.imported}</strong> repos ({result.pages_fetched} pages fetched)</p>
              ) : (
                <>
                  <p>Imported <strong>{result.imported}</strong> repos</p>
                  {result.already_exists > 0 && (
                    <p className="text-muted">{result.already_exists} already in your library</p>
                  )}
                  {result.error && (
                    <p className="text-warn">Partial import: {result.error}</p>
                  )}
                </>
              )}
            </div>
            <Button variant="primary" onClick={onClose} className="text-sm px-4 py-1.5">
              Done
            </Button>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="text-sm text-danger mb-4">{error}</p>
            <button
              onClick={onClose}
              className="text-sm text-muted hover:text-ink border border-border px-4 py-1.5 rounded transition-colors"
            >
              Close
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
