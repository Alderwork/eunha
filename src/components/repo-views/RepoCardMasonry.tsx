import { Repo } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Chip } from '../ui/Chip';
import { Spinner } from '../ui/Spinner';
import {
  deriveRowState,
  EyeIcon,
  formatStars,
  LangDot,
  StarIcon,
  TopicIcon,
} from './_shared';

interface Props {
  repo: Repo;
  index: number;
  isSelected: boolean;
  isDescribing?: boolean;
  currentPromptVersion: number;
  onClick: () => void;
  // When provided, replaces the footer's stars metric.
  rightExtra?: React.ReactNode;
}

export function RepoCardMasonry({
  repo,
  index,
  isSelected,
  isDescribing,
  currentPromptVersion,
  onClick,
  rightExtra,
}: Props) {
  const { isStale, showUndescribed, displayTags, topicIcons, effectiveCategory, owner } =
    deriveRowState(repo, currentPromptVersion);
  const what = repo.llm_what ?? repo.description;

  return (
    <div
      onClick={onClick}
      role="button"
      aria-selected={isSelected}
      data-masonry-idx={index}
      style={{
        breakInside: 'avoid',
        pageBreakInside: 'avoid',
      }}
      className={`relative w-full cursor-pointer rounded-lg p-3.5 mb-3.5 transition-colors ${
        isSelected
          ? 'bg-elevated border border-accent/60 shadow-[inset_2px_0_0_var(--color-accent),0_0_0_1px_rgba(113,112,255,0.15)]'
          : 'bg-surface border border-border hover:border-[rgba(255,255,255,0.14)]'
      }`}
    >
      {/* Index pill — only on selected */}
      {isSelected && (
        <span className="absolute top-3 right-3 font-mono text-[9.5px] text-accent bg-accent/10 px-1.5 py-px rounded-sm tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
      )}

      <div className="flex flex-col gap-2">
        {/* Head */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar src={repo.owner_avatar_url} login={owner} size={28} />
          <span className="text-[12.5px] font-mono text-accent truncate flex-1 min-w-0">
            {repo.full_name}
          </span>
          {isDescribing && <Spinner title="Describing" />}
        </div>

        {/* Status chips row (only when present) */}
        {(repo.watching || isStale || (showUndescribed && !isDescribing) || isDescribing) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {repo.watching && <Chip tone="accent" prefix={<EyeIcon />}>watching</Chip>}
            {isStale && <Chip tone="warn">stale</Chip>}
            {isDescribing ? (
              <span className="text-[11px] text-accent">describing…</span>
            ) : showUndescribed ? (
              <span className="text-[11px] text-faint">undescribed — press d</span>
            ) : null}
          </div>
        )}

        {/* What */}
        {isDescribing && !what ? (
          <div className="text-[13.5px] text-muted italic font-normal leading-snug">
            generating description…
          </div>
        ) : what ? (
          <div className="text-[13.5px] text-ink leading-snug font-medium">
            {what}
          </div>
        ) : !showUndescribed ? (
          <div className="text-[13.5px] text-faint italic font-normal leading-snug">
            no description yet
          </div>
        ) : null}

        {/* Why */}
        {repo.llm_why && (
          <div className="text-xs text-muted italic leading-snug">
            {repo.llm_why}
          </div>
        )}

        {/* Use case */}
        {repo.llm_use_case && (
          <div className="text-[11.5px] text-dim leading-snug pt-1.5 border-t border-dashed border-border-subtle">
            <span className="text-faint mr-1">→</span>
            {repo.llm_use_case}
          </div>
        )}

        {/* Footer: chips + stars */}
        <div className="flex items-end justify-between gap-2 mt-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {repo.language && (
              <Chip tone="default" prefix={<LangDot language={repo.language} size={7} />}>
                {repo.language}
              </Chip>
            )}
            {topicIcons.map((icon) => (
              <Chip key={icon} tone="default"><TopicIcon name={icon} /></Chip>
            ))}
            {displayTags.slice(0, 4).map((tag) => (
              <Chip key={tag} tone="default" className="truncate max-w-[120px]">
                <span className="truncate">{tag}</span>
              </Chip>
            ))}
            {effectiveCategory && (
              <Chip tone="dim">
                {effectiveCategory}
                {repo.category_locked && <span className="ml-1" title="Category locked">🔒</span>}
              </Chip>
            )}
          </div>
          {rightExtra ? (
            <div className="flex items-center gap-2 flex-shrink-0">{rightExtra}</div>
          ) : repo.stars_count != null ? (
            <span className="font-mono text-[11px] text-faint inline-flex items-center gap-1 tabular-nums flex-shrink-0">
              <StarIcon size={9} />
              {formatStars(repo.stars_count)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
