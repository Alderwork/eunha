export interface Repo {
  id: string;
  full_name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars_count: number | null;
  topics: string | null;
  added_at: string | null;
  source: string;
  llm_summary: string | null;
  llm_what: string | null;
  llm_why: string | null;
  llm_use_case: string | null;
  llm_category: string | null;
  llm_tags: string | null;
  llm_generated_at: string | null;
  prompt_version: number | null;
  user_notes: string | null;
  user_category: string | null;
  watching: boolean;
  category_locked: boolean;
  owner_avatar_url: string | null;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface AppConstants {
  current_prompt_version: number;
}

export interface ImportProgress {
  page: number;
  total_pages: number | null;
  repos_fetched: number;
}

export interface ImportResult {
  imported: number;
  already_exists: number;
  pages_fetched: number;
  cancelled: boolean;
  error: string | null;
}

export interface BatchDescribeResult {
  described: number;
  failed: number;
  total: number;
}

export interface BatchDescribeProgress {
  current: number;
  total: number;
  repo_id: string;
  failed: number;
}

export interface WatchedRepoEntry {
  repo: Repo;
  unread: number;
}

export interface LatestRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
}

export type Provider = 'openai' | 'anthropic' | 'ollama';

export interface TrendingRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stars_today: number | null;
  total_stars: number | null;
  url: string;
}

export interface FeedGroup {
  repo_full_name: string;
  repo_description: string | null;
  repo_url: string;
  repo_language: string | null;
  repo_stars_count: number | null;
  repo_topics: string | null;
  starred_by: string[];
  latest_starred_at: string;
  in_library: boolean;
}

export interface FeedFetchProgress {
  phase: string;
  current_user: string | null;
  users_done: number;
  users_total: number;
  items_found: number;
}

export interface FeedFetchResult {
  items_found: number;
  users_checked: number;
  users_total: number;
  failed_users: number;
  cancelled: boolean;
  error: string | null;
}
