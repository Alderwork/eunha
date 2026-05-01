use crate::db::DbState;
use crate::models::Repo;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

const BACKUP_VERSION: u32 = 6;

#[derive(Debug, serde::Serialize)]
pub struct ImportDbResult {
    pub repos_added: usize,
    pub repos_skipped: usize,
    pub releases_added: usize,
    pub error: Option<String>,
}

fn repo_to_json(repo: &Repo) -> Value {
    json!({
        "id": repo.id,
        "full_name": repo.full_name,
        "description": repo.description,
        "url": repo.url,
        "language": repo.language,
        "stars_count": repo.stars_count,
        "topics": repo.topics,
        "added_at": repo.added_at,
        "source": repo.source,
        "llm_summary": repo.llm_summary,
        "llm_what": repo.llm_what,
        "llm_why": repo.llm_why,
        "llm_use_case": repo.llm_use_case,
        "llm_category": repo.llm_category,
        "llm_tags": repo.llm_tags,
        "llm_generated_at": repo.llm_generated_at,
        "prompt_version": repo.prompt_version,
        "user_notes": repo.user_notes,
        "user_category": repo.user_category,
        "watching": repo.watching,
        "category_locked": repo.category_locked,
    })
}

#[tauri::command]
pub fn export_database(state: State<'_, DbState>) -> Result<Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    let exported_at: String = conn
        .query_row("SELECT datetime('now')", [], |r| r.get(0))
        .unwrap_or_else(|_| "unknown".to_string());

    // --- repos ---
    let mut stmt = conn
        .prepare(
            "SELECT id, full_name, description, url, language, stars_count, topics, added_at, source,
                    llm_summary, llm_what, llm_why, llm_use_case, llm_category, llm_tags,
                    llm_generated_at, prompt_version, user_notes, user_category, watching, category_locked
             FROM repos ORDER BY full_name",
        )
        .map_err(|e| e.to_string())?;

    let repos: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(Repo {
                id: row.get(0)?,
                full_name: row.get(1)?,
                description: row.get(2)?,
                url: row.get(3)?,
                language: row.get(4)?,
                stars_count: row.get(5)?,
                topics: row.get(6)?,
                added_at: row.get(7)?,
                source: row.get(8)?,
                llm_summary: row.get(9)?,
                llm_what: row.get(10)?,
                llm_why: row.get(11)?,
                llm_use_case: row.get(12)?,
                llm_category: row.get(13)?,
                llm_tags: row.get(14)?,
                llm_generated_at: row.get(15)?,
                prompt_version: row.get(16)?,
                user_notes: row.get(17)?,
                user_category: row.get(18)?,
                watching: row.get::<_, i64>(19).unwrap_or(0) != 0,
                category_locked: row.get::<_, i64>(20).unwrap_or(0) != 0,
                owner_avatar_url: None,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|repo| repo_to_json(&repo))
        .collect();

    // --- settings ---
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;

    let settings: Vec<Value> = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok((key, value))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(key, value)| json!({ "key": key, "value": value }))
        .collect();

    // --- releases ---
    let mut stmt = conn
        .prepare(
            "SELECT id, repo_id, tag_name, name, body, html_url, published_at,
                    is_prerelease, fetched_at, read_at
             FROM releases ORDER BY published_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let releases: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let repo_id: String = row.get(1)?;
            let tag_name: String = row.get(2)?;
            let name: Option<String> = row.get(3)?;
            let body: Option<String> = row.get(4)?;
            let html_url: String = row.get(5)?;
            let published_at: String = row.get(6)?;
            let is_prerelease: i64 = row.get(7)?;
            let fetched_at: String = row.get(8)?;
            let read_at: Option<String> = row.get(9)?;
            Ok((
                id,
                repo_id,
                tag_name,
                name,
                body,
                html_url,
                published_at,
                is_prerelease,
                fetched_at,
                read_at,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(
            |(id, repo_id, tag_name, name, body, html_url, published_at, is_prerelease, fetched_at, read_at)| {
                json!({
                    "id": id,
                    "repo_id": repo_id,
                    "tag_name": tag_name,
                    "name": name,
                    "body": body,
                    "html_url": html_url,
                    "published_at": published_at,
                    "is_prerelease": is_prerelease != 0,
                    "fetched_at": fetched_at,
                    "read_at": read_at,
                })
            },
        )
        .collect();

    // --- release_assets ---
    let mut stmt = conn
        .prepare(
            "SELECT id, release_id, name, download_url, size_bytes, content_type,
                    platform, arch, file_type
             FROM release_assets ORDER BY id",
        )
        .map_err(|e| e.to_string())?;

    let release_assets: Vec<Value> = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let release_id: String = row.get(1)?;
            let name: String = row.get(2)?;
            let download_url: String = row.get(3)?;
            let size_bytes: Option<i64> = row.get(4)?;
            let content_type: Option<String> = row.get(5)?;
            let platform: Option<String> = row.get(6)?;
            let arch: Option<String> = row.get(7)?;
            let file_type: Option<String> = row.get(8)?;
            Ok((
                id,
                release_id,
                name,
                download_url,
                size_bytes,
                content_type,
                platform,
                arch,
                file_type,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(
            |(id, release_id, name, download_url, size_bytes, content_type, platform, arch, file_type)| {
                json!({
                    "id": id,
                    "release_id": release_id,
                    "name": name,
                    "download_url": download_url,
                    "size_bytes": size_bytes,
                    "content_type": content_type,
                    "platform": platform,
                    "arch": arch,
                    "file_type": file_type,
                })
            },
        )
        .collect();

    Ok(json!({
        "version": BACKUP_VERSION,
        "exported_at": exported_at,
        "repos": repos,
        "settings": settings,
        "releases": releases,
        "release_assets": release_assets,
    }))
}

#[tauri::command]
pub fn import_database(
    data: Value,
    state: State<'_, DbState>,
) -> Result<ImportDbResult, String> {
    let version = data["version"]
        .as_u64()
        .ok_or_else(|| "Missing or invalid 'version' field in backup.".to_string())?;

    if version != BACKUP_VERSION as u64 {
        return Err(format!(
            "Incompatible backup version. Expected version {}.",
            BACKUP_VERSION
        ));
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;

    conn.execute_batch("BEGIN;").map_err(|e| e.to_string())?;

    let result = (|| -> Result<ImportDbResult, String> {
        let mut repos_added: usize = 0;
        let mut repos_skipped: usize = 0;

        // --- repos ---
        if let Some(repos) = data["repos"].as_array() {
            for repo in repos {
                let rows_changed = conn
                    .execute(
                        "INSERT OR IGNORE INTO repos
                            (id, full_name, description, url, language, stars_count, topics,
                             added_at, source, llm_summary, llm_what, llm_why, llm_use_case,
                             llm_category, llm_tags, llm_generated_at, prompt_version,
                             user_notes, user_category, watching, category_locked)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
                        params![
                            repo["id"].as_str().unwrap_or(""),
                            repo["full_name"].as_str().unwrap_or(""),
                            repo["description"].as_str(),
                            repo["url"].as_str().unwrap_or(""),
                            repo["language"].as_str(),
                            repo["stars_count"].as_i64(),
                            repo["topics"].as_str(),
                            repo["added_at"].as_str(),
                            repo["source"].as_str().unwrap_or("manual"),
                            repo["llm_summary"].as_str(),
                            repo["llm_what"].as_str(),
                            repo["llm_why"].as_str(),
                            repo["llm_use_case"].as_str(),
                            repo["llm_category"].as_str(),
                            repo["llm_tags"].as_str(),
                            repo["llm_generated_at"].as_str(),
                            repo["prompt_version"].as_i64(),
                            repo["user_notes"].as_str(),
                            repo["user_category"].as_str(),
                            repo["watching"].as_bool().unwrap_or(false) as i64,
                            repo["category_locked"].as_bool().unwrap_or(false) as i64,
                        ],
                    )
                    .map_err(|e| e.to_string())?;

                if rows_changed > 0 {
                    repos_added += 1;
                } else {
                    repos_skipped += 1;
                }
            }
        }

        // --- settings ---
        if let Some(settings) = data["settings"].as_array() {
            for setting in settings {
                let key = setting["key"].as_str().unwrap_or("");
                let value = setting["value"].as_str().unwrap_or("");
                if key.is_empty() {
                    continue;
                }
                conn.execute(
                    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
                    params![key, value],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        // --- releases ---
        let mut releases_added: usize = 0;
        if let Some(releases) = data["releases"].as_array() {
            for release in releases {
                let rows_changed = conn
                    .execute(
                        "INSERT OR IGNORE INTO releases
                            (id, repo_id, tag_name, name, body, html_url, published_at,
                             is_prerelease, fetched_at, read_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                        params![
                            release["id"].as_str().unwrap_or(""),
                            release["repo_id"].as_str().unwrap_or(""),
                            release["tag_name"].as_str().unwrap_or(""),
                            release["name"].as_str(),
                            release["body"].as_str(),
                            release["html_url"].as_str().unwrap_or(""),
                            release["published_at"].as_str().unwrap_or(""),
                            release["is_prerelease"].as_bool().unwrap_or(false) as i64,
                            release["fetched_at"].as_str().unwrap_or(""),
                            release["read_at"].as_str(),
                        ],
                    )
                    .map_err(|e| e.to_string())?;

                if rows_changed > 0 {
                    releases_added += 1;
                }
            }
        }

        // --- release_assets ---
        if let Some(assets) = data["release_assets"].as_array() {
            for asset in assets {
                conn.execute(
                    "INSERT OR IGNORE INTO release_assets
                        (release_id, name, download_url, size_bytes, content_type,
                         platform, arch, file_type)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![
                        asset["release_id"].as_str().unwrap_or(""),
                        asset["name"].as_str().unwrap_or(""),
                        asset["download_url"].as_str().unwrap_or(""),
                        asset["size_bytes"].as_i64(),
                        asset["content_type"].as_str(),
                        asset["platform"].as_str(),
                        asset["arch"].as_str(),
                        asset["file_type"].as_str(),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        Ok(ImportDbResult {
            repos_added,
            repos_skipped,
            releases_added,
            error: None,
        })
    })();

    match result {
        Ok(stats) => {
            conn.execute_batch("COMMIT;")
                .map_err(|e| e.to_string())?;
            Ok(stats)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}
