use crate::commands::describe::repo_from_row;
use crate::db::DbState;
use crate::models::Repo;
use rusqlite::params;
use tauri::State;

fn parse_repo_input(input: &str) -> Result<String, String> {
    let trimmed = input.trim();

    if trimmed.is_empty() {
        return Err("Input is empty".to_string());
    }

    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        if !trimmed.contains("github.com") {
            return Err("Not a GitHub URL".to_string());
        }
        let without_scheme = trimmed
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        let after_host = without_scheme
            .trim_start_matches("www.")
            .trim_start_matches("github.com/");

        let parts: Vec<&str> = after_host.splitn(3, '/').collect();
        if parts.len() < 2 || parts[0].is_empty() || parts[1].is_empty() {
            return Err("Could not parse owner/repo from URL".to_string());
        }
        return Ok(format!("{}/{}", parts[0], parts[1]));
    }

    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() == 2 && !parts[0].is_empty() && !parts[1].is_empty() {
        return Ok(trimmed.to_string());
    }

    Err("Enter owner/repo or a GitHub URL".to_string())
}

const REPO_SELECT: &str =
    "SELECT id, full_name, description, url, language, stars_count, topics, added_at, source,
            llm_summary, llm_what, llm_why, llm_use_case, llm_category, llm_tags, llm_generated_at, prompt_version,
            user_notes, user_category FROM repos";

#[tauri::command]
pub async fn add_repo(
    input: String,
    state: State<'_, DbState>,
    _app: tauri::AppHandle,
) -> Result<Repo, String> {
    let full_name = parse_repo_input(&input)?;
    let repo_id = full_name.clone();

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM repos WHERE id = ?1",
                params![repo_id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if exists {
            return Err("Already added".to_string());
        }
    }

    let pat = keyring::Entry::new("eunha", "github_pat")
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();

    let client = reqwest::Client::new();
    let api_url = format!("https://api.github.com/repos/{}", full_name);
    let mut req = client
        .get(&api_url)
        .header("User-Agent", "eunha/1.0")
        .header("Accept", "application/vnd.github.v3+json");
    if !pat.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", pat));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("GitHub request failed: {e}"))?;

    if resp.status() == 404 {
        return Err("Repo not found — check the name".to_string());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub error {status}: {text}"));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let url = data["html_url"]
        .as_str()
        .unwrap_or(&format!("https://github.com/{}", full_name))
        .to_string();
    let description = data["description"].as_str().map(|s| s.to_string());
    let language = data["language"].as_str().map(|s| s.to_string());
    let stars_count = data["stargazers_count"].as_i64();
    let topics: Vec<String> = data["topics"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let topics_json = serde_json::to_string(&topics).unwrap_or_default();

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO repos (id, full_name, description, url, language, stars_count, topics, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'manual')",
            params![repo_id, full_name, description, url, language, stars_count, topics_json],
        )
        .map_err(|e| format!("DB insert failed: {e}"))?;
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("{} WHERE id = ?1", REPO_SELECT),
        params![repo_id],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read inserted repo: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_repo_input_passes_through() {
        assert_eq!(parse_repo_input("rust-lang/rust").unwrap(), "rust-lang/rust");
    }

    #[test]
    fn github_url_strips_to_owner_repo() {
        assert_eq!(
            parse_repo_input("https://github.com/owner/repo").unwrap(),
            "owner/repo"
        );
    }

    #[test]
    fn url_with_path_suffix_strips_correctly() {
        assert_eq!(
            parse_repo_input("https://github.com/owner/repo/tree/main").unwrap(),
            "owner/repo"
        );
    }

    #[test]
    fn non_github_url_returns_error() {
        let r = parse_repo_input("https://gitlab.com/owner/repo");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("Not a GitHub URL"));
    }
}
