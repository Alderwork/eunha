use crate::db::DbState;
use crate::models::ImportResult;
use rusqlite::params;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State};

#[derive(Debug, serde::Deserialize)]
struct GithubOwner {
    avatar_url: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct GithubRepo {
    full_name: String,
    html_url: String,
    description: Option<String>,
    language: Option<String>,
    stargazers_count: Option<i64>,
    topics: Option<Vec<String>>,
    owner: Option<GithubOwner>,
    starred_at: Option<String>,
}

pub(crate) async fn fetch_page(
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
        .header("Accept", "application/vnd.github.star+json")
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

/// INSERT OR IGNORE one repo as source='starred'. Returns true if inserted.
fn insert_repo(tx: &rusqlite::Transaction, repo: &GithubRepo) -> rusqlite::Result<bool> {
    let topics_json = repo
        .topics
        .as_ref()
        .map(|t| serde_json::to_string(t).unwrap_or_default())
        .unwrap_or_default();

    let owner_avatar_url = repo.owner.as_ref().and_then(|o| o.avatar_url.clone());
    let affected = tx.execute(
        "INSERT OR IGNORE INTO repos (id, full_name, description, url, language, stars_count, topics, source, owner_avatar_url, starred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'starred', ?8, ?9)",
        params![
            repo.full_name,
            repo.full_name,
            repo.description,
            repo.html_url,
            repo.language,
            repo.stargazers_count,
            &topics_json,
            &owner_avatar_url,
            &repo.starred_at,
        ],
    )?;

    // Refresh GitHub metadata without changing the insertion result used by the
    // import/sync counters. A missing preview timestamp never overwrites one
    // already persisted from an earlier response.
    tx.execute(
        "UPDATE repos SET description=?2, url=?3, language=?4, stars_count=?5, topics=?6,
         owner_avatar_url=?7, starred_at=COALESCE(?8, starred_at) WHERE id=?1",
        params![repo.full_name, repo.description, repo.html_url, repo.language,
            repo.stargazers_count, topics_json, owner_avatar_url, repo.starred_at],
    )?;

    Ok(affected > 0)
}

fn save_page(conn: &rusqlite::Connection, repos: &[GithubRepo]) -> rusqlite::Result<(u32, u32)> {
    let tx = conn.unchecked_transaction()?;
    let mut inserted = 0u32;
    let mut skipped = 0u32;

    for repo in repos {
        if insert_repo(&tx, repo)? {
            inserted += 1;
        } else {
            skipped += 1;
        }
    }

    tx.commit()?;
    Ok((inserted, skipped))
}

pub(crate) struct StarSyncOutcome {
    pub(crate) added: u32,
    pub(crate) removed: u32,
    pub(crate) removed_names: Vec<String>,
}

/// Mirror the library against the complete fetched star list, atomically:
/// insert new starred repos, delete starred-source repos that are no longer
/// starred (manual-source repos are never touched). Caller MUST pass the full
/// list — a partial fetch would delete legitimate rows.
///
/// FK cascades are not enforced (no PRAGMA foreign_keys), so dependent rows in
/// releases/release_assets/digest_items/collection_items/repo_engagement are
/// deleted explicitly.
pub(crate) fn apply_star_sync(
    conn: &rusqlite::Connection,
    repos: &[GithubRepo],
) -> rusqlite::Result<StarSyncOutcome> {
    let tx = conn.unchecked_transaction()?;

    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS star_sync_ids (id TEXT PRIMARY KEY);
         DELETE FROM star_sync_ids;
         CREATE TEMP TABLE IF NOT EXISTS star_sync_stale (id TEXT PRIMARY KEY);
         DELETE FROM star_sync_stale;",
    )?;

    let mut added = 0u32;
    {
        let mut id_stmt = tx.prepare("INSERT OR IGNORE INTO star_sync_ids (id) VALUES (?1)")?;
        for repo in repos {
            id_stmt.execute(params![repo.full_name])?;
            if insert_repo(&tx, repo)? {
                added += 1;
            }
        }
    }

    tx.execute(
        "INSERT INTO star_sync_stale
         SELECT id FROM repos WHERE source = 'starred' AND id NOT IN (SELECT id FROM star_sync_ids)",
        [],
    )?;

    let removed_names: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM star_sync_stale ORDER BY id")?;
        let names = stmt
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        names
    };
    let removed = removed_names.len() as u32;

    if removed > 0 {
        tx.execute_batch(
            "DELETE FROM release_assets WHERE release_id IN
                 (SELECT id FROM releases WHERE repo_id IN (SELECT id FROM star_sync_stale));
             DELETE FROM releases WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM digest_items WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM collection_items WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM repo_engagement WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM repo_tags WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM repo_purposes WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM classification_suggestions WHERE repo_id IN (SELECT id FROM star_sync_stale);
             DELETE FROM repos WHERE id IN (SELECT id FROM star_sync_stale);",
        )?;
    }

    tx.execute_batch("DROP TABLE star_sync_ids; DROP TABLE star_sync_stale;")?;
    tx.commit()?;

    Ok(StarSyncOutcome {
        added,
        removed,
        removed_names,
    })
}

pub struct CancelState(pub Arc<AtomicBool>);

#[tauri::command]
pub async fn import_stars(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
    cancel: State<'_, CancelState>,
) -> Result<ImportResult, String> {
    let pat = crate::config::get_secret("github_pat").unwrap_or_default();

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
    let mut prev_repos_total: u32 = 0;

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

        let repos_total = total_imported + total_skipped;
        let delta = repos_total.saturating_sub(prev_repos_total);
        prev_repos_total = repos_total;
        let _ = app.emit(
            "import:progress",
            serde_json::json!({
                "page": page,
                "total_pages": total_pages,
                "repos_fetched": repos_total,
                "delta": delta,
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn
    }

    fn gh(full_name: &str) -> GithubRepo {
        GithubRepo {
            full_name: full_name.to_string(),
            html_url: format!("https://github.com/{full_name}"),
            description: None,
            language: None,
            stargazers_count: None,
            topics: None,
            owner: None,
            starred_at: None,
        }
    }

    fn repo_ids(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT id FROM repos ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    }

    #[test]
    fn sync_adds_new_removes_unstarred_keeps_manual() {
        let conn = test_conn();
        apply_star_sync(&conn, &[gh("a/1"), gh("b/2")]).unwrap();
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source) VALUES ('m/1', 'm/1', 'u', 'manual')",
            [],
        )
        .unwrap();

        let outcome = apply_star_sync(&conn, &[gh("b/2"), gh("c/3")]).unwrap();

        assert_eq!(outcome.added, 1);
        assert_eq!(outcome.removed, 1);
        assert_eq!(outcome.removed_names, vec!["a/1".to_string()]);
        assert_eq!(repo_ids(&conn), vec!["b/2", "c/3", "m/1"]);
    }

    #[test]
    fn sync_is_noop_when_list_matches() {
        let conn = test_conn();
        apply_star_sync(&conn, &[gh("a/1")]).unwrap();
        let outcome = apply_star_sync(&conn, &[gh("a/1")]).unwrap();
        assert_eq!(outcome.added, 0);
        assert_eq!(outcome.removed, 0);
        assert_eq!(repo_ids(&conn), vec!["a/1"]);
    }

    #[test]
    fn sync_removes_dependent_rows() {
        let conn = test_conn();
        apply_star_sync(&conn, &[gh("a/1")]).unwrap();
        conn.execute_batch(
            "INSERT INTO releases (id, repo_id, tag_name, html_url, published_at) VALUES ('a/1#v1', 'a/1', 'v1', 'u', 'now');
             INSERT INTO release_assets (release_id, name, download_url) VALUES ('a/1#v1', 'f.zip', 'u');
             INSERT INTO repo_engagement (repo_id, event_type) VALUES ('a/1', 'open_browser');
             INSERT INTO digest_items (repo_id, batch_date, reason) VALUES ('a/1', '2026-01-01', 'forgotten');
             INSERT INTO collections (name) VALUES ('c');
             INSERT INTO collection_items (collection_id, repo_id) VALUES (1, 'a/1');
             INSERT INTO user_tags (name) VALUES ('tag');
             INSERT INTO repo_tags (repo_id, tag_id) VALUES ('a/1', 1);
             INSERT INTO repo_purposes (repo_id, purpose_id) SELECT 'a/1', id FROM purposes LIMIT 1;
             INSERT INTO classification_suggestions (repo_id) VALUES ('a/1');",
        )
        .unwrap();

        // Unstarred everything.
        let outcome = apply_star_sync(&conn, &[]).unwrap();
        assert_eq!(outcome.removed, 1);

        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM repos"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM releases"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM release_assets"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM repo_engagement"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM digest_items"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM collection_items"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM repo_tags"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM repo_purposes"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM classification_suggestions"), 0);
        // FTS index must not retain stale entries for the deleted repo.
        assert_eq!(count("SELECT COUNT(*) FROM repos_fts"), 0);
        // The collection itself survives — only its membership row is gone.
        assert_eq!(count("SELECT COUNT(*) FROM collections"), 1);
    }
}
