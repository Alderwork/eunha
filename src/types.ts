export interface Collection {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  is_read_later: boolean;
  repo_count: number;
  created_at: string | null;
}

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
  starred_at?: string | null;
  user_tags?: string[];
  purposes?: string[];
  classification_status?: string;
}

export interface Purpose { id: number; name: string; is_default: boolean }
export interface UserTag { id: number; name: string }
export interface ClassificationSuggestion { repo: Repo; suggested_tags: string[]; suggested_purposes: string[] }

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

export interface SyncStarsResult {
  added: number;
  removed: number;
  removed_names: string[];
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

export interface DigestItem {
  repo: Repo;
  reason: 'release' | 'undescribed' | 'forgotten' | 'serendipity';
  reason_detail: string;
  action: string | null;
}

export interface DigestBatch {
  batch_date: string;
  items: DigestItem[];
}

export interface SimilarRepo {
  repo: Repo;
  similarity_score: number;
}

export interface ContributionData {
  good_first_issue_count: number;
  open_pr_count: number;
  has_contributing_md: boolean;
  github_url: string;
}

export interface GitStatusSummary {
  branch: string | null;
  head_sha: string | null;
  changed_files: string[];
  staged: number;
  unstaged: number;
  untracked: number;
  clean: boolean;
}

export interface Workspace {
  id: string;
  project_id: string;
  local_path: string;
  default_branch: string | null;
  current_branch: string | null;
  head_sha: string | null;
  git_status: GitStatusSummary;
  last_scanned_at: string | null;
}

export interface Project {
  id: string;
  github_full_name: string | null;
  remote_url: string | null;
  display_name: string;
  description: string | null;
  default_branch: string | null;
  role_mode: 'contributor' | 'maintainer' | 'owner';
  created_at: string;
  updated_at: string;
  workspace: Workspace | null;
}

export interface ProjectDraft {
  github_full_name: string | null;
  remote_url: string | null;
  display_name: string;
  description: string | null;
  local_path: string | null;
  clone_suggestion: string | null;
  workspace_status: GitStatusSummary | null;
  default_branch: string | null;
  warnings: string[];
}

export interface SourceDocument {
  source: string;
  content: string;
}

export interface DetectedTool {
  source: string;
  name: string;
  commands: string[];
}

export interface BriefEvidence {
  source: string;
  excerpt: string;
}

export interface ContributionBrief {
  project_definition: string;
  contributor_entry_points: string[];
  setup_requirements: string[];
  verification_commands: string[];
  contribution_rules: string[];
  maturity_signals: string[];
  cautions: string[];
  evidence: BriefEvidence[];
  unknowns: string[];
}

export interface ProjectSnapshot {
  project_id: string;
  commit_sha: string | null;
  readme: string | null;
  contributing: string | null;
  code_of_conduct: string | null;
  templates: SourceDocument[];
  detected_tools: DetectedTool[];
  evidence: BriefEvidence[];
  contribution_brief: ContributionBrief | null;
  collection_errors: string[];
  captured_at: string;
  generated_at: string | null;
}

export interface ProjectIssue {
  github_issue_id: number;
  project_id: string;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: string[];
  state: string;
  author_login: string | null;
  is_pull_request: boolean;
  comments_count: number;
  updated_at: string | null;
}

export interface ProjectContribution {
  snapshot: ProjectSnapshot;
  issues: ProjectIssue[];
}
