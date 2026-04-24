use crate::commands::describe::{repo_from_row, CURRENT_PROMPT_VERSION};
use crate::db::DbState;
use crate::models::{AppConstants, CategoryCount, Repo};
use rusqlite::params;
use tauri::State;

const REPO_SELECT: &str =
    "SELECT id, full_name, description, url, language, stars_count, topics, added_at, source,
            llm_summary, llm_what, llm_why, llm_use_case, llm_category, llm_tags, llm_generated_at, prompt_version,
            user_notes, user_category FROM repos";

#[tauri::command]
pub fn list_repos(
    query: Option<String>,
    category: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Repo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let has_query = query.as_deref().map(|q| !q.trim().is_empty()).unwrap_or(false);
    let has_category = category.as_deref().map(|c| !c.is_empty()).unwrap_or(false);

    if has_query {
        let q = query.as_deref().unwrap().trim();
        let fts_result = try_fts_search(&conn, q, category.as_deref().filter(|_| has_category));
        match fts_result {
            Ok(repos) => Ok(repos),
            Err(_) => like_search(&conn, q, category.as_deref().filter(|_| has_category))
                .map_err(|e| e.to_string()),
        }
    } else if has_category {
        let cat = category.as_deref().unwrap();
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE llm_category = ?1 OR user_category = ?1 ORDER BY full_name ASC",
                REPO_SELECT
            ))
            .map_err(|e| e.to_string())?;
        let repos: Vec<Repo> = stmt
            .query_map(params![cat], repo_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    } else {
        let mut stmt = conn
            .prepare(&format!("{} ORDER BY full_name ASC", REPO_SELECT))
            .map_err(|e| e.to_string())?;
        let repos: Vec<Repo> = stmt
            .query_map([], repo_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    }
}

fn try_fts_search(
    conn: &rusqlite::Connection,
    query: &str,
    category: Option<&str>,
) -> rusqlite::Result<Vec<Repo>> {
    let fts_query = format!("{}*", query.replace('"', "\"\""));

    if let Some(cat) = category {
        let mut stmt = conn.prepare(&format!(
            "SELECT repos.id, repos.full_name, repos.description, repos.url, repos.language,
                    repos.stars_count, repos.topics, repos.added_at, repos.source,
                    repos.llm_summary, repos.llm_what, repos.llm_why, repos.llm_use_case,
                    repos.llm_category, repos.llm_tags, repos.llm_generated_at, repos.prompt_version,
                    repos.user_notes, repos.user_category
             FROM repos JOIN repos_fts ON repos.rowid = repos_fts.rowid
             WHERE repos_fts MATCH ?1 AND (repos.llm_category = ?2 OR repos.user_category = ?2)
             ORDER BY repos.full_name ASC"
        ))?;
        let repos: Vec<Repo> = stmt
            .query_map(params![fts_query, cat], repo_from_row)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    } else {
        let mut stmt = conn.prepare(&format!(
            "SELECT repos.id, repos.full_name, repos.description, repos.url, repos.language,
                    repos.stars_count, repos.topics, repos.added_at, repos.source,
                    repos.llm_summary, repos.llm_what, repos.llm_why, repos.llm_use_case,
                    repos.llm_category, repos.llm_tags, repos.llm_generated_at, repos.prompt_version,
                    repos.user_notes, repos.user_category
             FROM repos JOIN repos_fts ON repos.rowid = repos_fts.rowid
             WHERE repos_fts MATCH ?1
             ORDER BY repos.full_name ASC"
        ))?;
        let repos: Vec<Repo> = stmt
            .query_map(params![fts_query], repo_from_row)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    }
}

fn like_search(
    conn: &rusqlite::Connection,
    query: &str,
    category: Option<&str>,
) -> rusqlite::Result<Vec<Repo>> {
    let pattern = format!("%{}%", query);
    if let Some(cat) = category {
        let mut stmt = conn.prepare(&format!(
            "{} WHERE (full_name LIKE ?1 OR llm_what LIKE ?1 OR llm_why LIKE ?1 OR description LIKE ?1)
               AND (llm_category = ?2 OR user_category = ?2)
             ORDER BY full_name ASC",
            REPO_SELECT
        ))?;
        let repos: Vec<Repo> = stmt
            .query_map(params![pattern, cat], repo_from_row)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    } else {
        let mut stmt = conn.prepare(&format!(
            "{} WHERE full_name LIKE ?1 OR llm_what LIKE ?1 OR llm_why LIKE ?1 OR description LIKE ?1
             ORDER BY full_name ASC",
            REPO_SELECT
        ))?;
        let repos: Vec<Repo> = stmt
            .query_map(params![pattern], repo_from_row)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    }
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
        &format!("{} WHERE id = ?1", REPO_SELECT),
        params![repo_id],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read updated repo: {e}"))
}

#[tauri::command]
pub fn get_app_constants() -> AppConstants {
    AppConstants {
        current_prompt_version: CURRENT_PROMPT_VERSION,
    }
}
