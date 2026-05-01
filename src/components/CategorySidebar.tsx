import { CategoryCount } from '../types';

interface Props {
  categories: CategoryCount[];
  selectedCategory: string | null;
  onCategoryChange: (cat: string | null) => void;
}

export function CategorySidebar({ categories, selectedCategory, onCategoryChange }: Props) {
  function handleClick(value: string | null) {
    // Clicking the already-active category deselects it
    onCategoryChange(selectedCategory === value ? null : value);
  }

  const allCount = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <nav className="overflow-y-auto flex-shrink-0" aria-label="Category filter">
      <ul className="py-1">
        {/* "All" row — always first */}
        <li>
          <button
            type="button"
            onClick={() => handleClick(null)}
            className={[
              'relative w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors',
              selectedCategory === null
                ? 'text-accent bg-elevated before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent'
                : 'text-muted hover:text-dim hover:bg-elevated/40',
            ].join(' ')}
            aria-current={selectedCategory === null ? 'true' : undefined}
          >
            <span>All</span>
            <span className="text-faint text-[11px] tabular-nums">{allCount}</span>
          </button>
        </li>

        {categories.map((c) => {
          const isActive = selectedCategory === c.category;
          return (
            <li key={c.category}>
              <button
                type="button"
                onClick={() => handleClick(c.category)}
                className={[
                  'relative w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'text-accent bg-elevated before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent'
                    : 'text-muted hover:text-dim hover:bg-elevated/40',
                ].join(' ')}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="truncate">{c.category}</span>
                <span className="text-faint text-[11px] tabular-nums ml-2 flex-shrink-0">{c.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
