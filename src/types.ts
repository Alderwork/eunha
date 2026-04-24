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

export type Provider = 'openai' | 'anthropic' | 'ollama';
