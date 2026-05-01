use crate::commands::describe::{repo_from_row, CURRENT_PROMPT_VERSION, REPO_SELECT};
use crate::db::DbState;
use crate::models::{AppConstants, CategoryCount, Repo};
use rusqlite::params;
use tauri::State;

/// Converts user input into a safe FTS5 query string.
/// AND/OR/NOT are passed through as operators; all other tokens are
/// double-quoted and suffixed with * for safe prefix matching.
fn build_fts_query(input: &str) -> String {
    let operators = ["AND", "OR", "NOT"];
    input
        .split_whitespace()
        .map(|token| {
            if operators.contains(&token) {
                token.to_string()
            } else {
                format!("\"{}\"*", token.replace('"', "\"\""))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Returns a WHERE fragment for ai_status filtering. Uses no table prefix
/// (caller adds one when needed for JOINs).
fn ai_status_clause(status: Option<&str>) -> Option<String> {
    match status {
        Some("undescribed") => Some("llm_summary IS NULL".to_string()),
        Some("stale") => Some(format!(
            "llm_summary IS NOT NULL AND prompt_version < {CURRENT_PROMPT_VERSION}"
        )),
        Some("described") => Some(format!(
            "llm_summary IS NOT NULL AND prompt_version >= {CURRENT_PROMPT_VERSION}"
        )),
        _ => None,
    }
}

#[tauri::command]
pub fn list_repos(
    query: Option<String>,
    category: Option<String>,
    ai_status: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Repo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let has_query = query.as_deref().map(|q| !q.trim().is_empty()).unwrap_or(false);
    let has_category = category.as_deref().map(|c| !c.is_empty()).unwrap_or(false);
    let status = ai_status.as_deref().filter(|s| !s.is_empty());

    if has_query {
        let q = query.as_deref().unwrap().trim();
        let fts_result = try_fts_search(
            &conn,
            q,
            category.as_deref().filter(|_| has_category),
            status,
        );
        match fts_result {
            Ok(repos) => Ok(repos),
            Err(_) => {
                like_search(&conn, q, category.as_deref().filter(|_| has_category), status)
                    .map_err(|e| e.to_string())
            }
        }
    } else {
        let mut conditions: Vec<String> = Vec::new();
        if has_category {
            conditions.push("(llm_category = ?1 OR user_category = ?1)".to_string());
        }
        if let Some(sc) = ai_status_clause(status) {
            conditions.push(sc);
        }

        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };

        if has_category {
            let mut stmt = conn
                .prepare(&format!("{REPO_SELECT} {where_clause} ORDER BY full_name ASC"))
                .map_err(|e| e.to_string())?;
            let repos: Vec<Repo> = stmt
                .query_map(params![category.as_deref().unwrap()], repo_from_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(repos)
        } else {
            let mut stmt = conn
                .prepare(&format!("{REPO_SELECT} {where_clause} ORDER BY full_name ASC"))
                .map_err(|e| e.to_string())?;
            let repos: Vec<Repo> = stmt
                .query_map([], repo_from_row)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(repos)
        }
    }
}

fn try_fts_search(
    conn: &rusqlite::Connection,
    query: &str,
    category: Option<&str>,
    status: Option<&str>,
) -> rusqlite::Result<Vec<Repo>> {
    let fts_query = build_fts_query(query);

    let mut extra_conditions: Vec<String> = Vec::new();
    if let Some(cat) = category {
        extra_conditions.push(format!(
            "(repos.llm_category = '{}' OR repos.user_category = '{}')",
            cat.replace('\'', "''"),
            cat.replace('\'', "''")
        ));
    }
    if let Some(sc) = ai_status_clause(status) {
        // Add repos. prefix for JOIN context
        let prefixed = sc
            .replace("llm_summary", "repos.llm_summary")
            .replace("prompt_version", "repos.prompt_version");
        extra_conditions.push(prefixed);
    }

    let extra_and = if extra_conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", extra_conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT repos.id, repos.full_name, repos.description, repos.url, repos.language,
                repos.stars_count, repos.topics, repos.added_at, repos.source,
                repos.llm_summary, repos.llm_what, repos.llm_why, repos.llm_use_case,
                repos.llm_category, repos.llm_tags, repos.llm_generated_at, repos.prompt_version,
                repos.user_notes, repos.user_category, repos.watching, repos.category_locked
         FROM repos JOIN repos_fts ON repos.rowid = repos_fts.rowid
         WHERE repos_fts MATCH ?1{extra_and}
         ORDER BY repos.full_name ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let repos: Vec<Repo> = stmt
        .query_map(params![fts_query], repo_from_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(repos)
}

fn like_search(
    conn: &rusqlite::Connection,
    query: &str,
    category: Option<&str>,
    status: Option<&str>,
) -> rusqlite::Result<Vec<Repo>> {
    let pattern = format!("%{}%", query);

    let mut conditions = vec![
        "(full_name LIKE ?1 OR llm_what LIKE ?1 OR llm_why LIKE ?1 OR description LIKE ?1)"
            .to_string(),
    ];
    if let Some(cat) = category {
        conditions.push(format!(
            "(llm_category = '{}' OR user_category = '{}')",
            cat.replace('\'', "''"),
            cat.replace('\'', "''")
        ));
    }
    if let Some(sc) = ai_status_clause(status) {
        conditions.push(sc);
    }

    let where_clause = format!("WHERE {}", conditions.join(" AND "));
    let mut stmt = conn.prepare(&format!(
        "{REPO_SELECT} {where_clause} ORDER BY full_name ASC"
    ))?;
    let repos: Vec<Repo> = stmt
        .query_map(params![pattern], repo_from_row)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(repos)
}

#[tauri::command]
pub fn get_categories(state: State<'_, DbState>) -> Result<Vec<CategoryCount>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(user_category, llm_category) as cat, COUNT(*) as cnt
             FROM repos
             WHERE COALESCE(user_category, llm_category) IS NOT NULL
             GROUP BY cat
             ORDER BY cnt DESC",
        )
        .map_err(|e| e.to_string())?;
    let cats: Vec<CategoryCount> = stmt
        .query_map([], |row| {
            Ok(CategoryCount {
                category: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(cats)
}

#[tauri::command]
pub fn update_repo_user_fields(
    repo_id: String,
    user_notes: Option<String>,
    user_category: Option<String>,
    state: State<'_, DbState>,
) -> Result<Repo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE repos SET user_notes = ?1, user_category = ?2 WHERE id = ?3",
        params![user_notes, user_category, repo_id],
    )
    .map_err(|e| format!("DB update failed: {e}"))?;

    conn.query_row(
        &format!("{REPO_SELECT} WHERE id = ?1"),
        params![repo_id],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read updated repo: {e}"))
}

#[tauri::command]
pub fn toggle_watching(repo_id: String, state: State<'_, DbState>) -> Result<Repo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE repos SET watching = CASE WHEN watching = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![repo_id],
    )
    .map_err(|e| format!("DB update failed: {e}"))?;

    conn.query_row(
        &format!("{REPO_SELECT} WHERE id = ?1"),
        params![repo_id],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read updated repo: {e}"))
}

#[tauri::command]
pub fn list_watching(state: State<'_, DbState>) -> Result<Vec<Repo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{REPO_SELECT} WHERE watching = 1 ORDER BY full_name ASC"))
        .map_err(|e| e.to_string())?;
    let repos: Vec<Repo> = stmt
        .query_map([], repo_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(repos)
}

#[tauri::command]
pub fn get_app_constants() -> AppConstants {
    AppConstants {
        current_prompt_version: CURRENT_PROMPT_VERSION,
    }
}

#[tauri::command]
pub fn set_category_lock(
    repo_id: String,
    locked: bool,
    state: State<'_, DbState>,
) -> Result<Repo, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE repos SET category_locked = ?1 WHERE id = ?2",
        params![locked as i64, repo_id],
    )
    .map_err(|e| format!("DB update failed: {e}"))?;

    conn.query_row(
        &format!("{REPO_SELECT} WHERE id = ?1"),
        params![repo_id],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read updated repo: {e}"))
}
