type AiStatus = 'undescribed' | 'stale' | 'described' | null;

const STATUS_PILLS: { label: string; value: AiStatus }[] = [
  { label: 'All', value: null },
  { label: 'Undescribed', value: 'undescribed' },
  { label: 'Stale', value: 'stale' },
  { label: 'Described', value: 'described' },
];

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  aiStatus: AiStatus;
  onAiStatusChange: (s: AiStatus) => void;
  trailing?: React.ReactNode;
}

export function SearchBar({
  query,
  onQueryChange,
  searchRef,
  aiStatus,
  onAiStatusChange,
  trailing,
}: Props) {
  return (
    <div className="flex-shrink-0 border-b border-border px-5 pt-4 pb-3">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm select-none">
          /
        </span>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="search… (AND, OR, NOT supported)"
          className="w-full bg-input border border-border rounded px-8 py-2 text-sm text-ink placeholder-muted outline-none focus:border-brand transition-colors"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onQueryChange('');
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-xs"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
        {STATUS_PILLS.map(({ label, value }) => (
          <button
            key={label}
            onClick={() => onAiStatusChange(aiStatus === value ? null : value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              aiStatus === value
                ? 'border-brand text-accent bg-brand-tint'
                : 'border-border text-muted hover:border-dim'
            }`}
          >
            {label}
          </button>
        ))}
        {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
      </div>
    </div>
  );
}
