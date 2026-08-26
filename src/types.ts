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

export type TaskStatus =
  | 'candidate'
  | 'selected'
  | 'preparing'
  | 'in_progress'
  | 'ready_for_pr'
  | 'submitted'
  | 'blocked'
  | 'abandoned';

export interface ContributionTask {
  id: string;
  project_id: string;
  project_name: string;
  github_full_name: string | null;
  issue_id: number | null;
  issue_number: number | null;
  issue_url: string | null;
  workspace_id: string | null;
  title: string;
  status: TaskStatus;
  branch_name: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RecentCommit {
  sha: string;
  summary: string;
  author: string;
  authored_at: string;
}

export interface TaskGitContext {
  status: GitStatusSummary;
  diff_stat: string;
  staged_diff_stat: string;
  recent_commits: RecentCommit[];
}

export interface TaskWorkspace {
  task: ContributionTask;
  workspace: Workspace | null;
  git: TaskGitContext | null;
  issue_body: string | null;
  verification_commands: string[];
}
