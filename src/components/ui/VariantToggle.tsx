import { ViewVariant } from '../../lib/visuals';

interface Props {
  value: ViewVariant;
  onChange: (v: ViewVariant) => void;
}

const ITEMS: { key: ViewVariant; label: string; icon: React.ReactNode }[] = [
  {
    key: 'dense',
    label: 'Dense',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
  {
    key: 'comfy',
    label: 'Comfy',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="6" rx="1" />
        <rect x="3" y="14" width="18" height="6" rx="1" />
      </svg>
    ),
  },
  {
    key: 'masonry',
    label: 'Masonry',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="6" rx="1" />
        <rect x="3" y="15" width="7" height="6" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
      </svg>
    ),
  },
];

export function VariantToggle({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      className="inline-flex gap-0.5 p-0.5 bg-surface border border-border rounded-md"
    >
      {ITEMS.map(({ key, label, icon }) => {
        const active = key === value;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            title={`${label} view`}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs font-medium transition-colors ${
              active
                ? 'bg-elevated text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                : 'text-muted hover:text-dim'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
