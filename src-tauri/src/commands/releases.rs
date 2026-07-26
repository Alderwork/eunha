use crate::commands::describe::repo_from_row;
use crate::db::DbState;
use crate::models::WatchedRepoEntry;
use futures::future::join_all;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use rusqlite::params;
use std::time::Duration;
use tauri::{Emitter, State};

// ── Public structs ────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct Release {
    pub id: String,
    pub repo_id: String,
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub html_url: String,
    pub published_at: String,
    pub is_prerelease: bool,
    pub fetched_at: String,
    pub read_at: Option<String>,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ReleaseAsset {
    pub id: i64,
    pub release_id: String,
    pub name: String,
    pub download_url: String,
    pub size_bytes: Option<i64>,
    pub content_type: Option<String>,
    pub platform: Option<String>,
    pub arch: Option<String>,
    pub file_type: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SyncReleasesResult {
    pub checked: usize,
    pub new_releases: usize,
    pub failed_repos: Vec<String>,
}

// ── GitHub API deserialization structs ───────────────────────────────────────

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: String,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: i64,
    content_type: String,
}

// ── Helper: platform/arch/file_type detection ─────────────────────────────────

fn detect_platform(name: &str) -> (Option<String>, Option<String>, Option<String>) {
    let lower = name.to_lowercase();

    // file_type: check longest suffixes first so ".tar.gz" beats ".gz"
    let file_type: Option<String> = if lower.ends_with(".tar.gz") {
        Some("tar.gz".to_string())
    } else if lower.ends_with(".dmg") {
        Some("dmg".to_string())
    } else if lower.ends_with(".exe") {
        Some("exe".to_string())
    } else if lower.ends_with(".msi") {
        Some("msi".to_string())
    } else if lower.ends_with(".deb") {
        Some("deb".to_string())
    } else if lower.ends_with(".rpm") {
        Some("rpm".to_string())
    } else if lower.ends_with(".appimage") {
        Some("AppImage".to_string())
    } else if lower.ends_with(".zip") {
        Some("zip".to_string())
    } else if lower.ends_with(".pkg") {
        Some("pkg".to_string())
    } else if lower.ends_with(".apk") {
        Some("apk".to_string())
    } else {
        None
    };

    // source code archives
    if lower == "source_code.zip" || lower == "source_code.tar.gz" {
        return (Some("source".to_string()), None, file_type);
    }

    // platform detection — check android before linux (apk)
    let platform: Option<String> = if lower.contains("android") || lower.ends_with(".apk") {
        Some("android".to_string())
    } else if lower.contains("darwin")
        || lower.contains("osx")
        || lower.contains("macos")
        || lower.ends_with(".dmg")
        || lower.ends_with(".pkg")
    {
        Some("macos".to_string())
    } else if lower.contains("windows")
        || lower.contains("win32")
        || lower.contains("win64")
        || lower.ends_with(".exe")
        || lower.ends_with(".msi")
    {
        Some("windows".to_string())
    } else if lower.contains("linux")
        || lower.ends_with(".deb")
        || lower.ends_with(".rpm")
        || lower.ends_with(".appimage")
    {
        Some("linux".to_string())
    } else {
        None
    };

    // arch detection
    let arch: Option<String> = if lower.contains("arm64") || lower.contains("aarch64") {
        Some("arm64".to_string())
    } else if lower.contains("x86_64") || lower.contains("x64") || lower.contains("amd64") {
        Some("x64".to_string())
    } else if lower.contains("universal") {
        Some("universal".to_string())
    } else {
        None
    };

    (platform, arch, file_type)
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

struct RepoFetchResult {
    repo_id: String,
    releases: Vec<GithubRelease>,
    error: Option<String>,
}

async fn fetch_releases_for_repo(
    client: &reqwest::Client,
    repo_id: &str,
    pat: &Option<String>,
) -> RepoFetchResult {
    let url = format!(
        "https://api.github.com/repos/{}/releases?per_page=10",
        repo_id
    );

    let mut req = client.get(&url);
    if let Some(token) = pat {
        if !token.is_empty() {
            req = req.header(AUTHORIZATION, format!("Bearer {}", token));
        }
    }

    match req.send().await {
        Err(e) => RepoFetchResult {
            repo_id: repo_id.to_string(),
            releases: vec![],
            error: Some(e.to_string()),
        },
        Ok(resp) => {
            if !resp.status().is_success() {
                return RepoFetchResult {
                    repo_id: repo_id.to_string(),
                    releases: vec![],
                    error: Some(format!("HTTP {}", resp.status())),
                };
            }
            match resp.json::<Vec<GithubRelease>>().await {
                Ok(releases) => RepoFetchResult {
                    repo_id: repo_id.to_string(),
                    releases,
                    error: None,
                },
                Err(e) => RepoFetchResult {
                    repo_id: repo_id.to_string(),
                    releases: vec![],
                    error: Some(format!("JSON parse error: {}", e)),
                },
            }
        }
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_releases(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<SyncReleasesResult, String> {
    // Collect repo_ids while holding the lock, then release before any async work.
    let repo_ids: Vec<String> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id FROM repos WHERE watching = 1")
            .map_err(|e| e.to_string())?;
        let ids = stmt.query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        ids
    };

    let total = repo_ids.len();
    let pat = crate::commands::settings::get_secret("github_pat");

    // Build a shared HTTP client.
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("eunha"));
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut new_releases: usize = 0;
    let mut failed_repos: Vec<String> = vec![];

    // Process in chunks of 5 for concurrency.
    let chunks: Vec<&[String]> = repo_ids.chunks(5).collect();
    let mut done: usize = 0;

    for chunk in chunks {
        let futures: Vec<_> = chunk
            .iter()
            .map(|repo_id| fetch_releases_for_repo(&client, repo_id, &pat))
            .collect();

        let results = join_all(futures).await;

        for result in results {
            done += 1;

            if let Some(err) = result.error {
                failed_repos.push(format!("{}: {}", result.repo_id, err));
            } else {
                // Write releases + assets into DB.
                let inserted = {
                    let conn = state.0.lock().map_err(|e| e.to_string())?;
                    let now = chrono_now_iso8601();
                    let mut count: usize = 0;

                    for gh_release in &result.releases {
                        let release_id =
                            format!("{}#{}", result.repo_id, gh_release.tag_name);

                        conn.execute(
                            "INSERT OR IGNORE INTO releases \
                             (id, repo_id, tag_name, name, body, html_url, \
                              published_at, is_prerelease, fetched_at) \
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                            params![
                                release_id,
                                result.repo_id,
                                gh_release.tag_name,
                                gh_release.name,
                                gh_release.body,
                                gh_release.html_url,
                                gh_release.published_at,
                                gh_release.prerelease as i64,
                                now,
                            ],
                        )
                        .map_err(|e| e.to_string())?;

                        count += conn.changes() as usize;

                        for asset in &gh_release.assets {
                            let (platform, arch, file_type) =
                                detect_platform(&asset.name);

                            conn.execute(
                                "INSERT OR IGNORE INTO release_assets \
                                 (release_id, name, download_url, size_bytes, \
                                  content_type, platform, arch, file_type) \
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                                params![
                                    release_id,
                                    asset.name,
                                    asset.browser_download_url,
                                    asset.size,
                                    asset.content_type,
                                    platform,
                                    arch,
                                    file_type,
                                ],
                            )
                            .map_err(|e| e.to_string())?;
                        }
                    }
                    count
                };

                new_releases += inserted;
            }

            // Emit progress event — outside the DB lock.
            let _ = app.emit(
                "releases:sync_progress",
                serde_json::json!({
                    "done": done,
                    "total": total,
                    "repo_id": result.repo_id,
                }),
            );
        }
    }

    Ok(SyncReleasesResult {
        checked: total,
        new_releases,
        failed_repos,
    })
}

#[tauri::command]
pub fn list_releases(
    repo_id: Option<String>,
    unread_only: bool,
    platform_filter: Option<String>,
    state: State<'_, DbState>,
) -> Result<Vec<Release>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Build WHERE clause dynamically.
    let mut conditions: Vec<&str> = vec![];
    if repo_id.is_some() {
        conditions.push("repo_id = ?1");
    }
    if unread_only {
        conditions.push("read_at IS NULL");
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let sql = format!(
        "SELECT id, repo_id, tag_name, name, body, html_url, \
         published_at, is_prerelease, fetched_at, read_at \
         FROM releases {} ORDER BY published_at DESC",
        where_clause
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let releases: Vec<Release> = if let Some(ref rid) = repo_id {
        stmt.query_map(params![rid], release_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], release_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    // Load assets for each release and optionally filter by platform.
    let mut result: Vec<Release> = Vec::with_capacity(releases.len());
    for mut release in releases {
        let mut asset_stmt = conn
            .prepare(
                "SELECT id, release_id, name, download_url, size_bytes, \
                 content_type, platform, arch, file_type \
                 FROM release_assets WHERE release_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let assets: Vec<ReleaseAsset> = asset_stmt
            .query_map(params![release.id], asset_from_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        release.assets = if let Some(ref pf) = platform_filter {
            assets
                .into_iter()
                .filter(|a| a.platform.as_deref() == Some(pf.as_str()))
                .collect()
        } else {
            assets
        };

        result.push(release);
    }

    Ok(result)
}

#[tauri::command]
pub fn mark_release_read(
    release_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE releases SET read_at = datetime('now') WHERE id = ?1 AND read_at IS NULL",
        params![release_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mark_all_releases_read(
    repo_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE releases SET read_at = datetime('now') \
         WHERE read_at IS NULL AND (repo_id = ?1 OR ?1 IS NULL)",
        params![repo_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_unread_release_count(state: State<'_, DbState>) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM releases WHERE read_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn list_watched_repos_with_unread(
    state: State<'_, DbState>,
) -> Result<Vec<WatchedRepoEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "{}
             LEFT JOIN (
                 SELECT repo_id, COUNT(*) AS cnt
                 FROM releases
                 WHERE read_at IS NULL
                 GROUP BY repo_id
             ) u ON u.repo_id = r.id
             WHERE r.watching = 1
             ORDER BY unread DESC, r.full_name ASC",
            crate::commands::describe::REPO_SELECT
                .replace("repos.id", "r.id")
                .replace("FROM repos", ", COALESCE(u.cnt, 0) AS unread FROM repos r")
        ))
        .map_err(|e| e.to_string())?;

    let entries: Vec<WatchedRepoEntry> = stmt
        .query_map([], |row| {
            let repo = repo_from_row(row)?;
            let unread: i64 = row.get(26)?;
            Ok(WatchedRepoEntry { repo, unread })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(entries)
}

// ── Row mappers ───────────────────────────────────────────────────────────────

fn release_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Release> {
    let is_prerelease_int: i64 = row.get(7)?;
    Ok(Release {
        id: row.get(0)?,
        repo_id: row.get(1)?,
        tag_name: row.get(2)?,
        name: row.get(3)?,
        body: row.get(4)?,
        html_url: row.get(5)?,
        published_at: row.get(6)?,
        is_prerelease: is_prerelease_int != 0,
        fetched_at: row.get(8)?,
        read_at: row.get(9)?,
        assets: vec![],
    })
}

fn asset_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReleaseAsset> {
    Ok(ReleaseAsset {
        id: row.get(0)?,
        release_id: row.get(1)?,
        name: row.get(2)?,
        download_url: row.get(3)?,
        size_bytes: row.get(4)?,
        content_type: row.get(5)?,
        platform: row.get(6)?,
        arch: row.get(7)?,
        file_type: row.get(8)?,
    })
}

// ── Timestamp helper (no external chrono dependency) ─────────────────────────

fn chrono_now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;

    // Proleptic Gregorian calendar from day count (days since 1970-01-01 = day 719468 in epoch 0)
    let z = days + 719468;
    let era = z / 146097;
    let doe = z % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}
