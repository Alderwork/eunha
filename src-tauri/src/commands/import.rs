use crate::db::DbState;
use crate::models::ImportResult;
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State};

#[derive(Debug, serde::Deserialize)]
struct GithubRepo {
    full_name: String,
    html_url: String,
    description: Option<String>,
    language: Option<String>,
    stargazers_count: Option<i64>,
    topics: Option<Vec<String>>,
}

async fn fetch_page(
    client: &reqwest::Client,
    pat: &str,
    page: u32,
) -> Result<(Vec<GithubRepo>, Option<u32>), String> {
    let url = format!(
        "https://api.github.com/user/starred?per_page=100&page={}",
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

    if resp.status() == 401 || resp.status() == 403 {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub auth error {status}: {text}"));
    }
    if resp.status() == 429 {
        let retry_after = resp
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(60);
        return Err(format!(
            "Rate limited by GitHub — retry after {retry_after}s"
        ));
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub error {status}: {text}"));
    }

    let last_page = resp
        .headers()
        .get("Link")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_last_page);

    let repos: Vec<GithubRepo> = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    Ok((repos, last_page))
}

fn parse_last_page(link: &str) -> Option<u32> {
    for part in link.split(',') {
        if part.contains("rel=\"last\"") {
            if let Some(url_part) = part.split(';').next() {
                let url = url_part.trim().trim_start_matches('<').trim_end_matches('>');
                if let Some(page_str) = url.split("page=").last() {
                    return page_str.split('&').next()?.parse().ok();
                }
            }
        }
    }
    None
}

fn save_page(conn: &rusqlite::Connection, repos: &[GithubRepo]) -> rusqlite::Result<(u32, u32)> {
    let tx = conn.unchecked_transaction()?;
    let mut inserted = 0u32;
    let mut skipped = 0u32;

    for repo in repos {
        let topics_json = repo
            .topics
            .as_ref()
            .map(|t| serde_json::to_string(t).unwrap_or_default())
            .unwrap_or_default();

        let affected = tx.execute(
            "INSERT OR IGNORE INTO repos (id, full_name, description, url, language, stars_count, topics, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'starred')",
            params![
                repo.full_name,
                repo.full_name,
                repo.description,
                repo.html_url,
                repo.language,
                repo.stargazers_count,
                topics_json,
            ],
        )?;

        if affected > 0 { inserted += 1; } else { skipped += 1; }
    }

    tx.commit()?;
    Ok((inserted, skipped))
}

pub struct CancelState(pub Arc<AtomicBool>);

#[tauri::command]
pub async fn import_stars(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
    cancel: State<'_, CancelState>,
) -> Result<ImportResult, String> {
    let pat = keyring::Entry::new("eunha", "github_pat")
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();

    if pat.is_empty() {
        return Err("GitHub PAT not set. Open Settings (,) to add your token.".to_string());
    }

    cancel.0.store(false, Ordering::SeqCst);

    let client = reqwest::Client::new();
    let mut page = 1u32;
    let mut total_pages: Option<u32> = None;
    let mut total_imported = 0u32;
    let mut total_skipped = 0u32;
    let mut pages_fetched = 0u32;

    loop {
        if cancel.0.load(Ordering::SeqCst) {
            return Ok(ImportResult {
                imported: total_imported,
                already_exists: total_skipped,
                pages_fetched,
                cancelled: true,
                error: None,
            });
        }

        let (repos, last_page) = match fetch_page(&client, &pat, page).await {
            Ok(r) => r,
            Err(e) => {
                if pages_fetched > 0 {
                    return Ok(ImportResult {
                        imported: total_imported,
                        already_exists: total_skipped,
                        pages_fetched,
                        cancelled: false,
                        error: Some(e),
                    });
                }
                return Err(e);
            }
        };

        if let Some(lp) = last_page {
            total_pages = Some(lp);
        }

        let page_count = repos.len() as u32;

        if !repos.is_empty() {
            let conn = state.0.lock().map_err(|e| e.to_string())?;
            match save_page(&conn, &repos) {
                Ok((ins, skip)) => {
                    total_imported += ins;
                    total_skipped += skip;
                }
                Err(e) => return Err(format!("DB error: {e}")),
            }
        }

        pages_fetched += 1;

        let _ = app.emit(
            "import:progress",
            serde_json::json!({
                "page": page,
                "total_pages": total_pages,
                "repos_fetched": total_imported + total_skipped,
            }),
        );

        if page_count < 100 || total_pages.map(|lp| page >= lp).unwrap_or(false) {
            break;
        }

        page += 1;
    }

    Ok(ImportResult {
        imported: total_imported,
        already_exists: total_skipped,
        pages_fetched,
        cancelled: false,
        error: None,
    })
}

#[tauri::command]
pub fn cancel_import(cancel: State<'_, CancelState>) {
    cancel.0.store(true, Ordering::SeqCst);
}
