import { Repo } from '../../types';
import { getLanguageColor, getTopicIcons, TopicIconName } from '../../lib/visuals';

export function TopicIcon({ name }: { name: TopicIconName }) {
  const cls = 'text-faint flex-shrink-0';
  switch (name) {
    case 'terminal':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case 'globe':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'smartphone':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      );
    case 'package':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case 'layers':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case 'book':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.88 5.76L20 10l-5.76 1.88L12 18l-1.88-5.76L4 10l5.76-1.88z" />
        </svg>
      );
    case 'database':
      return (
        <svg className={cls} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      );
  }
}

export function LangDot({ language, size }: { language: string | null; size: number }) {
  if (!language) return null;
  return (
    <span
      title={language}
      style={{ width: size, height: size, background: getLanguageColor(language) }}
      className="rounded-full flex-shrink-0 inline-block"
    />
  );
}

export function EyeIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function StarIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export function formatStars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

export interface RowDerived {
  isLibraryItem: boolean;
  isStale: boolean;
  showUndescribed: boolean;
  topicTags: string[];
  llmTags: string[];
  displayTags: string[];
  topicIcons: TopicIconName[];
  effectiveCategory: string | null;
  owner: string;
}

export function deriveRowState(repo: Repo, currentPromptVersion: number): RowDerived {
  const isLibraryItem = repo.source === 'starred' || repo.source === 'manual';
  const isStale =
    isLibraryItem &&
    repo.llm_summary !== null &&
    repo.prompt_version !== null &&
    repo.prompt_version < currentPromptVersion;

  const topicTags: string[] = repo.topics ? JSON.parse(repo.topics) : [];
  const llmTags: string[] = repo.llm_tags ? JSON.parse(repo.llm_tags) : [];
  const displayTags = topicTags.length > 0 ? topicTags : llmTags;
  const topicIcons = getTopicIcons(topicTags, llmTags);
  const effectiveCategory = repo.user_category ?? repo.llm_category;
  const owner = repo.full_name.split('/')[0];

  return {
    isLibraryItem,
    isStale,
    showUndescribed: isLibraryItem && !repo.llm_summary,
    topicTags,
    llmTags,
    displayTags,
    topicIcons,
    effectiveCategory,
    owner,
  };
}
