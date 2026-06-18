import { Repo } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Chip } from '../ui/Chip';
import { Spinner } from '../ui/Spinner';
import { DENSE_COMPACT_HEIGHT, DENSE_SELECTED_HEIGHT } from '../../lib/visuals';
import {
  deriveRowState,
  EyeIcon,
  formatStars,
  LangDot,
  StarIcon,
} from './_shared';

interface Props {
  repo: Repo;
  isSelected: boolean;
  isDescribing?: boolean;
  currentPromptVersion: number;
  onClick: () => void;
  // When provided, replaces the default right-rail (lang+stars+category).
  rightExtra?: React.ReactNode;
}

export function RepoRowDense({ repo, isSelected, isDescribing, currentPromptVersion, onClick, rightExtra }: Props) {
  const { isLibraryItem, isStale, showUndescribed, displayTags, effectiveCategory, owner } =
    deriveRowState(repo, currentPromptVersion);

  const inlineSummary = repo.llm_what ?? repo.description;
  const stars = repo.stars_count;

  if (isSelected) {
    return (
      <div
        onClick={onClick}
        style={{ height: DENSE_SELECTED_HEIGHT }}
        className="grid items-center gap-x-2.5 cursor-pointer bg-elevated border-b border-border-subtle px-0 pr-4"
        role="row"
        aria-selected="true"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: '3px 22px auto minmax(0,1fr) auto auto',
            gridTemplateRows: 'auto auto',
            columnGap: '10px',
            rowGap: '4px',
            alignItems: 'center',
            paddingLeft: 0,
            paddingRight: '4px',
          }}
        >
          {/* Selection bar — spans both rows */}
          <div className="bg-accent" style={{ gridRow: '1 / 3', height: '100%', width: '3px' }} />

          {/* Avatar — vertically centered across both rows */}
          <div style={{ gridRow: '1 / 3', alignSelf: 'center' }}>
            <Avatar src={repo.owner_avatar_url} login={owner} size={22} />
          </div>

          {/* Top row: name + status chips */}
          <div className="flex items-center gap-2 min-w-0" style={{ paddingTop: '6px' }}>
            <span className="text-[12.5px] font-mono text-accent truncate tracking-tight">
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

          {/* what */}
          <div
            className="text-[12.5px] text-ink leading-snug min-w-0 truncate"
            style={{ paddingTop: '6px' }}
          >
            {inlineSummary || (
              <span className="text-faint italic">no description yet</span>
            )}
          </div>

          {/* right rail — meta + category, or rightExtra override */}
          {rightExtra ? (
            <div
              className="flex items-center justify-end gap-2 flex-shrink-0"
              style={{ gridColumn: '5 / 7', paddingTop: '6px' }}
            >
              {rightExtra}
            </div>
          ) : (
            <>
              {/* meta: lang + stars */}
              <div className="flex items-center gap-2.5 flex-shrink-0" style={{ paddingTop: '6px' }}>
                {repo.language && (
                  <span className="text-[11px] text-dim flex items-center gap-1.5">
                    <LangDot language={repo.language} size={7} />
                    {repo.language}
                  </span>
                )}
                {stars != null && (
                  <span className="text-[10.5px] font-mono text-faint inline-flex items-center gap-1 tabular-nums">
                    <StarIcon size={9} />
                    {formatStars(stars)}
                  </span>
                )}
              </div>

              {/* category */}
              <div
                className="text-[11px] text-faint pl-2 border-l border-border-subtle"
                style={{ paddingTop: '6px' }}
              >
                {effectiveCategory ?? ''}
              </div>
            </>
          )}

          {/* Bottom row: tag chips */}
          <div
            className="flex items-center gap-1.5 overflow-hidden min-w-0"
            style={{ gridColumn: '3 / 7' }}
          >
            {displayTags.slice(0, 5).map((tag) => (
              <Chip key={tag} tone="default" className="truncate max-w-[140px]">
                <span className="truncate">{tag}</span>
              </Chip>
            ))}
            {displayTags.length === 0 && isLibraryItem && (
              <span className="text-[10.5px] text-faint">no tags</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Compact: single 38px line
  return (
    <div
      onClick={onClick}
      style={{ height: DENSE_COMPACT_HEIGHT }}
      className="grid items-center cursor-pointer hover:bg-surface border-b border-border-subtle pr-4"
      role="row"
    >
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: '3px 22px auto minmax(0,1fr) auto auto',
          columnGap: '10px',
        }}
      >
        <div className="h-full" style={{ width: '3px' }} />
        <Avatar src={repo.owner_avatar_url} login={owner} size={22} />

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[12.5px] font-mono text-accent truncate tracking-tight">
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

        <span className="text-[12.5px] text-muted truncate min-w-0">
          {inlineSummary ?? ''}
        </span>

        {rightExtra ? (
          <div
            className="flex items-center justify-end gap-2 flex-shrink-0"
            style={{ gridColumn: '5 / 7' }}
          >
            {rightExtra}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 flex-shrink-0 text-faint">
              {repo.language && (
                <span className="text-[11px] text-dim flex items-center gap-1.5">
                  <LangDot language={repo.language} size={7} />
                  {repo.language}
                </span>
              )}
              {stars != null && (
                <span className="text-[10.5px] font-mono text-faint inline-flex items-center gap-1 tabular-nums">
                  <StarIcon size={9} />
                  {formatStars(stars)}
                </span>
              )}
            </div>

            <div className="text-[11px] text-faint pl-2 border-l border-border-subtle">
              {effectiveCategory ?? ''}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
