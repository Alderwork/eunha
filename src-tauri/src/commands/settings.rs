use serde::Serialize;

#[derive(Serialize)]
pub struct GithubSettings {
    pat_set: bool,
    pat_masked: String,
}

fn mask_secret(secret: &str) -> String {
    let count = secret.chars().count();
    if count <= 4 {
        return "•".repeat(count);
    }
    let tail: String = secret.chars().skip(count - 4).collect();
    format!("{}{}", "•".repeat((count - 4).min(24)), tail)
}

fn github_settings() -> GithubSettings {
    let pat = crate::config::get_secret("github_pat").unwrap_or_default();
    GithubSettings {
        pat_set: !pat.is_empty(),
        pat_masked: mask_secret(&pat),
    }
}

#[tauri::command]
pub fn save_settings(
    github_pat: Option<String>,
    clear_github_pat: Option<bool>,
) -> Result<GithubSettings, String> {
    if clear_github_pat.unwrap_or(false) {
        crate::config::set_secret("github_pat", "")?;
    } else if let Some(pat) = github_pat.filter(|pat| !pat.trim().is_empty()) {
        crate::config::set_secret("github_pat", pat.trim())?;
    }
    Ok(github_settings())
}

#[tauri::command]
pub fn get_settings() -> GithubSettings {
    github_settings()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_mask_only_reveals_the_last_four_characters() {
        assert_eq!(mask_secret("ghp_12345678"), "••••••••5678");
        assert_eq!(mask_secret("abc"), "•••");
        assert_eq!(mask_secret(""), "");
    }
}
