use crate::commands::import::{apply_star_sync, fetch_page};
use crate::db::{migrations, DbState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Singleton guard shared by the manual button and the scheduler so two syncs
/// never overlap (overlapping deletions would race on the temp tables).
static SYNC_RUNNING: AtomicBool = AtomicBool::new(false);

pub const DEFAULT_SYNC_INTERVAL_MINUTES: u64 = 360; // 6h
#[allow(dead_code)]
const SETTING_INTERVAL: &str = "star_sync_interval_minutes";
const SETTING_LAST_SYNC: &str = "last_star_sync_at";

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncStarsResult {
    pub added: u32,
    pub removed: u32,
    pub removed_names: Vec<String>,
}

/// Manual trigger (header button / Settings). The result is returned directly
/// to the invoker, so no `stars:synced` event is emitted.
#[tauri::command]
pub async fn sync_stars(app: AppHandle) -> Result<SyncStarsResult, String> {
    run_star_sync(&app, false).await
}

async fn run_star_sync(app: &AppHandle, emit_event: bool) -> Result<SyncStarsResult, String> {
    if SYNC_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Star sync already in progress".to_string());
    }
    let result = run_star_sync_inner(app).await;
    SYNC_RUNNING.store(false, Ordering::SeqCst);
    let result = result?;

    {
        let db = app.state::<DbState>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let _ = migrations::settings_set(
            &conn,
            SETTING_LAST_SYNC,
            &chrono::Utc::now().to_rfc3339(),
        );
    }

    if emit_event {
        let _ = app.emit("stars:synced", &result);
    }
    Ok(result)
}

async fn run_star_sync_inner(app: &AppHandle) -> Result<SyncStarsResult, String> {
    let pat = crate::config::get_secret("github_pat").unwrap_or_default();
    if pat.is_empty() {
        return Err("GitHub PAT not set. Open Settings (,) to add your token.".to_string());
    }

    // Fetch the COMPLETE star list before touching the DB — apply_star_sync
    // deletes unstarred repos, so a partial list must never reach it.
    let client = reqwest::Client::new();
    let mut page = 1u32;
    let mut total_pages: Option<u32> = None;
    let mut all = Vec::new();
    loop {
        let (repos, last_page) = fetch_page(&client, &pat, page).await?;
        if let Some(lp) = last_page {
            total_pages = Some(lp);
        }
        let page_count = repos.len();
        all.extend(repos);
        if page_count < 100 || total_pages.map(|lp| page >= lp).unwrap_or(false) {
            break;
        }
        page += 1;
    }

    let db = app.state::<DbState>();
    let outcome = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        apply_star_sync(&conn, &all).map_err(|e| format!("DB error: {e}"))?
    };

    Ok(SyncStarsResult {
        added: outcome.added,
        removed: outcome.removed,
        removed_names: outcome.removed_names,
    })
}

/// Background loop: wakes once a minute and syncs when the configured interval
/// (`star_sync_interval_minutes`; 0 = off) has elapsed since the last
/// successful sync. Scheduler-driven syncs emit `stars:synced` so the frontend
/// can refresh and toast.
#[allow(dead_code)]
pub fn start_star_sync_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Let the app settle before the first check.
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let (interval_minutes, last_sync) = {
                let db = app.state::<DbState>();
                let settings = match db.0.lock() {
                    Ok(conn) => (
                        migrations::settings_get(&conn, SETTING_INTERVAL)
                            .and_then(|v| v.parse::<u64>().ok())
                            .unwrap_or(DEFAULT_SYNC_INTERVAL_MINUTES),
                        migrations::settings_get(&conn, SETTING_LAST_SYNC),
                    ),
                    Err(_) => (0, None),
                };
                settings
            };

            if interval_minutes > 0 && sync_due(last_sync.as_deref(), interval_minutes) {
                if let Err(e) = run_star_sync(&app, true).await {
                    log::warn!("star sync failed: {e}");
                    // Back off on failure instead of retrying every minute.
                    tokio::time::sleep(Duration::from_secs(600)).await;
                }
            }

            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}

#[allow(dead_code)]
fn sync_due(last_sync: Option<&str>, interval_minutes: u64) -> bool {
    match last_sync.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) {
        Some(t) => {
            let elapsed = chrono::Utc::now().signed_duration_since(t.with_timezone(&chrono::Utc));
            elapsed.num_seconds() >= (interval_minutes * 60) as i64
        }
        None => true,
    }
}
