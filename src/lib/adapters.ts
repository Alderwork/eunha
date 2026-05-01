import { Repo, FeedGroup } from '../types';
import { TrendingRepo } from '../components/TrendingView';

function ownerAvatarUrl(fullName: string): string {
  const owner = fullName.split('/')[0];
  return `https://github.com/${owner}.png?size=80`;
}

export function feedGroupToRepo(item: FeedGroup): Repo {
  return {
    id: item.repo_full_name,
    full_name: item.repo_full_name,
    description: item.repo_description,
    url: item.repo_url,
    language: item.repo_language,
    stars_count: item.repo_stars_count,
    topics: item.repo_topics,
    added_at: null,
    source: 'feed',
    llm_summary: null,
    llm_what: null,
    llm_why: null,
    llm_use_case: null,
    llm_category: null,
    llm_tags: null,
    llm_generated_at: null,
    prompt_version: null,
    user_notes: null,
    user_category: null,
    watching: false,
    category_locked: false,
    owner_avatar_url: ownerAvatarUrl(item.repo_full_name),
  };
}

export function trendingRepoToRepo(item: TrendingRepo): Repo {
  return {
    id: item.full_name,
    full_name: item.full_name,
    description: item.description,
    url: item.url,
    language: item.language,
    stars_count: item.total_stars,
    topics: null,
    added_at: null,
    source: 'trending',
    llm_summary: null,
    llm_what: null,
    llm_why: null,
    llm_use_case: null,
    llm_category: null,
    llm_tags: null,
    llm_generated_at: null,
    prompt_version: null,
    user_notes: null,
    user_category: null,
    watching: false,
    category_locked: false,
    owner_avatar_url: ownerAvatarUrl(item.full_name),
  };
}
