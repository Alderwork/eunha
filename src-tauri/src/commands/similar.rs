use crate::commands::describe::{repo_from_row, REPO_SELECT};
use crate::db::DbState;
use crate::models::Repo;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct SimilarRepo {
    pub repo: Repo,
    pub similarity_score: f64,
}

/// Compute similarity between two repos using category, tags, and what-field word overlap.
fn compute_similarity(
    target_cat: &Option<String>,
    target_tags: &[String],
    target_what: &str,
    candidate_cat: &Option<String>,
    candidate_tags: &[String],
    candidate_what: &str,
) -> f64 {
    let mut score = 0.0;

    // Category match: +5
    if let (Some(tc), Some(cc)) = (target_cat, candidate_cat) {
        if tc == cc {
            score += 5.0;
        }
    }

    // Tag overlap: +3 per matching tag
    for tt in target_tags {
        if candidate_tags.iter().any(|ct| ct == tt) {
            score += 3.0;
        }
    }

    // Word overlap in llm_what: +1 per shared word (min 4 chars, exclude stopwords)
    let stopwords = [
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
        "shall", "should", "may", "might", "for", "to", "of", "in", "on", "at",
        "by", "with", "from", "as", "into", "about", "like", "that", "this",
        "and", "or", "but", "not", "no", "it", "its", "you", "your",
    ];
    let target_words: Vec<String> = target_what
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| w.len() >= 4 && !stopwords.contains(&w.as_str()))
        .collect();
    let candidate_words: Vec<String> = candidate_what
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| w.len() >= 4 && !stopwords.contains(&w.as_str()))
        .collect();

    for tw in &target_words {
        if candidate_words.iter().any(|cw| cw == tw) {
            score += 1.0;
        }
    }

    score
}

#[tauri::command]
pub fn get_similar_repos(
    repo_id: String,
    limit: Option<u32>,
    state: State<'_, DbState>,
) -> Result<Vec<SimilarRepo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(5) as usize;

    // Fetch target repo data
    let target: Repo = conn
        .query_row(
            &format!("{REPO_SELECT} WHERE id = ?1"),
            params![repo_id],
            repo_from_row,
        )
        .map_err(|e| format!("Target repo not found: {e}"))?;

    let target_tags: Vec<String> = target
        .llm_tags
        .as_deref()
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default();
    let target_what = target.llm_what.as_deref().unwrap_or("");

    // Find candidates with same non-null llm_category, described, excluding self
    let sql = format!(
        "{} r WHERE r.llm_category IS NOT NULL AND r.llm_what IS NOT NULL AND r.id != ?1",
        REPO_SELECT.replace("repos.id", "r.id").replace("FROM repos", "FROM repos r")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let candidates: Vec<Repo> = stmt
        .query_map(params![repo_id], repo_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Score each candidate
    let mut scored: Vec<SimilarRepo> = candidates
        .into_iter()
        .map(|candidate| {
            let candidate_tags: Vec<String> = candidate
                .llm_tags
                .as_deref()
                .and_then(|t| serde_json::from_str(t).ok())
                .unwrap_or_default();
            let candidate_what = candidate.llm_what.as_deref().unwrap_or("");

            let score = compute_similarity(
                &target.llm_category,
                &target_tags,
                target_what,
                &candidate.llm_category,
                &candidate_tags,
                candidate_what,
            );

            SimilarRepo {
                repo: candidate,
                similarity_score: score,
            }
        })
        .filter(|s| s.similarity_score > 0.0)
        .collect();

    // Sort by score descending, take top N
    scored.sort_by(|a, b| {
        b.similarity_score
            .partial_cmp(&a.similarity_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit);

    Ok(scored)
}
