import { Repo } from '../types';

interface Props {
  repo: Repo;
  isDescribing: boolean;
  currentPromptVersion: number;
}

export function DetailPanel({ repo, isDescribing, currentPromptVersion }: Props) {
  const tags: string[] = repo.llm_tags ? JSON.parse(repo.llm_tags) : [];
  const isStale =
    repo.llm_summary !== null &&
    repo.prompt_version !== null &&
    repo.prompt_version < currentPromptVersion;
  const effectiveCategory = repo.user_category ?? repo.llm_category;

  return (
    <div className="flex-shrink-0 border-t border-[var(--border)] px-5 py-4" style={{ minHeight: 180 }}>
      {isDescribing ? (
        <div className="flex items-center gap-2 text-[var(--muted)] text-sm">
          <span className="animate-pulse">●</span>
          <span>Describing…</span>
        </div>
      ) : repo.llm_what ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--text)]">{repo.full_name}</h2>
              {effectiveCategory && (
                <span className="text-xs text-[var(--amber)] mt-0.5 inline-block">
                  {effectiveCategory}
                  {repo.user_category && (
                    <span className="text-[var(--muted)] ml-1">(custom)</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isStale && (
                <span className="text-xs px-2 py-0.5 rounded bg-[#2a2010] text-[#a06830]">stale</span>
              )}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded bg-[#1e1e22] text-[var(--muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">What</div>
              <div className="text-[var(--text)] leading-snug">{repo.llm_what}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Why</div>
              <div className="text-[var(--text)] leading-snug">{repo.llm_why}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Use Case</div>
              <div className="text-[var(--text)] leading-snug">{repo.llm_use_case}</div>
            </div>
          </div>

          {repo.user_notes && (
            <div className="mt-2 text-sm text-[var(--muted)] border-t border-[var(--border)] pt-2">
              {repo.user_notes}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text)]">{repo.full_name}</h2>
            {repo.description && (
              <p className="text-sm text-[var(--muted)] mt-1">{repo.description}</p>
            )}
          </div>
          <div className="ml-auto text-xs text-[var(--muted)] flex-shrink-0 mt-1">
            Press <kbd className="px-1 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded">d</kbd> to describe
          </div>
        </div>
      )}
    </div>
  );
}
