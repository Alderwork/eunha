import { Repo } from '../types';

interface Props {
  repo: Repo;
  isSelected: boolean;
  currentPromptVersion: number;
  onClick: () => void;
}

export function RepoRow({ repo, isSelected, currentPromptVersion, onClick }: Props) {
  const isStale =
    repo.llm_summary !== null &&
    repo.prompt_version !== null &&
    repo.prompt_version < currentPromptVersion;

  const displayText = repo.llm_what ?? repo.description ?? '';
  const tags: string[] = repo.llm_tags ? JSON.parse(repo.llm_tags) : [];
  const effectiveCategory = repo.user_category ?? repo.llm_category;

  return (
    <div
      onClick={onClick}
      style={{ height: 64 }}
      className={`
        flex items-center px-5 gap-4 cursor-pointer border-b transition-colors
        ${isSelected
          ? 'bg-[#1a1a1e] border-[var(--border)]'
          : 'bg-transparent border-[var(--border)] hover:bg-[#141416]'
        }
      `}
    >
      {/* Selected indicator */}
      <div
        className={`w-0.5 h-6 rounded-full flex-shrink-0 transition-colors ${
          isSelected ? 'bg-[var(--amber)]' : 'bg-transparent'
        }`}
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-mono text-[var(--amber)] truncate"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
          >
            {repo.full_name}
          </span>
          {repo.watching && (
            <span className="text-[var(--amber)] flex-shrink-0 text-xs" title="Watching">●</span>
          )}
          {isStale && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[#2a2010] text-[#a06830] flex-shrink-0">
              stale
            </span>
          )}
          {!repo.llm_summary && (
            <span className="text-xs text-[var(--muted)] flex-shrink-0">undescribed</span>
          )}
        </div>
        {displayText && (
          <p className="text-[13px] text-[#b0b0ac] truncate leading-tight mt-0.5">
            {displayText}
          </p>
        )}
      </div>

      {/* Right metadata */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {effectiveCategory && (
          <span className="text-xs text-[var(--muted)] hidden sm:block">
            {effectiveCategory}
          </span>
        )}
        {tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="text-xs px-1.5 py-0.5 rounded bg-[#1e1e22] text-[var(--muted)] hidden md:block"
          >
            {tag}
          </span>
        ))}
        {repo.language && (
          <span className="text-xs text-[var(--muted)]">{repo.language}</span>
        )}
      </div>
    </div>
  );
}
