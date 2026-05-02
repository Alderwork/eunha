import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Button } from '../../ui/Button';

type ProgressPayload = {
  page: number;
  total_pages: number | null;
  repos_fetched: number;
  delta: number;
};

type ImportResult = {
  imported: number;
  already_exists: number;
  pages_fetched: number;
  cancelled: boolean;
  error: string | null;
};

type Phase = 'importing' | 'done' | 'error';

export function ImportStars({
  onSpawn,
  onSettle,
  onCalm,
  onContinue,
}: {
  onSpawn: (n: number) => void;
  onSettle: () => void;
  onCalm: () => void;
  onContinue: () => void;
}) {
  const [count, setCount] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [phase, setPhase] = useState<Phase>('importing');
  const [continueEnabled, setContinueEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Gate timer (no startedRef guard — StrictMode-safe)
  useEffect(() => {
    const t = setTimeout(() => setContinueEnabled(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Import (one-shot)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const start = Date.now();
    let unlistenProgress: (() => void) | null = null;

    listen<ProgressPayload>('import:progress', (e) => {
      onSpawn(e.payload.delta);
      setCount(e.payload.repos_fetched);
    }).then((fn) => { unlistenProgress = fn; });

    invoke<ImportResult>('import_stars')
      .then((result) => {
        setContinueEnabled(true);
        if (result.error) {
          setError(`Imported ${result.imported} so far — ${result.error}`);
          setPhase('error');
          onCalm();
          return;
        }
        setDoneCount(result.imported);
        setPhase('done');
        const elapsed = Date.now() - start;
        const wait = Math.max(0, 800 - elapsed);
        setTimeout(onSettle, wait);
      })
      .catch((e) => {
        setError(`Import failed — ${e}`);
        setPhase('error');
        onCalm();
        setContinueEnabled(true);
      });

    return () => {
      unlistenProgress?.();
    };
  }, [onSpawn, onSettle, onCalm]);

  const title =
    phase === 'done'
      ? `Imported ${doneCount} stars`
      : phase === 'error'
      ? error ?? 'Import failed'
      : 'Importing your stars';

  const subtext =
    phase === 'done'
      ? 'Press Continue to explore'
      : phase === 'error'
      ? ''
      : count === 0
      ? 'Reaching for GitHub…'
      : `${count} repos so far`;

  return (
    <div className="text-center">
      <h2 className="text-lg font-semibold text-ink mb-2">{title}</h2>
      <p className="text-sm text-muted mb-6 tabular-nums">{subtext || ' '}</p>

      <Button
        variant="primary"
        onClick={onContinue}
        disabled={!continueEnabled}
        className="w-full px-4 py-2 text-sm"
      >
        Continue
      </Button>
    </div>
  );
}
