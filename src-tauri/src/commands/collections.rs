use crate::commands::describe::{repo_from_row, REPO_SELECT};
use crate::db::DbState;
use crate::models::{Collection, Repo};
use rusqlite::params;
use tauri::State;

fn row_to_collection(row: &rusqlite::Row<'_>) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        icon: row.get(3)?,
        sort_order: row.get(4)?,
        is_read_later: row.get::<_, i64>(5)? != 0,
        repo_count: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/// Ensure the Read Later singleton collection exists. Called once at app start.
fn ensure_read_later_collection(conn: &rusqlite::Connection) -> rusqlite::Result<i64> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM collections WHERE is_read_later = 1",
            [],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = existing {
        Ok(id)
    } else {
        conn.execute(
            "INSERT INTO collections (name, icon, is_read_later, sort_order)
             VALUES ('Read Later', '📌', 1, 0)",
            [],
        )?;
        Ok(conn.last_insert_rowid())
    }
}

#[tauri::command]
pub fn create_collection(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let next_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collections WHERE is_read_later = 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(1);
    conn.execute(
        "INSERT INTO collections (name, description, icon, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![name, description, icon, next_order],
    )
    .map_err(|e| format!("Failed to create collection: {e}"))?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn list_collections(state: State<'_, DbState>) -> Result<Vec<Collection>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    ensure_read_later_collection(&conn).ok();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.description, c.icon, c.sort_order, c.is_read_later,
                    COALESCE((SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id), 0) AS repo_count,
                    c.created_at
             FROM collections c
             ORDER BY c.is_read_later DESC, c.sort_order ASC, c.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let collections: Vec<Collection> = stmt
        .query_map([], row_to_collection)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(collections)
}

#[tauri::command]
pub fn rename_collection(id: i64, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET name = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| format!("Failed to rename collection: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_collection(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM collections WHERE id = ?1 AND is_read_later = 0", params![id])
        .map_err(|e| format!("Failed to delete collection: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn add_repo_to_collection(
    collection_id: i64,
    repo_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO collection_items (collection_id, repo_id) VALUES (?1, ?2)",
        params![collection_id, repo_id],
    )
    .map_err(|e| format!("Failed to add repo to collection: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn remove_repo_from_collection(
    collection_id: i64,
    repo_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM collection_items WHERE collection_id = ?1 AND repo_id = ?2",
        params![collection_id, repo_id],
    )
    .map_err(|e| format!("Failed to remove repo from collection: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_collection_repos(
    collection_id: i64,
    query: Option<String>,
    category: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Repo>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let mut conditions = vec![
        "r.id IN (SELECT ci.repo_id FROM collection_items ci WHERE ci.collection_id = ?1)"
            .to_string(),
    ];

    let mut param_idx = 2u32;

    if let Some(ref q) = query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            conditions.push(format!(
                "(r.full_name LIKE ?{idx} OR r.llm_what LIKE ?{idx} OR r.llm_why LIKE ?{idx} OR r.description LIKE ?{idx})",
                idx = param_idx
            ));
            param_idx += 1;
        }
    }

    if let Some(ref cat) = category {
        if !cat.is_empty() {
            conditions.push(format!(
                "(r.llm_category = ?{idx} OR r.user_category = ?{idx})",
                idx = param_idx
            ));
        }
    }

    let where_clause = format!("WHERE {}", conditions.join(" AND "));
    let sql = format!(
        "{} r {} ORDER BY r.full_name ASC",
        REPO_SELECT.replace("repos.id", "r.id").replace("FROM repos", "FROM repos r"),
        where_clause
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // Bind collection_id at position 1
    let mut remaining_params: Vec<Box<dyn rusqlite::types::ToSql>> =
        vec![Box::new(collection_id)];

    if let Some(ref q) = query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            remaining_params.push(Box::new(format!("%{}%", trimmed)));
        }
    }
    if let Some(ref cat) = category {
        if !cat.is_empty() {
            remaining_params.push(Box::new(cat.clone()));
        }
    }

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        remaining_params.iter().map(|p| p.as_ref()).collect();

    let repos: Vec<Repo> = stmt
        .query_map(param_refs.as_slice(), repo_from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(repos)
}

#[tauri::command]
pub fn get_repo_collections(
    repo_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<Collection>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name, c.description, c.icon, c.sort_order, c.is_read_later,
                    COALESCE((SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id), 0) AS repo_count,
                    c.created_at
             FROM collections c
             JOIN collection_items ci ON ci.collection_id = c.id
             WHERE ci.repo_id = ?1
             ORDER BY c.is_read_later DESC, c.sort_order ASC, c.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let collections: Vec<Collection> = stmt
        .query_map(params![repo_id], row_to_collection)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(collections)
}
