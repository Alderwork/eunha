use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitStatusSummary {
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub changed_files: Vec<String>,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub project_id: String,
    pub local_path: String,
    pub default_branch: Option<String>,
    pub current_branch: Option<String>,
    pub head_sha: Option<String>,
    pub git_status: GitStatusSummary,
    pub last_scanned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub github_full_name: Option<String>,
    pub remote_url: Option<String>,
    pub display_name: String,
    pub description: Option<String>,
    pub default_branch: Option<String>,
    pub role_mode: String,
    pub created_at: String,
    pub updated_at: String,
    pub workspace: Option<Workspace>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDraft {
    pub github_full_name: Option<String>,
    pub remote_url: Option<String>,
    pub display_name: String,
    pub description: Option<String>,
    pub local_path: Option<String>,
    pub clone_suggestion: Option<String>,
    pub workspace_status: Option<GitStatusSummary>,
    pub default_branch: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceDocument {
    pub source: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedTool {
    pub source: String,
    pub name: String,
    pub commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefEvidence {
    pub source: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionBrief {
    pub project_definition: String,
    pub contributor_entry_points: Vec<String>,
    pub setup_requirements: Vec<String>,
    pub verification_commands: Vec<String>,
    pub contribution_rules: Vec<String>,
    pub maturity_signals: Vec<String>,
    pub cautions: Vec<String>,
    pub evidence: Vec<BriefEvidence>,
    pub unknowns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSnapshot {
    pub project_id: String,
    pub commit_sha: Option<String>,
    pub readme: Option<String>,
    pub contributing: Option<String>,
    pub code_of_conduct: Option<String>,
    pub templates: Vec<SourceDocument>,
    pub detected_tools: Vec<DetectedTool>,
    pub evidence: Vec<BriefEvidence>,
    pub contribution_brief: Option<ContributionBrief>,
    pub collection_errors: Vec<String>,
    pub captured_at: String,
    pub generated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectIssue {
    pub github_issue_id: i64,
    pub project_id: String,
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub html_url: String,
    pub labels: Vec<String>,
    pub state: String,
    pub author_login: Option<String>,
    pub is_pull_request: bool,
    pub comments_count: i64,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContribution {
    pub snapshot: ProjectSnapshot,
    pub issues: Vec<ProjectIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionTask {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub github_full_name: Option<String>,
    pub issue_id: Option<i64>,
    pub issue_number: Option<i64>,
    pub issue_url: Option<String>,
    pub workspace_id: Option<String>,
    pub title: String,
    pub status: String,
    pub branch_name: Option<String>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentCommit {
    pub sha: String,
    pub summary: String,
    pub author: String,
    pub authored_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskGitContext {
    pub status: GitStatusSummary,
    pub diff_stat: String,
    pub staged_diff_stat: String,
    pub recent_commits: Vec<RecentCommit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskWorkspace {
    pub task: ContributionTask,
    pub workspace: Option<Workspace>,
    pub git: Option<TaskGitContext>,
    pub issue_body: Option<String>,
    pub verification_commands: Vec<String>,
}
