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
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub is_read_later: bool,
    pub repo_count: i64,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub id: String,
    pub full_name: String,
    pub description: Option<String>,
    pub url: String,
    pub language: Option<String>,
    pub stars_count: Option<i64>,
    pub topics: Option<String>,
    pub added_at: Option<String>,
    pub source: String,
    pub llm_summary: Option<String>,
    pub llm_what: Option<String>,
    pub llm_why: Option<String>,
    pub llm_use_case: Option<String>,
    pub llm_category: Option<String>,
    pub llm_tags: Option<String>,
    pub llm_generated_at: Option<String>,
    pub prompt_version: Option<i64>,
    pub user_notes: Option<String>,
    pub user_category: Option<String>,
    pub watching: bool,
    pub category_locked: bool,
    pub owner_avatar_url: Option<String>,
    /// Timestamp supplied by GitHub's starred API, not Eunha's import time.
    pub starred_at: Option<String>,
    pub user_tags: Vec<String>,
    pub purposes: Vec<String>,
    pub classification_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTag { pub id: i64, pub name: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Purpose { pub id: i64, pub name: String, pub is_default: bool }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationSuggestion {
    pub repo: Repo,
    pub suggested_tags: Vec<String>,
    pub suggested_purposes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedRepoEntry {
    pub repo: Repo,
    pub unread: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestRelease {
    pub tag_name: String,
    pub published_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResult {
    pub what: String,
    pub why: String,
    pub use_case: String,
    pub category: String,
    pub tags: Vec<String>,
    pub raw_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryCount {
    pub category: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConstants {
    pub current_prompt_version: u32,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub page: u32,
    pub total_pages: Option<u32>,
    pub repos_fetched: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: u32,
    pub already_exists: u32,
    pub pages_fetched: u32,
    pub cancelled: bool,
    pub error: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DescribeProgress {
    pub current: u32,
    pub total: u32,
    pub repo_id: String,
    pub failed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDescribeResult {
    pub described: u32,
    pub failed: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedGroup {
    pub repo_full_name: String,
    pub repo_description: Option<String>,
    pub repo_url: String,
    pub repo_language: Option<String>,
    pub repo_stars_count: Option<i64>,
    pub repo_topics: Option<String>,
    pub starred_by: Vec<String>,
    pub latest_starred_at: String,
    pub in_library: bool,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedFetchProgress {
    pub phase: String,
    pub current_user: Option<String>,
    pub users_done: u32,
    pub users_total: u32,
    pub items_found: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedFetchResult {
    pub items_found: u32,
    pub users_checked: u32,
    pub users_total: u32,
    pub failed_users: u32,
    pub cancelled: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigestItem {
    pub repo: Repo,
    pub reason: String,
    pub reason_detail: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigestBatch {
    pub batch_date: String,
    pub items: Vec<DigestItem>,
}
