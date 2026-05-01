use crate::db::DbState;
use futures::stream::{self, StreamExt};
use tauri::State;

#[tauri::command]
pub async fn backfill_owner_avatars(state: State<'_, DbState>) -> Result<u32, String> {
    let logins: Vec<String> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT SUBSTR(id, 1, INSTR(id, '/') - 1) FROM repos WHERE owner_avatar_url IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let collected: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };

    if logins.is_empty() {
        return Ok(0);
    }

    let pat = crate::commands::settings::get_secret("github_pat").unwrap_or_default();
    if pat.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::new();
    let pairs: Vec<(String, String)> = stream::iter(logins.into_iter().map(|login| {
        let client = client.clone();
        let pat = pat.clone();
        async move {
            let url = format!("https://api.github.com/users/{}", login);
            let resp = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", pat))
                .header("Accept", "application/vnd.github.v3+json")
                .header("User-Agent", "eunha/1.0")
                .send()
                .await
                .ok()?;
            if !resp.status().is_success() {
                return None;
            }
            let data: serde_json::Value = resp.json().await.ok()?;
            let avatar_url = data["avatar_url"].as_str()?.to_string();
            Some((login, avatar_url))
        }
    }))
    .buffer_unordered(5)
    .collect::<Vec<_>>()
    .await
    .into_iter()
    .flatten()
    .collect();

    let updated = pairs.len() as u32;

    if !pairs.is_empty() {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        for (login, avatar_url) in &pairs {
            conn.execute(
                "UPDATE repos SET owner_avatar_url = ?1 WHERE SUBSTR(id, 1, INSTR(id, '/') - 1) = ?2",
                rusqlite::params![avatar_url, login],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(updated)
}
