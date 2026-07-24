use tauri::State;

use crate::db::DbState;

#[tauri::command]
pub fn record_engagement(
    repo_id: String,
    event_type: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO repo_engagement (repo_id, event_type, event_count, last_event_at)
         VALUES (?1, ?2, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(repo_id, event_type)
         DO UPDATE SET event_count = event_count + 1, last_event_at = CURRENT_TIMESTAMP",
        rusqlite::params![repo_id, event_type],
    )
    .map_err(|e| format!("Failed to record engagement: {e}"))?;
    Ok(())
}
