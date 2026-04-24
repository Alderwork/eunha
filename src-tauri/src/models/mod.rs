use serde::{Deserialize, Serialize};

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
