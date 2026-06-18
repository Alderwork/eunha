import { Repo } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Chip } from '../ui/Chip';
import { Spinner } from '../ui/Spinner';
import { COMFY_HEIGHT } from '../../lib/visuals';
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
  isSelected: boolean;
  isDescribing?: boolean;
  currentPromptVersion: number;
  onClick: () => void;
  // When provided, replaces the default right column (stars + category chip).
  rightExtra?: React.ReactNode;
}

export function RepoRowComfy({ repo, isSelected, isDescribing, currentPromptVersion, onClick, rightExtra }: Props) {
  const { isStale, showUndescribed, displayTags, topicIcons, effectiveCategory, owner } =
    deriveRowState(repo, currentPromptVersion);
  const what = repo.llm_what ?? repo.description;

  return (
    <div
      onClick={onClick}
      style={{ height: COMFY_HEIGHT }}
      className={`grid cursor-pointer transition-colors border-b border-border-subtle ${
        isSelected ? 'bg-elevated' : 'hover:bg-surface'
      }`}
      role="row"
      aria-selected={isSelected}
    >
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: '3px 36px minmax(0,1fr) auto',
          columnGap: '14px',
          paddingRight: '20px',
          paddingTop: '12px',
          paddingBottom: '12px',
          alignItems: 'start',
        }}
      >
        {/* Selection bar */}
        <div
          className={`self-stretch ${isSelected ? 'bg-accent' : 'bg-transparent'}`}
          style={{ width: '3px' }}
        />

        {/* Avatar */}
        <div className="pt-0.5">
          <Avatar src={repo.owner_avatar_url} login={owner} size={36} />
        </div>

        {/* Body */}
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-mono text-accent truncate">
              {repo.full_name}
            </span>
            {isDescribing && <Spinner title="Describing" />}
            {repo.watching && (
              <Chip tone="accent" prefix={<EyeIcon />}>watching</Chip>
            )}
            {isStale && <Chip tone="warn">stale</Chip>}
            {showUndescribed && !isDescribing && (
              <span className="text-xs text-faint flex-shrink-0">undescribed</span>
            )}
            {isDescribing && (
              <span className="text-xs text-accent flex-shrink-0">describing…</span>
            )}
          </div>

          <div
            className="text-[13.5px] text-ink leading-snug font-medium overflow-hidden"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical' as const,
            }}
          >
            {isDescribing && !what ? (
              <span className="text-muted italic font-normal">generating description…</span>
            ) : what ? (
              what
            ) : (
              <span className="text-faint italic font-normal">no description yet</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-hidden">
            {repo.language && (
              <Chip tone="default" prefix={<LangDot language={repo.language} size={7} />}>
                {repo.language}
              </Chip>
            )}
            {topicIcons.map((icon) => (
              <Chip key={icon} tone="default"><TopicIcon name={icon} /></Chip>
            ))}
            {displayTags.slice(0, 4).map((tag) => (
              <Chip key={tag} tone="default" className="truncate max-w-[140px]">
                <span className="truncate">{tag}</span>
              </Chip>
            ))}
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {rightExtra ? (
            rightExtra
          ) : (
            <>
              {repo.stars_count != null && (
                <Chip tone="mono" prefix={<StarIcon size={10} />}>
                  {formatStars(repo.stars_count)}
                </Chip>
              )}
              {effectiveCategory && (
                <Chip tone="dim">
                  {effectiveCategory}
                  {repo.category_locked && <span className="ml-1" title="Category locked">🔒</span>}
                </Chip>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
