import { Repo } from '../types';
import { Kbd } from './ui/Kbd';

interface Props {
  repo: Repo;
  isDescribing: boolean;
  currentPromptVersion: number;
}

export function DetailPanel({ repo, isDescribing, currentPromptVersion }: Props) {
  const tags: string[] = (() => {
    const fromTopics: string[] = repo.topics ? JSON.parse(repo.topics) : [];
    if (fromTopics.length > 0) return fromTopics;
    return repo.llm_tags ? JSON.parse(repo.llm_tags) : [];
  })();
  const isStale =
    repo.llm_summary !== null &&
    repo.prompt_version !== null &&
    repo.prompt_version < currentPromptVersion;
  const effectiveCategory = repo.user_category ?? repo.llm_category;

  return (
    <div className="flex-shrink-0 border-t border-border px-5 py-4" style={{ minHeight: 180 }}>
      {isDescribing ? (
        <div className="flex items-center gap-2 text-muted text-sm">
          <span className="animate-pulse">●</span>
          <span>Describing…</span>
        </div>
      ) : repo.llm_what ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">{repo.full_name}</h2>
              {effectiveCategory && (
                <span className="text-xs text-accent mt-0.5 inline-block">
                  {effectiveCategory}
                  {repo.user_category && (
                    <span className="text-muted ml-1">(custom)</span>
                  )}
                  {repo.category_locked && (
                    <span className="text-faint ml-1" title="Category locked">🔒</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isStale && (
                <span className="text-xs px-2 py-0.5 rounded-[2px] bg-warn-tint text-warn">stale</span>
              )}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded-[2px] bg-surface text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted uppercase tracking-wide mb-1">What</div>
              <div className="text-ink leading-snug">{repo.llm_what}</div>
            </div>
            <div>
              <div className="text-xs text-muted uppercase tracking-wide mb-1">Why</div>
              <div className="text-ink leading-snug">{repo.llm_why}</div>
            </div>
            <div>
              <div className="text-xs text-muted uppercase tracking-wide mb-1">Use Case</div>
              <div className="text-ink leading-snug">{repo.llm_use_case}</div>
            </div>
          </div>

          {repo.user_notes && (
            <div className="mt-2 text-sm text-muted border-t border-border pt-2">
              {repo.user_notes}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{repo.full_name}</h2>
            {repo.description && (
              <p className="text-sm text-muted mt-1">{repo.description}</p>
            )}
          </div>
          <div className="ml-auto text-xs text-muted flex-shrink-0 mt-1">
            Press <Kbd>d</Kbd> to describe
          </div>
        </div>
      )}
    </div>
  );
}
