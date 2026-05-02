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

export function ImportStars({
  onSpawn,
  onCalm,
  onContinue,
}: {
  onSpawn: (n: number) => void;
  onCalm: () => void;
  onContinue: () => void;
}) {
  const [count, setCount] = useState(0);
  const [continueEnabled, setContinueEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setContinueEnabled(true), 1500);
    return () => clearTimeout(t);
  }, []);

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
          onCalm();
          return;
        }
        const elapsed = Date.now() - start;
        const wait = Math.max(0, 800 - elapsed);
        setTimeout(onCalm, wait);
      })
      .catch((e) => {
        setError(`Import failed — ${e}`);
        onCalm();
        setContinueEnabled(true);
      });

    return () => {
      unlistenProgress?.();
    };
  }, [onSpawn, onCalm]);

  return (
    <div className="text-center">
      <h2 className="text-lg font-semibold text-ink mb-2">Importing your stars</h2>
      <p className="text-sm text-muted mb-6 tabular-nums">
        {error
          ? error
          : count === 0
          ? 'Reaching for GitHub…'
          : `${count} repos so far`}
      </p>

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
