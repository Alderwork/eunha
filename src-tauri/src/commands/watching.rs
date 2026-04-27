use crate::commands::settings::get_secret;
use crate::models::LatestRelease;
use serde::Deserialize;

#[derive(Deserialize)]
struct GithubReleaseResponse {
    tag_name: String,
    published_at: String,
    html_url: String,
}

#[tauri::command]
pub async fn get_latest_release(repo_id: String) -> Result<LatestRelease, String> {
    let pat = get_secret("github_pat").unwrap_or_default();

    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{}/releases/latest", repo_id);

    let mut req = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "eunha-app");

    if !pat.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", pat));
    }

    let resp = req.send().await.map_err(|e| format!("Request failed: {e}"))?;

    if resp.status().as_u16() == 404 {
        return Err("no_releases".to_string());
    }

    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }

    let release: GithubReleaseResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse failed: {e}"))?;

    Ok(LatestRelease {
        tag_name: release.tag_name,
        published_at: release.published_at,
        html_url: release.html_url,
    })
}
