use chrono::Utc;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ValidatePatResult {
    pub ok: bool,
    pub login: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_onboarded_at() -> Option<String> {
    crate::config::get_onboarded_at()
}

#[tauri::command]
pub fn set_onboarded_at() -> Result<String, String> {
    let now = Utc::now().to_rfc3339();
    crate::config::set_onboarded_at(&now)?;
    Ok(now)
}

#[tauri::command]
pub async fn validate_pat(pat: String) -> Result<ValidatePatResult, String> {
    let trimmed = pat.trim();
    if trimmed.is_empty() {
        return Ok(ValidatePatResult {
            ok: false,
            login: None,
            error: Some("Token is empty".to_string()),
        });
    }

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", trimmed))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "eunha/1.0")
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = resp.status();
    if status == 401 || status == 403 {
        return Ok(ValidatePatResult {
            ok: false,
            login: None,
            error: Some(format!("Token rejected ({status}) — verify the token is valid and has the required scopes")),
        });
    }
    if !status.is_success() {
        return Ok(ValidatePatResult {
            ok: false,
            login: None,
            error: Some(format!("GitHub error {status}")),
        });
    }

    #[derive(serde::Deserialize)]
    struct UserResp { login: String }

    let user: UserResp = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;

    // Persist on success — same path as Settings would do.
    crate::config::set_secret("github_pat", trimmed)?;

    Ok(ValidatePatResult {
        ok: true,
        login: Some(user.login),
        error: None,
    })
}
