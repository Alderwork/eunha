use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Debug, Clone, Serialize)]
pub struct ContributionData {
    pub good_first_issue_count: u32,
    pub open_pr_count: u32,
    pub has_contributing_md: bool,
    pub github_url: String,
}

async fn fetch_count(client: &reqwest::Client, url: &str, pat: &str) -> u32 {
    let resp = match client
        .get(url)
        .header("Authorization", format!("Bearer {}", pat))
        .header("User-Agent", "eunha/1.0")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return 0,
    };

    // Try Link header first (multiple pages)
    if let Some(link) = resp
        .headers()
        .get("link")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(page) = parse_last_page(link) {
            return page;
        }
    }

    // No Link header → at most 1 page. Check body for items.
    let body = resp.text().await.unwrap_or_default();
    if body.len() > 3 {
        1
    } else {
        0
    }
}

#[tauri::command]
pub async fn get_contribution_data(
    repo_id: String,
    state: State<'_, DbState>,
) -> Result<ContributionData, String> {
    let pat = crate::commands::settings::get_secret("github_pat").unwrap_or_default();
    if pat.is_empty() {
        return Err("GitHub PAT not configured".to_string());
    }

    let full_name = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT full_name FROM repos WHERE id = ?1",
            rusqlite::params![repo_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("Repo not found: {e}"))?
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let gfi_url = format!(
        "https://api.github.com/repos/{}/issues?labels=good+first+issue&state=open&per_page=1",
        full_name
    );
    let gfi_count = fetch_count(&client, &gfi_url, &pat).await;

    let prs_url = format!(
        "https://api.github.com/repos/{}/pulls?state=open&per_page=1",
        full_name
    );
    let pr_count = fetch_count(&client, &prs_url, &pat).await;

    let contr_url = format!(
        "https://api.github.com/repos/{}/contents/CONTRIBUTING.md",
        full_name
    );
    let has_contributing = client
        .get(&contr_url)
        .header("Authorization", format!("Bearer {}", &pat))
        .header("User-Agent", "eunha/1.0")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let github_url = format!("https://github.com/{}", full_name);

    Ok(ContributionData {
        good_first_issue_count: gfi_count,
        open_pr_count: pr_count,
        has_contributing_md: has_contributing,
        github_url,
    })
}

/// Parse last page from GitHub Link header.
/// `<https://api.github.com/...?page=3>; rel="last"` → Some(3)
fn parse_last_page(link_header: &str) -> Option<u32> {
    link_header
        .split(',')
        .find(|part| part.contains("rel=\"last\""))
        .and_then(|part| {
            part.split(';').next()?
                .trim()
                .trim_start_matches('<')
                .trim_end_matches('>')
                .split('?').nth(1)?
                .split('&')
                .find(|kv| kv.starts_with("page="))?
                .split('=')
                .nth(1)?
                .parse::<u32>()
                .ok()
        })
}
