use std::time::Duration;

#[tauri::command]
pub async fn fetch_readme(repo_id: String) -> Result<String, String> {
    let pat = crate::commands::settings::get_secret("github_pat").unwrap_or_default();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.github.com/repos/{}/readme", repo_id);

    let mut request = client
        .get(&url)
        .header("Accept", "application/vnd.github.raw+json")
        .header("User-Agent", "eunha");

    if !pat.is_empty() {
        request = request.header("Authorization", format!("Bearer {}", pat));
    }

    let resp = request.send().await.map_err(|e| e.to_string())?;

    let status = resp.status();

    if status.as_u16() == 404 {
        return Err("README not found".to_string());
    }

    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }

    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(body)
}
