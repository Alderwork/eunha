use crate::commands::describe::{repo_from_row, REPO_SELECT};
use crate::db::{migrations, DbState};
use crate::models::{FeedFetchResult, FeedGroup, Repo};
use futures::stream::{self, StreamExt};
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, State};

pub struct FeedCancelState(pub Arc<AtomicBool>);

fn now_iso8601() -> String {
    secs_to_iso8601(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    )
}

fn secs_to_iso8601(secs: u64) -> String {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;
    let (year, month, day) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, h, m, s)
}

fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn get_pat() -> Result<String, String> {
    let pat = crate::commands::settings::get_secret("github_pat").unwrap_or_default();
    if pat.is_empty() {
        Err("GitHub PAT not set. Open Settings (,) to add your token.".to_string())
    } else {
        Ok(pat)
    }
}

#[derive(Debug, serde::Deserialize)]
struct GithubUser {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct GithubUserInfo {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug)]
struct CollectedStar {
    repo_full_name: String,
    repo_description: Option<String>,
    repo_url: String,
    repo_language: Option<String>,
    repo_stars_count: Option<i64>,
    repo_topics: Option<String>,
    starred_by: String,
    starred_at: String,
}

#[derive(Debug, serde::Deserialize)]
struct StarredItem {
    starred_at: String,
    repo: StarredRepo,
}

#[derive(Debug, serde::Deserialize)]
struct StarredRepo {
    full_name: String,
    html_url: String,
    description: Option<String>,
    language: Option<String>,
    stargazers_count: Option<i64>,
    topics: Option<Vec<String>>,
}

async fn fetch_following(client: &reqwest::Client, pat: &str) -> Result<Vec<String>, String> {
    let mut logins = Vec::new();
    let mut page = 1u32;
    loop {
        let url = format!(
            "https://api.github.com/user/following?per_page=100&page={}",
            page
        );
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", pat))
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", "eunha/1.0")
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub error {status}: {text}"));
        }

        let users: Vec<GithubUser> = resp
            .json()
            .await
            .map_err(|e| format!("Parse error: {e}"))?;

        let count = users.len();
        logins.extend(users.into_iter().map(|u| u.login));

        if count < 100 {
            break;
        }
        page += 1;
    }
    Ok(logins)
}

// Fetch recent stars for one user, collecting items newer than cutoff_at into memory.
// Returns Err if a network, HTTP, or parse failure prevents any results from being read.
async fn fetch_user_stars(
    client: reqwest::Client,
    pat: String,
    login: String,
    cutoff_at: String,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<CollectedStar>, String> {
    let mut collected = Vec::new();
    let mut page = 1u32;
    loop {
        if cancel.load(Ordering::SeqCst) {
            break;
        }

        let url = format!(
            "https://api.github.com/users/{}/starred?sort=created&direction=desc&per_page=100&page={}",
            login, page
        );
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", pat))
            .header("Accept", "application/vnd.github.star+json")
            .header("User-Agent", "eunha/1.0")
            .send()
            .await
            .map_err(|e| format!("Network error fetching stars for {login}: {e}"))?;

        if resp.status() == 429 || !resp.status().is_success() {
            let status = resp.status();
            return Err(format!("HTTP {status} fetching stars for {login}"));
        }

        let items: Vec<StarredItem> = resp
            .json()
            .await
            .map_err(|e| format!("Parse error fetching stars for {login}: {e}"))?;

        let count = items.len();
        let mut reached_cutoff = false;

        for item in items {
            // Stars are sorted newest-first — stop when we pass the cutoff
            if item.starred_at.as_str() <= cutoff_at.as_str() {
                reached_cutoff = true;
                break;
            }
            let topics_json = item
                .repo
                .topics
                .as_ref()
                .map(|t| serde_json::to_string(t).unwrap_or_default());
            collected.push(CollectedStar {
                repo_full_name: item.repo.full_name,
                repo_description: item.repo.description,
                repo_url: item.repo.html_url,
                repo_language: item.repo.language,
                repo_stars_count: item.repo.stargazers_count,
                repo_topics: topics_json,
                starred_by: login.clone(),
                starred_at: item.starred_at,
            });
        }

        if reached_cutoff || count < 100 {
            break;
        }
        page += 1;
    }
    Ok(collected)
}

#[tauri::command]
pub async fn fetch_feed(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
    cancel: State<'_, FeedCancelState>,
) -> Result<FeedFetchResult, String> {
    let pat = get_pat()?;

    cancel.0.store(false, Ordering::SeqCst);

    // Read last_visited_at from settings; default to 7 days ago
    let cutoff_at = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        migrations::settings_get(&conn, "last_visited_at").unwrap_or_else(|| {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .saturating_sub(7 * 24 * 3600);
            secs_to_iso8601(secs)
        })
    };

    let client = reqwest::Client::new();

    // Emit: starting to fetch following list
    let _ = app.emit(
        "feed:progress",
        serde_json::json!({
            "phase": "following",
            "current_user": null,
            "users_done": 0,
            "users_total": 0,
            "items_found": 0,
        }),
    );

    let logins = fetch_following(&client, &pat).await?;
    let users_total = logins.len() as u32;

    log::info!("[feed] fetch_feed: {} following, cutoff={}", users_total, cutoff_at);

    if users_total == 0 {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let _ = migrations::settings_set(&conn, "last_visited_at", &now_iso8601());
        return Ok(FeedFetchResult {
            items_found: 0,
            users_checked: 0,
            users_total: 0,
            failed_users: 0,
            cancelled: false,
            error: None,
        });
    }

    let cancel_arc = cancel.0.clone();
    let mut users_done = 0u32;
    let mut failed_users = 0u32;
    let mut total_items_found = 0u32;

    // Fetch all users' stars concurrently (5 at a time), collecting into memory
    let mut results_stream = stream::iter(logins.into_iter().map(|login| {
        let client = client.clone();
        let pat = pat.clone();
        let cutoff = cutoff_at.clone();
        let cancel = cancel_arc.clone();
        fetch_user_stars(client, pat, login, cutoff, cancel)
    }))
    .buffer_unordered(5);

    while let Some(result) = results_stream.next().await {
        if cancel_arc.load(Ordering::SeqCst) {
            break;
        }

        users_done += 1;

        let stars = match result {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[feed] fetch_user_stars error: {e}");
                failed_users += 1;
                continue;
            }
        };

        if !stars.is_empty() {
            // Batch insert into DB
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for star in &stars {
                let affected = tx.execute(
                    "INSERT OR IGNORE INTO feed_items
                     (repo_full_name, repo_description, repo_url, repo_language, repo_stars_count, repo_topics, starred_by, starred_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        star.repo_full_name,
                        star.repo_description,
                        star.repo_url,
                        star.repo_language,
                        star.repo_stars_count,
                        star.repo_topics,
                        star.starred_by,
                        star.starred_at,
                    ],
                ).unwrap_or(0);
                if affected > 0 {
                    total_items_found += 1;
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
        }

        let last_user = stars.first().map(|s| s.starred_by.clone());
        let _ = app.emit(
            "feed:progress",
            serde_json::json!({
                "phase": "stars",
                "current_user": last_user,
                "users_done": users_done,
                "users_total": users_total,
                "items_found": total_items_found,
            }),
        );
    }

    let was_cancelled = cancel_arc.load(Ordering::SeqCst);

    // Only advance last_visited_at on a complete, fully-successful run.
    // Advancing on a cancelled or partial run would push the cutoff past stars we never fetched.
    if !was_cancelled && failed_users == 0 {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let _ = migrations::settings_set(&conn, "last_visited_at", &now_iso8601());
    }

    Ok(FeedFetchResult {
        items_found: total_items_found,
        users_checked: users_done,
        users_total,
        failed_users,
        cancelled: was_cancelled,
        error: None,
    })
}

pub(crate) fn get_feed_items_inner(conn: &rusqlite::Connection, include_library: bool) -> Result<Vec<FeedGroup>, String> {
    struct Row {
        repo_full_name: String,
        repo_description: Option<String>,
        repo_url: String,
        repo_language: Option<String>,
        repo_stars_count: Option<i64>,
        repo_topics: Option<String>,
        starred_by: String,
        starred_at: String,
        in_library: bool,
    }

    // LEFT JOIN repos to detect library membership. When include_library=false,
    // rows with in_library=true are filtered out in Rust after collection so the
    // query shape stays consistent regardless of the flag.
    let mut stmt = conn
        .prepare(
            "SELECT
                fi.repo_full_name,
                fi.repo_description,
                fi.repo_url,
                fi.repo_language,
                fi.repo_stars_count,
                fi.repo_topics,
                fi.starred_by,
                fi.starred_at,
                CASE WHEN fi.added_to_library = 1 OR r.id IS NOT NULL THEN 1 ELSE 0 END AS in_library
             FROM feed_items fi
             LEFT JOIN repos r ON r.id = fi.repo_full_name
             WHERE fi.dismissed = 0
             ORDER BY fi.starred_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<Row> = stmt
        .query_map([], |row| {
            Ok(Row {
                repo_full_name: row.get(0)?,
                repo_description: row.get(1)?,
                repo_url: row.get(2)?,
                repo_language: row.get(3)?,
                repo_stars_count: row.get(4)?,
                repo_topics: row.get(5)?,
                starred_by: row.get(6)?,
                starred_at: row.get(7)?,
                in_library: row.get::<_, i64>(8).unwrap_or(0) != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Group by repo_full_name (rows are sorted by starred_at DESC, so first occurrence = latest).
    // Use a HashMap index for O(n) grouping instead of O(n²) linear scan.
    let mut groups: Vec<FeedGroup> = Vec::new();
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for row in rows {
        if !include_library && row.in_library {
            continue;
        }
        if let Some(&idx) = seen.get(&row.repo_full_name) {
            groups[idx].starred_by.push(row.starred_by);
        } else {
            seen.insert(row.repo_full_name.clone(), groups.len());
            groups.push(FeedGroup {
                repo_full_name: row.repo_full_name,
                repo_description: row.repo_description,
                repo_url: row.repo_url,
                repo_language: row.repo_language,
                repo_stars_count: row.repo_stars_count,
                repo_topics: row.repo_topics,
                starred_by: vec![row.starred_by],
                latest_starred_at: row.starred_at,
                in_library: row.in_library,
            });
        }
    }

    Ok(groups)
}

#[tauri::command]
pub fn get_feed_items(state: State<'_, DbState>, include_library: Option<bool>) -> Result<Vec<FeedGroup>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_feed_items_inner(&conn, include_library.unwrap_or(false))
}

#[tauri::command]
pub fn dismiss_feed_item(
    repo_full_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE feed_items SET dismissed = 1 WHERE repo_full_name = ?1",
        params![repo_full_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_feed_repo_to_library(
    repo_full_name: String,
    state: State<'_, DbState>,
) -> Result<Repo, String> {
    // Validate repo_full_name format: must be "owner/repo" with no empty parts or path traversal
    {
        let parts: Vec<&str> = repo_full_name.splitn(2, '/').collect();
        if repo_full_name.contains("..")
            || repo_full_name.starts_with('/')
            || parts.len() != 2
            || parts[0].is_empty()
            || parts[1].is_empty()
        {
            return Err(format!("Invalid repo name: {repo_full_name}"));
        }
    }

    let pat = get_pat()?;
    let client = reqwest::Client::new();

    // 1. Check if already in library — return early if so
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM repos WHERE id = ?1",
                params![repo_full_name],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if exists {
            conn.execute(
                "UPDATE feed_items SET added_to_library = 1 WHERE repo_full_name = ?1",
                params![repo_full_name],
            )
            .ok();
            return conn
                .query_row(
                    &format!("{} WHERE id = ?1", REPO_SELECT),
                    params![repo_full_name],
                    repo_from_row,
                )
                .map_err(|e| format!("Failed to read repo: {e}"));
        }
    }

    // 2. Fetch fresh metadata from GitHub
    let api_url = format!("https://api.github.com/repos/{}", repo_full_name);
    let resp = client
        .get(&api_url)
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "eunha/1.0")
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {e}"))?;

    if resp.status() == 404 {
        return Err("Repo not found".to_string());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub error {status}: {text}"));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let full_name = data["full_name"]
        .as_str()
        .unwrap_or(&repo_full_name)
        .to_string();
    let url = data["html_url"]
        .as_str()
        .unwrap_or(&format!("https://github.com/{}", repo_full_name))
        .to_string();
    let description = data["description"].as_str().map(|s| s.to_string());
    let language = data["language"].as_str().map(|s| s.to_string());
    let stars_count = data["stargazers_count"].as_i64();
    let topics: Vec<String> = data["topics"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let topics_json = serde_json::to_string(&topics).unwrap_or_default();
    let owner_avatar_url = data["owner"]["avatar_url"].as_str().map(|s| s.to_string());

    // 3. Insert into repos and mark feed items
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO repos (id, full_name, description, url, language, stars_count, topics, source, owner_avatar_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'feed', ?8)",
            params![repo_full_name, full_name, description, url, language, stars_count, topics_json, owner_avatar_url],
        )
        .map_err(|e| format!("DB insert failed: {e}"))?;

        conn.execute(
            "UPDATE feed_items SET added_to_library = 1 WHERE repo_full_name = ?1",
            params![repo_full_name],
        )
        .ok();
    }

    // 5. Return the inserted repo
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("{} WHERE id = ?1", REPO_SELECT),
        params![repo_full_name],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read inserted repo: {e}"))
}

#[tauri::command]
pub fn cancel_feed_fetch(cancel: State<'_, FeedCancelState>) {
    cancel.0.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn get_my_github_login() -> Result<GithubUserInfo, String> {
    let pat = get_pat()?;
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "eunha/1.0")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub error {status}: {text}"));
    }

    let user: GithubUser = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
    Ok(GithubUserInfo {
        avatar_url: user.avatar_url.unwrap_or_default(),
        login: user.login,
    })
}

#[tauri::command]
pub async fn get_avatar_urls(logins: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    if logins.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let pat = get_pat()?;
    let client = reqwest::Client::new();

    let results: Vec<Option<(String, String)>> = stream::iter(logins.into_iter().map(|login| {
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
            let user: GithubUser = resp.json().await.ok()?;
            let avatar_url = user.avatar_url?;
            Some((login, avatar_url))
        }
    }))
    .buffer_unordered(5)
    .collect()
    .await;

    Ok(results.into_iter().flatten().collect())
}

/// Called when the user opens the feed view — advances last_visited_at to now
/// so the next fetch only returns repos newer than this visit.
#[tauri::command]
pub fn update_last_visited_at(state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let _ = migrations::settings_set(&conn, "last_visited_at", &now_iso8601());
    Ok(())
}

#[tauri::command]
pub fn get_feed_unread_count(state: State<'_, DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM feed_items WHERE dismissed = 0 AND added_to_library = 0",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    fn insert_feed_item(conn: &Connection, repo: &str, starred_by: &str, starred_at: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO feed_items
             (repo_full_name, repo_url, starred_by, starred_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                repo,
                format!("https://github.com/{}", repo),
                starred_by,
                starred_at,
            ],
        )
        .unwrap();
    }

    #[test]
    fn get_feed_items_groups_same_repo_by_multiple_stargazers() {
        let conn = open_test_db();
        insert_feed_item(&conn, "a/b", "alice", "2024-01-02T00:00:00Z");
        insert_feed_item(&conn, "a/b", "bob", "2024-01-01T00:00:00Z");
        insert_feed_item(&conn, "c/d", "carol", "2024-01-03T00:00:00Z");

        let groups = get_feed_items_inner(&conn, false).unwrap();

        // Two distinct repos
        assert_eq!(groups.len(), 2);

        // a/b should have both alice and bob
        let ab = groups.iter().find(|g| g.repo_full_name == "a/b").unwrap();
        assert_eq!(ab.starred_by.len(), 2);
        assert!(ab.starred_by.contains(&"alice".to_string()));
        assert!(ab.starred_by.contains(&"bob".to_string()));

        // c/d appears first (newest starred_at)
        assert_eq!(groups[0].repo_full_name, "c/d");
    }

    #[test]
    fn get_feed_items_excludes_dismissed_and_added() {
        let conn = open_test_db();
        insert_feed_item(&conn, "a/b", "alice", "2024-01-01T00:00:00Z");
        insert_feed_item(&conn, "c/d", "bob", "2024-01-02T00:00:00Z");
        conn.execute("UPDATE feed_items SET dismissed = 1 WHERE repo_full_name = 'a/b'", []).unwrap();

        let groups = get_feed_items_inner(&conn, false).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].repo_full_name, "c/d");
    }

    #[test]
    fn get_feed_items_excludes_added_to_library() {
        let conn = open_test_db();
        insert_feed_item(&conn, "a/b", "alice", "2024-01-01T00:00:00Z");
        insert_feed_item(&conn, "c/d", "bob", "2024-01-02T00:00:00Z");
        conn.execute("UPDATE feed_items SET added_to_library = 1 WHERE repo_full_name = 'a/b'", []).unwrap();

        let groups = get_feed_items_inner(&conn, false).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].repo_full_name, "c/d");
    }

    #[test]
    fn get_feed_items_excludes_repos_already_in_library() {
        let conn = open_test_db();
        insert_feed_item(&conn, "a/b", "alice", "2024-01-01T00:00:00Z");
        insert_feed_item(&conn, "c/d", "bob", "2024-01-02T00:00:00Z");
        // Insert a/b into the repos table (simulates user having it in their library)
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source) VALUES ('a/b', 'a/b', 'https://github.com/a/b', 'manual')",
            [],
        ).unwrap();

        let groups = get_feed_items_inner(&conn, false).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].repo_full_name, "c/d");
    }

    #[test]
    fn dismiss_feed_item_sets_dismissed() {
        let conn = open_test_db();
        insert_feed_item(&conn, "a/b", "alice", "2024-01-01T00:00:00Z");

        conn.execute(
            "UPDATE feed_items SET dismissed = 1 WHERE repo_full_name = ?1",
            rusqlite::params!["a/b"],
        ).unwrap();

        let dismissed: i64 = conn
            .query_row(
                "SELECT dismissed FROM feed_items WHERE repo_full_name = 'a/b'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dismissed, 1);
    }
}
