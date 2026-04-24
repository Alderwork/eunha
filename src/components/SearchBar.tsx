import { CategoryCount } from '../types';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  selectedCategory: string | null;
  onCategoryChange: (cat: string | null) => void;
  categories: CategoryCount[];
  searchRef: React.RefObject<HTMLInputElement | null>;
}

export function SearchBar({
  query,
  onQueryChange,
  selectedCategory,
  onCategoryChange,
  categories,
  searchRef,
}: Props) {
  return (
    <div className="flex-shrink-0 border-b border-[var(--border)] px-5 pt-4 pb-3">
      {/* Search input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] text-sm select-none">
          /
        </span>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="search…"
          className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-8 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--amber)] transition-colors"
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
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--text)] text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          <button
            onClick={() => onCategoryChange(null)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              selectedCategory === null
                ? 'border-[var(--amber)] text-[var(--amber)] bg-[#2a1a08]'
                : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)]'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.category}
              onClick={() => onCategoryChange(cat.category === selectedCategory ? null : cat.category)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selectedCategory === cat.category
                  ? 'border-[var(--amber)] text-[var(--amber)] bg-[#2a1a08]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)]'
              }`}
            >
              {cat.category}
              <span className="ml-1 opacity-50">{cat.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
