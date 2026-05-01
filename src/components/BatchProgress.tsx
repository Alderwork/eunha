import { BatchDescribeProgress } from '../types';

interface Props {
  progress: BatchDescribeProgress | null;
  onCancel?: () => void;
}

export function BatchProgress({ progress, onCancel }: Props) {
  if (!progress) return null;

  const pct = Math.round((progress.current / progress.total) * 100);

  return (
    <div className="flex-shrink-0 border-b border-border bg-bg px-5 py-2 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center justify-between text-xs text-muted mb-1">
          <span>Describing {progress.current}/{progress.total}…</span>
          {progress.failed > 0 && (
            <span className="text-warn">{progress.failed} failed</span>
          )}
        </div>
        <div className="h-1 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {onCancel && (
        <button
          onClick={onCancel}
          className="text-xs text-muted hover:text-ink flex-shrink-0"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
