use crate::commands::describe::repo_from_row;
use crate::models::Repo;
use rusqlite::{params, Connection};
use std::collections::HashMap;

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

// 22 repo columns in repo_from_row order, prefixed for the JOIN.
const REPO_COLS_PREFIXED: &str =
    "repos.id, repos.full_name, repos.description, repos.url, repos.language, repos.stars_count, \
     repos.topics, repos.added_at, repos.source, repos.llm_summary, repos.llm_what, repos.llm_why, \
     repos.llm_use_case, repos.llm_category, repos.llm_tags, repos.llm_generated_at, repos.prompt_version, \
     repos.user_notes, repos.user_category, repos.watching, repos.category_locked, repos.owner_avatar_url";

/// Phase 1: score eligible repos in SQL across forgotten/undescribed/serendipity/fatigue.
/// Weights are bound params so tests can zero out serendipity for determinism.
pub fn select_candidates(conn: &Connection, w: &Weights, pool: usize) -> rusqlite::Result<Vec<Candidate>> {
    let sql = format!(
        "SELECT {cols},
            ( ?1 * MIN(1.0, (julianday('now') - COALESCE(julianday(repos.added_at), julianday('now'))) / 365.0)
            + ?2 * (repos.llm_summary IS NULL)
            + ?3 * (ABS(RANDOM()) % 1000) / 1000.0
            - ?4 * COALESCE(d.surfaced_count, 0)
            ) AS base_score,
            CAST((julianday('now') - COALESCE(julianday(repos.added_at), julianday('now'))) / 30.0 AS INTEGER) AS forgotten_months
         FROM repos
         LEFT JOIN (
            SELECT repo_id, MAX(surfaced_at) AS last_surfaced, COUNT(*) AS surfaced_count
            FROM digest_items GROUP BY repo_id
         ) d ON d.repo_id = repos.id
         WHERE repos.resurface_archived = 0
           AND (d.last_surfaced IS NULL OR julianday('now') - julianday(d.last_surfaced) >= ?5)
         ORDER BY base_score DESC
         LIMIT ?6",
        cols = REPO_COLS_PREFIXED
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        params![w.forgotten, w.undescribed, w.serendipity, w.fatigue, COOLDOWN_DAYS, pool as i64],
        |row| {
            let repo = repo_from_row(row)?;
            let base_score: f64 = row.get(22)?;
            let forgotten_months: i64 = row.get(23)?;
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
}
