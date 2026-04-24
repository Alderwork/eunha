import { BatchDescribeProgress } from '../types';

interface Props {
  progress: BatchDescribeProgress | null;
  onCancel?: () => void;
}

export function BatchProgress({ progress, onCancel }: Props) {
  if (!progress) return null;

  const pct = Math.round((progress.current / progress.total) * 100);

  return (
    <div className="flex-shrink-0 border-b border-[var(--border)] bg-[#0f0f12] px-5 py-2 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
          <span>Describing {progress.current}/{progress.total}…</span>
          {progress.failed > 0 && (
            <span className="text-yellow-500">{progress.failed} failed</span>
          )}
        </div>
        <div className="h-1 bg-[var(--border)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--amber)] rounded-full transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {onCancel && (
        <button
          onClick={onCancel}
          className="text-xs text-[var(--muted)] hover:text-[var(--text)] flex-shrink-0"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
