interface Props {
  onClose: () => void;
}

const BINDINGS = [
  ['j / k', 'Navigate up / down'],
  ['d', 'Describe repo (or hint if already described)'],
  ['D', 'Describe Again — clear + regenerate'],
  ['A', 'Batch describe — all undescribed + stale'],
  ['o', 'Open in browser'],
  ['/', 'Focus search'],
  ['e', 'Edit notes + category override'],
  ['w', 'Toggle watching (track releases)'],
  ['W', 'Open watching list'],
  ['f', 'Network stars feed'],
  [',', 'Open settings'],
  ['?', 'Show this help'],
  ['Esc', 'Close / cancel / discard'],
];

const WATCHING_BINDINGS = [
  ['j / k', 'Navigate'],
  ['r', 'Open releases page'],
  ['o', 'Open repo in browser'],
  ['w', 'Unwatch'],
  ['Esc', 'Back to library'],
];

const FEED_BINDINGS = [
  ['j / k', 'Navigate feed'],
  ['a', 'Add to library'],
  ['d', 'Add to library + describe with LLM'],
  ['x', 'Dismiss'],
  ['o', 'Open in browser'],
  ['r', 'Refresh feed'],
  ['Esc', 'Back to library'],
];

export function KeybindingHelp({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === '?') onClose(); }}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-lg w-[400px] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--text)]">Keybindings</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none">✕</button>
        </div>
        <div className="space-y-2">
          {BINDINGS.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="flex-shrink-0 min-w-[60px] text-center px-2 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-[var(--amber)] font-mono">
                {key}
              </kbd>
              <span className="text-sm text-[var(--muted)]">{desc}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">Watching view</p>
          <div className="space-y-2">
            {WATCHING_BINDINGS.map(([key, desc]) => (
              <div key={key} className="flex items-center gap-3">
                <kbd className="flex-shrink-0 min-w-[60px] text-center px-2 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-[var(--amber)] font-mono">
                  {key}
                </kbd>
                <span className="text-sm text-[var(--muted)]">{desc}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted)] mb-2 uppercase tracking-wide">Feed view</p>
          <div className="space-y-2">
            {FEED_BINDINGS.map(([key, desc]) => (
              <div key={key} className="flex items-center gap-3">
                <kbd className="flex-shrink-0 min-w-[60px] text-center px-2 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-[var(--amber)] font-mono">
                  {key}
                </kbd>
                <span className="text-sm text-[var(--muted)]">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
