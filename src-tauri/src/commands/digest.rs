use crate::commands::describe::repo_from_row;
use crate::db::DbState;
use crate::models::{DigestBatch, DigestItem, Repo};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::time::Duration;
use tauri::State;

// ── Tuning constants ──────────────────────────────────────────────────────────
const DIGEST_SIZE: usize = 5;
const DIGEST_INTERVAL_DAYS: f64 = 7.0;
const COOLDOWN_DAYS: f64 = 90.0;
const CANDIDATE_POOL: usize = 15;
const RELEASE_WINDOW_DAYS: f64 = 30.0;
const FORGOTTEN_MONTHS_THRESHOLD: i64 = 6;
const MAX_PER_CATEGORY: usize = 2;

pub struct Weights {
    pub forgotten: f64,
    pub release: f64,
    pub undescribed: f64,
    pub serendipity: f64,
    pub fatigue: f64,
}

impl Default for Weights {
    fn default() -> Self {
        Weights { forgotten: 1.0, release: 0.8, undescribed: 0.6, serendipity: 0.4, fatigue: 0.3 }
    }
}

pub struct Candidate {
    pub repo: Repo,
    pub base_score: f64,
    pub forgotten_months: i64,
}

#[derive(Clone)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub recent: bool,
}

pub struct SelectedItem {
    pub repo: Repo,
    pub reason: String,
    pub reason_detail: String,
    pub score: f64,
}

// Repo columns in repo_from_row order, prefixed for the JOIN.
const REPO_COLS_PREFIXED: &str =
    "repos.id, repos.full_name, repos.description, repos.url, repos.language, repos.stars_count, \
     repos.topics, repos.added_at, repos.source, repos.llm_summary, repos.llm_what, repos.llm_why, \
     repos.llm_use_case, repos.llm_category, repos.llm_tags, repos.llm_generated_at, repos.prompt_version, \
     repos.user_notes, repos.user_category, repos.watching, repos.category_locked, repos.owner_avatar_url, repos.starred_at, \
     COALESCE((SELECT json_group_array(name) FROM user_tags ut JOIN repo_tags rt ON rt.tag_id=ut.id WHERE rt.repo_id=repos.id), '[]'), \
     COALESCE((SELECT json_group_array(name) FROM purposes p JOIN repo_purposes rp ON rp.purpose_id=p.id WHERE rp.repo_id=repos.id), '[]'), \
     COALESCE((SELECT status FROM classification_suggestions cs WHERE cs.repo_id=repos.id), 'pending')";

/// Phase 1: score eligible repos in SQL across forgotten/undescribed/serendipity/fatigue.
/// Weights are bound params so tests can zero out serendipity for determinism.
pub fn select_candidates(conn: &Connection, w: &Weights, pool: usize) -> rusqlite::Result<Vec<Candidate>> {
    let sql = format!(
        "SELECT {cols},
            ( ?1 * MIN(1.0, (julianday('now') - COALESCE(julianday(repos.added_at), julianday('now'))) / 365.0)
            + ?2 * (repos.llm_summary IS NULL)
            + ?3 * ABS(RANDOM() % 1000) / 1000.0
            - ?4 * COALESCE(d.surfaced_count, 0)
            + ?5 * COALESCE(e.engagement_weight, 0)
            ) AS base_score,
            CAST((julianday('now') - COALESCE(julianday(repos.added_at), julianday('now'))) / 30.0 AS INTEGER) AS forgotten_months
         FROM repos
         LEFT JOIN (
            SELECT repo_id, MAX(surfaced_at) AS last_surfaced, COUNT(*) AS surfaced_count
            FROM digest_items GROUP BY repo_id
         ) d ON d.repo_id = repos.id
         LEFT JOIN (
            SELECT repo_id, SUM(event_count) * 1.0 / 10.0 AS engagement_weight
            FROM repo_engagement
            GROUP BY repo_id
         ) e ON e.repo_id = repos.id
         WHERE repos.resurface_archived = 0
           AND (d.last_surfaced IS NULL OR julianday('now') - julianday(d.last_surfaced) >= ?6)
         ORDER BY base_score DESC
         LIMIT ?7",
        cols = REPO_COLS_PREFIXED
    );

    let mut stmt = conn.prepare(&sql)?;
    let engagement_weight = 0.2; // 20% boost per unit engagement
    let rows = stmt.query_map(
        params![w.forgotten, w.undescribed, w.serendipity, w.fatigue, engagement_weight, COOLDOWN_DAYS, pool as i64],
        |row| {
            let repo = repo_from_row(row)?;
            let base_score: f64 = row.get(26)?;
            let forgotten_months: i64 = row.get(27)?;
            Ok(Candidate { repo, base_score, forgotten_months })
        },
    )?;
    rows.collect()
}

/// Reason label by meaning priority: release > undescribed > forgotten > serendipity.
/// Returns (reason, reason_detail) where reason_detail is machine data (see contract).
pub fn assign_reason(repo: &Repo, forgotten_months: i64, release: Option<&ReleaseInfo>) -> (String, String) {
    if let Some(ri) = release {
        if ri.recent {
            return ("release".to_string(), ri.tag_name.clone());
        }
    }
    if repo.llm_summary.is_none() {
        return ("undescribed".to_string(), String::new());
    }
    if forgotten_months >= FORGOTTEN_MONTHS_THRESHOLD {
        return ("forgotten".to_string(), forgotten_months.to_string());
    }
    ("serendipity".to_string(), String::new())
}

/// Phase 2: add release boost, re-rank, apply diversity cap, take top DIGEST_SIZE, assign reasons.
pub fn rank_final(cands: Vec<Candidate>, releases: &HashMap<String, ReleaseInfo>, w: &Weights) -> Vec<SelectedItem> {
    let mut scored: Vec<(Candidate, f64)> = cands
        .into_iter()
        .map(|c| {
            let boost = match releases.get(&c.repo.id) {
                Some(ri) if ri.recent => w.release,
                _ => 0.0,
            };
            let s = c.base_score + boost;
            (c, s)
        })
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut cat_counts: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<SelectedItem> = Vec::with_capacity(DIGEST_SIZE);
    for (c, s) in scored {
        if out.len() >= DIGEST_SIZE {
            break;
        }
        // Cap only named categories at MAX_PER_CATEGORY; null-category repos are uncapped.
        if let Some(cat) = c.repo.llm_category.clone() {
            let n = cat_counts.entry(cat).or_insert(0);
            if *n >= MAX_PER_CATEGORY {
                continue;
            }
            *n += 1;
        }
        let (reason, reason_detail) = assign_reason(&c.repo, c.forgotten_months, releases.get(&c.repo.id));
        out.push(SelectedItem { repo: c.repo, reason, reason_detail, score: s });
    }
    out
}

pub fn is_due(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT CASE
                  WHEN MAX(batch_date) IS NULL THEN 1
                  WHEN julianday('now') - julianday(MAX(batch_date)) >= ?1 THEN 1
                  ELSE 0 END
         FROM digest_items",
        params![DIGEST_INTERVAL_DAYS],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(1)
        == 1
}

pub fn recency_within(conn: &Connection, published_at: &str, days: f64) -> bool {
    conn.query_row(
        "SELECT CASE WHEN (julianday('now') - julianday(?1)) <= ?2 THEN 1 ELSE 0 END",
        params![published_at, days],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
        == 1
}

pub fn persist_batch(conn: &Connection, items: &[SelectedItem]) -> rusqlite::Result<String> {
    let batch_date: String = conn.query_row("SELECT date('now')", [], |r| r.get(0))?;
    let tx = conn.unchecked_transaction()?;
    for it in items {
        tx.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason, reason_detail, score)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![it.repo.id, batch_date, it.reason, it.reason_detail, it.score],
        )?;
    }
    tx.commit()?;
    Ok(batch_date)
}

pub fn read_current_batch(conn: &Connection) -> Option<DigestBatch> {
    let batch_date: Option<String> = conn
        .query_row("SELECT MAX(batch_date) FROM digest_items", [], |r| r.get(0))
        .ok()
        .flatten();
    let batch_date = batch_date?;

    let sql = format!(
        "SELECT {cols}, di.reason, di.reason_detail, di.action
         FROM digest_items di JOIN repos ON repos.id = di.repo_id
         WHERE di.batch_date = ?1
         ORDER BY di.id",
        cols = REPO_COLS_PREFIXED
    );
    let mut stmt = conn.prepare(&sql).ok()?;
    let items: Vec<DigestItem> = stmt
        .query_map(params![batch_date], |row| {
            let repo = repo_from_row(row)?;
            let reason: String = row.get(26)?;
            let reason_detail: Option<String> = row.get(27)?;
            let action: Option<String> = row.get(28)?;
            Ok(DigestItem { repo, reason, reason_detail: reason_detail.unwrap_or_default(), action })
        })
        .ok()?
        .collect::<rusqlite::Result<Vec<_>>>()
        .ok()?;

    if items.is_empty() {
        None
    } else {
        Some(DigestBatch { batch_date, items })
    }
}

#[tauri::command]
pub fn get_current_digest(state: State<'_, DbState>) -> Result<Option<DigestBatch>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    Ok(read_current_batch(&conn))
}

fn apply_digest_action(
    conn: &Connection,
    repo_id: &str,
    batch_date: &str,
    action: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE digest_items SET action = ?1, action_at = datetime('now')
         WHERE repo_id = ?2 AND batch_date = ?3",
        params![action, repo_id, batch_date],
    )?;
    if action == "archived" {
        conn.execute(
            "UPDATE repos SET resurface_archived = 1 WHERE id = ?1",
            params![repo_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn record_digest_action(
    repo_id: String,
    batch_date: String,
    action: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    apply_digest_action(&conn, &repo_id, &batch_date, &action).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
struct GhLatestRelease {
    tag_name: String,
    published_at: String,
    #[serde(default)]
    prerelease: bool,
}

/// Fetch the latest release for each candidate. Best-effort: network/parse errors are skipped.
/// Returns (repo_id, tag_name, published_at, prerelease) for candidates that have a latest release.
async fn fetch_latest_releases(candidate_ids: &[String], pat: &str) -> Vec<(String, String, String, bool)> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("eunha"));
    let client = match reqwest::Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut out: Vec<(String, String, String, bool)> = vec![];
    for chunk in candidate_ids.chunks(5) {
        let futures: Vec<_> = chunk
            .iter()
            .map(|id| {
                let client = client.clone();
                let pat = pat.to_owned();
                let id = id.clone();
                async move {
                    let url = format!("https://api.github.com/repos/{}/releases/latest", id);
                    let mut req = client.get(&url);
                    if !pat.is_empty() {
                        req = req.header(AUTHORIZATION, format!("Bearer {}", pat));
                    }
                    let resp = req.send().await.ok()?;
                    if !resp.status().is_success() {
                        return None;
                    }
                    let r: GhLatestRelease = resp.json().await.ok()?;
                    Some((id, r.tag_name, r.published_at, r.prerelease))
                }
            })
            .collect();
        for res in futures::future::join_all(futures).await {
            if let Some(t) = res {
                out.push(t);
            }
        }
    }
    out
}

pub async fn generate_batch(
    state: &State<'_, DbState>,
    weights: Weights,
) -> Result<Option<DigestBatch>, String> {
    // Phase 1 — candidates (short locked scope).
    let candidates = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        select_candidates(&conn, &weights, CANDIDATE_POOL).map_err(|e| e.to_string())?
    };
    if candidates.len() < 3 {
        return Ok(None); // thin guard — no sad card
    }

    // Phase 2 — lazy release fetch (no lock held across await).
    let pat = crate::commands::settings::get_secret("github_pat").unwrap_or_default();
    let candidate_ids: Vec<String> = candidates.iter().map(|c| c.repo.id.clone()).collect();
    let raw_releases = fetch_latest_releases(&candidate_ids, &pat).await;

    // Compute recency via SQLite (no chrono), build the release map, rank, persist.
    let batch = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut releases: HashMap<String, ReleaseInfo> = HashMap::new();
        for (id, tag, published_at, prerelease) in raw_releases {
            let recent = !prerelease && recency_within(&conn, &published_at, RELEASE_WINDOW_DAYS);
            releases.insert(id, ReleaseInfo { tag_name: tag, recent });
        }
        let selected = rank_final(candidates, &releases, &weights);
        if selected.is_empty() {
            None
        } else {
            let batch_date = persist_batch(&conn, &selected).map_err(|e| e.to_string())?;
            Some(DigestBatch {
                batch_date,
                items: selected
                    .into_iter()
                    .map(|s| DigestItem { repo: s.repo, reason: s.reason, reason_detail: s.reason_detail, action: None })
                    .collect(),
            })
        }
    };
    Ok(batch)
}

#[tauri::command]
pub async fn get_launch_digest(state: State<'_, DbState>) -> Result<Option<DigestBatch>, String> {
    // Idempotent within a day + due check (short locked scope).
    let (has_today, due) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let has_today: i64 = conn
            .query_row("SELECT COUNT(*) FROM digest_items WHERE batch_date = date('now')", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        (has_today > 0, is_due(&conn))
    };
    if has_today {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        return Ok(read_current_batch(&conn));
    }
    if !due {
        return Ok(None);
    }
    generate_batch(&state, Weights::default()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    fn insert_repo(conn: &Connection, id: &str, described: bool, added_days_ago: i64) {
        conn.execute(
            "INSERT INTO repos (id, full_name, url, source, added_at, llm_summary, llm_category)
             VALUES (?1, ?1, 'https://x', 'manual', datetime('now', ?2), ?3, ?4)",
            params![
                id,
                format!("-{} days", added_days_ago),
                if described { Some("{}") } else { None::<&str> },
                if described { Some("Library") } else { None::<&str> },
            ],
        )
        .unwrap();
    }

    fn repo(id: &str, described: bool, category: Option<&str>) -> Repo {
        Repo {
            id: id.to_string(), full_name: id.to_string(), description: None,
            url: "https://x".to_string(), language: None, stars_count: None, topics: None,
            added_at: None, source: "manual".to_string(),
            llm_summary: if described { Some("{}".to_string()) } else { None },
            llm_what: None, llm_why: None, llm_use_case: None,
            llm_category: category.map(|c| c.to_string()),
            llm_tags: None, llm_generated_at: None, prompt_version: None,
            user_notes: None, user_category: None, watching: false,
            category_locked: false, owner_avatar_url: None,
            starred_at: None, user_tags: vec![], purposes: vec![], classification_status: "pending".to_string(),
        }
    }

    fn no_serendipity() -> Weights {
        Weights { serendipity: 0.0, ..Weights::default() }
    }

    #[test]
    fn select_excludes_archived() {
        let conn = db();
        insert_repo(&conn, "a/keep", true, 400);
        insert_repo(&conn, "a/gone", true, 400);
        conn.execute("UPDATE repos SET resurface_archived = 1 WHERE id = 'a/gone'", []).unwrap();
        let c = select_candidates(&conn, &no_serendipity(), 15).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].repo.id, "a/keep");
    }

    #[test]
    fn select_excludes_recently_surfaced_but_includes_old_surface() {
        let conn = db();
        insert_repo(&conn, "a/cool", true, 400);  // surfaced yesterday → excluded
        insert_repo(&conn, "a/warm", true, 400);  // surfaced 100 days ago → included
        conn.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason, surfaced_at)
             VALUES ('a/cool', date('now'), 'forgotten', datetime('now','-1 day'))", []).unwrap();
        conn.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason, surfaced_at)
             VALUES ('a/warm', date('now','-100 days'), 'forgotten', datetime('now','-100 days'))", []).unwrap();
        let ids: Vec<String> = select_candidates(&conn, &no_serendipity(), 15)
            .unwrap().into_iter().map(|c| c.repo.id).collect();
        assert!(ids.contains(&"a/warm".to_string()));
        assert!(!ids.contains(&"a/cool".to_string()));
    }

    #[test]
    fn select_respects_pool_limit() {
        let conn = db();
        for i in 0..20 { insert_repo(&conn, &format!("a/r{i}"), true, 400); }
        let c = select_candidates(&conn, &no_serendipity(), 15).unwrap();
        assert_eq!(c.len(), 15);
    }

    #[test]
    fn rank_release_boost_wins() {
        let cands = vec![
            Candidate { repo: repo("a/plain", true, None), base_score: 1.0, forgotten_months: 1 },
            Candidate { repo: repo("a/rel", true, None),   base_score: 1.0, forgotten_months: 1 },
        ];
        let mut rel = HashMap::new();
        rel.insert("a/rel".to_string(), ReleaseInfo { tag_name: "v2.0".to_string(), recent: true });
        let out = rank_final(cands, &rel, &Weights::default());
        assert_eq!(out[0].repo.id, "a/rel");
        assert_eq!(out[0].reason, "release");
        assert_eq!(out[0].reason_detail, "v2.0");
    }

    #[test]
    fn rank_diversity_caps_named_category_at_two() {
        let cands = vec![
            Candidate { repo: repo("a/1", true, Some("Library")), base_score: 3.0, forgotten_months: 1 },
            Candidate { repo: repo("a/2", true, Some("Library")), base_score: 2.0, forgotten_months: 1 },
            Candidate { repo: repo("a/3", true, Some("Library")), base_score: 1.0, forgotten_months: 1 },
        ];
        let out = rank_final(cands, &HashMap::new(), &Weights::default());
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn assign_reason_priority() {
        let undescribed_with_rel = repo("a/u", false, None);
        let ri = ReleaseInfo { tag_name: "v1".to_string(), recent: true };
        assert_eq!(assign_reason(&undescribed_with_rel, 99, Some(&ri)).0, "release");
        assert_eq!(assign_reason(&repo("a/u", false, None), 99, None).0, "undescribed");
        assert_eq!(assign_reason(&repo("a/o", true, None), 12, None).0, "forgotten");
        assert_eq!(assign_reason(&repo("a/n", true, None), 1, None).0, "serendipity");
    }

    #[test]
    fn rank_diversity_does_not_cap_null_category() {
        let cands = vec![
            Candidate { repo: repo("a/1", true, None), base_score: 3.0, forgotten_months: 1 },
            Candidate { repo: repo("a/2", true, None), base_score: 2.0, forgotten_months: 1 },
            Candidate { repo: repo("a/3", true, None), base_score: 1.0, forgotten_months: 1 },
        ];
        let out = rank_final(cands, &HashMap::new(), &Weights::default());
        assert_eq!(out.len(), 3, "null-category repos must not be capped");
    }

    #[test]
    fn assign_reason_forgotten_detail_is_month_count() {
        let (reason, detail) = assign_reason(&repo("a/o", true, None), 12, None);
        assert_eq!(reason, "forgotten");
        assert_eq!(detail, "12");
    }

    #[test]
    fn is_due_empty_true_then_false_after_today_batch() {
        let conn = db();
        assert!(is_due(&conn), "empty digest should be due");
        insert_repo(&conn, "a/r", true, 400);
        conn.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason) VALUES ('a/r', date('now'), 'forgotten')",
            [],
        ).unwrap();
        assert!(!is_due(&conn), "same-day batch should not be due");
    }

    #[test]
    fn is_due_true_after_interval() {
        let conn = db();
        insert_repo(&conn, "a/r", true, 400);
        conn.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason) VALUES ('a/r', date('now','-8 days'), 'forgotten')",
            [],
        ).unwrap();
        assert!(is_due(&conn), "8-day-old batch should be due");
    }

    #[test]
    fn is_due_true_at_exact_interval() {
        let conn = db();
        insert_repo(&conn, "a/r", true, 400);
        conn.execute(
            "INSERT INTO digest_items (repo_id, batch_date, reason) VALUES ('a/r', date('now','-7 days'), 'forgotten')",
            [],
        ).unwrap();
        assert!(is_due(&conn), "exactly 7 days should be due (>= boundary)");
    }

    #[test]
    fn persist_and_read_current_batch() {
        let conn = db();
        insert_repo(&conn, "a/r", true, 400);
        let items = vec![SelectedItem {
            repo: repo("a/r", true, Some("Library")),
            reason: "forgotten".to_string(),
            reason_detail: "13".to_string(),
            score: 1.0,
        }];
        let bd = persist_batch(&conn, &items).unwrap();
        let batch = read_current_batch(&conn).expect("batch should exist");
        assert_eq!(batch.batch_date, bd);
        assert_eq!(batch.items.len(), 1);
        assert_eq!(batch.items[0].reason, "forgotten");
        assert_eq!(batch.items[0].repo.id, "a/r");
        assert!(batch.items[0].action.is_none());
    }

    #[test]
    fn recency_within_window() {
        let conn = db();
        assert!(recency_within(&conn, "now", 30.0) || recency_within(&conn, &iso_days_ago(&conn, 2), 30.0));
        assert!(!recency_within(&conn, &iso_days_ago(&conn, 90), 30.0));
        assert!(!recency_within(&conn, "not-a-date", 30.0));
    }

    // helper: produce an ISO timestamp N days ago using SQLite
    fn iso_days_ago(conn: &Connection, days: i64) -> String {
        conn.query_row("SELECT datetime('now', ?1)", params![format!("-{} days", days)], |r| r.get(0)).unwrap()
    }

    #[test]
    fn record_action_archived_sets_flag() {
        let conn = db();
        insert_repo(&conn, "a/r", true, 400);
        let bd = persist_batch(&conn, &[SelectedItem {
            repo: repo("a/r", true, None), reason: "forgotten".into(), reason_detail: "13".into(), score: 1.0,
        }]).unwrap();
        apply_digest_action(&conn, "a/r", &bd, "archived").unwrap();
        let archived: i64 = conn.query_row("SELECT resurface_archived FROM repos WHERE id='a/r'", [], |r| r.get(0)).unwrap();
        assert_eq!(archived, 1);
        // and an archived repo is no longer eligible
        let c = select_candidates(&conn, &no_serendipity(), 15).unwrap();
        assert!(c.iter().all(|x| x.repo.id != "a/r"));
    }
}
