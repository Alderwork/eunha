use crate::db::DbState;
use crate::models::{BatchDescribeResult, LlmResult, Repo};
use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::{Emitter, State};

pub const CURRENT_PROMPT_VERSION: u32 = 1;

const VALID_CATEGORIES: &[&str] = &[
    "CLI Tool",
    "Library",
    "Framework",
    "Service",
    "Learning Resource",
    "Template",
    "Other",
];

#[derive(Debug, Deserialize)]
struct LlmJsonResponse {
    what: Option<String>,
    why: Option<String>,
    use_case: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn normalize_category(cat: &str) -> String {
    if VALID_CATEGORIES.contains(&cat) {
        cat.to_string()
    } else {
        "Other".to_string()
    }
}

pub fn parse_llm_json(raw: &str) -> Result<LlmResult, String> {
    let clean = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: LlmJsonResponse =
        serde_json::from_str(clean).map_err(|e| format!("Invalid JSON: {e}"))?;

    let what = parsed
        .what
        .filter(|s| !s.is_empty())
        .ok_or("Missing required field: what")?;
    let why = parsed
        .why
        .filter(|s| !s.is_empty())
        .ok_or("Missing required field: why")?;
    let use_case = parsed
        .use_case
        .filter(|s| !s.is_empty())
        .ok_or("Missing required field: use_case")?;
    let category = parsed
        .category
        .filter(|s| !s.is_empty())
        .ok_or("Missing required field: category")?;
    let tags = parsed.tags.ok_or("Missing required field: tags")?;

    let what = truncate(&what, 80);
    let why = truncate(&why, 80);
    let use_case = truncate(&use_case, 80);
    let category = normalize_category(&category);
    let tags: Vec<String> = tags
        .into_iter()
        .take(4)
        .map(|t| truncate(&t, 20))
        .collect();

    Ok(LlmResult {
        what,
        why,
        use_case,
        category,
        tags,
        raw_json: clean.to_string(),
    })
}

async fn fetch_readme(full_name: &str, pat: &str) -> Option<String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{}/readme", full_name);
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3.raw")
        .header("Authorization", format!("Bearer {}", pat))
        .header("User-Agent", "eunha/1.0")
        .send()
        .await
        .ok()?;

    if resp.status().is_success() {
        let text = resp.text().await.ok()?;
        Some(text.chars().take(500).collect())
    } else {
        None
    }
}

async fn call_llm(
    prompt: &str,
    provider: &str,
    api_key: &str,
    ollama_url: Option<&str>,
    _model: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    match provider {
        "openai" => {
            let body = serde_json::json!({
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "max_tokens": 500
            });
            let resp = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("OpenAI error {status}: {text}"));
            }

            let json: serde_json::Value =
                resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            json["choices"][0]["message"]["content"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or("No content in response".to_string())
        }
        "anthropic" => {
            let body = serde_json::json!({
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 500,
                "messages": [{"role": "user", "content": prompt}]
            });
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("Anthropic error {status}: {text}"));
            }

            let json: serde_json::Value =
                resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            json["content"][0]["text"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or("No content in response".to_string())
        }
        "ollama" => {
            let base = ollama_url.unwrap_or("http://localhost:11434");
            let body = serde_json::json!({
                "model": "llama3",
                "prompt": prompt,
                "format": "json",
                "stream": false
            });
            let resp = client
                .post(format!("{}/api/generate", base))
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Ollama request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!(
                    "Ollama error {status}: {text}\nIf your model doesn't support JSON mode, try a different model or switch to OpenAI/Anthropic."
                ));
            }

            let json: serde_json::Value =
                resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
            json["response"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or("No response field from Ollama".to_string())
        }
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

pub fn write_llm_description(
    conn: &Connection,
    repo_id: &str,
    result: &LlmResult,
) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&result.tags).unwrap_or_default();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE repos SET
            llm_summary = ?1,
            llm_what = ?2,
            llm_why = ?3,
            llm_use_case = ?4,
            llm_category = ?5,
            llm_tags = ?6,
            llm_generated_at = CURRENT_TIMESTAMP,
            prompt_version = ?7
         WHERE id = ?8",
        params![
            result.raw_json,
            result.what,
            result.why,
            result.use_case,
            result.category,
            tags_json,
            CURRENT_PROMPT_VERSION,
            repo_id,
        ],
    )?;
    tx.commit()
}

fn build_prompt(repo: &Repo, readme: Option<&str>) -> String {
    let topics = repo
        .topics
        .as_deref()
        .and_then(|t| serde_json::from_str::<Vec<String>>(t).ok())
        .map(|v| v.join(", "))
        .unwrap_or_default();

    format!(
        r#"Given this GitHub repo:
- Name: {full_name}
- GitHub description: {description}
- Language: {language}
- Topics: {topics}
- README excerpt: {readme}

Respond ONLY with valid JSON in this exact format:
{{
  "what": "One sentence: what this repo IS (max 80 chars)",
  "why": "One sentence: why a developer would care (max 80 chars)",
  "use_case": "One sentence: specific scenario (max 80 chars)",
  "category": "One of: CLI Tool | Library | Framework | Service | Learning Resource | Template | Other",
  "tags": ["tag1", "tag2"]
}}"#,
        full_name = repo.full_name,
        description = repo.description.as_deref().unwrap_or(""),
        language = repo.language.as_deref().unwrap_or(""),
        topics = topics,
        readme = readme.unwrap_or("[not available]"),
    )
}

pub fn get_llm_settings() -> Result<(String, String, Option<String>, String), String> {
    let get = |key: &str| -> Option<String> {
        keyring::Entry::new("eunha", key)
            .ok()
            .and_then(|e| e.get_password().ok())
            .filter(|s| !s.is_empty())
    };

    let provider = get("llm_provider").unwrap_or_else(|| "openai".to_string());
    let api_key = get("llm_api_key").unwrap_or_default();
    let ollama_url = get("ollama_url");
    let pat = get("github_pat").unwrap_or_default();

    if api_key.is_empty() && provider != "ollama" {
        return Err("LLM API key not set. Open Settings (,) to add your key.".to_string());
    }

    Ok((provider, api_key, ollama_url, pat))
}

pub fn repo_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Repo> {
    Ok(Repo {
        id: row.get(0)?,
        full_name: row.get(1)?,
        description: row.get(2)?,
        url: row.get(3)?,
        language: row.get(4)?,
        stars_count: row.get(5)?,
        topics: row.get(6)?,
        added_at: row.get(7)?,
        source: row.get(8)?,
        llm_summary: row.get(9)?,
        llm_what: row.get(10)?,
        llm_why: row.get(11)?,
        llm_use_case: row.get(12)?,
        llm_category: row.get(13)?,
        llm_tags: row.get(14)?,
        llm_generated_at: row.get(15)?,
        prompt_version: row.get(16)?,
        user_notes: row.get(17)?,
        user_category: row.get(18)?,
    })
}

const REPO_SELECT: &str =
    "SELECT id, full_name, description, url, language, stars_count, topics, added_at, source,
            llm_summary, llm_what, llm_why, llm_use_case, llm_category, llm_tags, llm_generated_at, prompt_version,
            user_notes, user_category FROM repos";

#[tauri::command]
pub async fn describe_repo(
    repo_id: String,
    state: State<'_, DbState>,
    _app: tauri::AppHandle,
) -> Result<Repo, String> {
    let repo = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            &format!("{} WHERE id = ?1", REPO_SELECT),
            params![repo_id],
            repo_from_row,
        )
        .map_err(|e| format!("Repo not found: {e}"))?
    };

    let (provider, api_key, ollama_url, pat) = get_llm_settings()?;

    let readme = if !pat.is_empty() {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            fetch_readme(&repo.full_name, &pat),
        )
        .await
        .unwrap_or(None)
    } else {
        None
    };

    let prompt = build_prompt(&repo, readme.as_deref());

    let raw = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        call_llm(&prompt, &provider, &api_key, ollama_url.as_deref(), None),
    )
    .await
    .map_err(|_| "Describe timed out after 30s".to_string())??;

    let result = parse_llm_json(&raw).map_err(|e| format!("LLM response parse error: {e}"))?;

    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        write_llm_description(&conn, &repo_id, &result)
            .map_err(|e| format!("DB write failed: {e}"))?;
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("{} WHERE id = ?1", REPO_SELECT),
        params![repo_id],
        repo_from_row,
    )
    .map_err(|e| format!("Failed to read updated repo: {e}"))
}

#[tauri::command]
pub async fn batch_describe(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<BatchDescribeResult, String> {
    let repos: Vec<Repo> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE llm_summary IS NULL OR prompt_version < ?1
                 ORDER BY (llm_summary IS NULL) DESC, prompt_version ASC",
                REPO_SELECT
            ))
            .map_err(|e| e.to_string())?;
        let result: Vec<Repo> = stmt
            .query_map(params![CURRENT_PROMPT_VERSION], repo_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        result
    };

    let total = repos.len() as u32;
    let mut described = 0u32;
    let mut failed = 0u32;

    let (provider, api_key, ollama_url, pat) = get_llm_settings()?;

    for (i, repo) in repos.iter().enumerate() {
        let _ = app.emit(
            "batch-describe:progress",
            serde_json::json!({
                "current": i as u32 + 1,
                "total": total,
                "repo_id": repo.id,
                "failed": failed,
            }),
        );

        let readme = if !pat.is_empty() {
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                fetch_readme(&repo.full_name, &pat),
            )
            .await
            .unwrap_or(None)
        } else {
            None
        };

        let prompt = build_prompt(repo, readme.as_deref());

        let raw_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            call_llm(&prompt, &provider, &api_key, ollama_url.as_deref(), None),
        )
        .await;

        let raw = match raw_result {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => {
                if e.contains("429") || e.contains("503") {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(30),
                        call_llm(&prompt, &provider, &api_key, ollama_url.as_deref(), None),
                    )
                    .await
                    {
                        Ok(Ok(s)) => s,
                        _ => {
                            failed += 1;
                            continue;
                        }
                    }
                } else {
                    failed += 1;
                    continue;
                }
            }
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        match parse_llm_json(&raw) {
            Ok(result) => {
                let conn = state.0.lock().map_err(|e| e.to_string())?;
                match write_llm_description(&conn, &repo.id, &result) {
                    Ok(_) => described += 1,
                    Err(_) => failed += 1,
                }
            }
            Err(_) => failed += 1,
        }
    }

    Ok(BatchDescribeResult {
        described,
        failed,
        total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_json_extracts_fields_correctly() {
        let json = r#"{"what":"A CLI for building Rust projects","why":"Speeds up build cycles significantly","use_case":"Use in CI pipelines for faster builds","category":"CLI Tool","tags":["rust","build","ci"]}"#;
        let result = parse_llm_json(json).unwrap();
        assert_eq!(result.what, "A CLI for building Rust projects");
        assert_eq!(result.category, "CLI Tool");
        assert_eq!(result.tags.len(), 3);
    }

    #[test]
    fn invalid_category_normalizes_to_other() {
        let json = r#"{"what":"An AI/ML framework","why":"Useful for training","use_case":"Train models locally","category":"AI/ML Tool","tags":["ai","ml"]}"#;
        let result = parse_llm_json(json).unwrap();
        assert_eq!(result.category, "Other");
    }

    #[test]
    fn missing_required_field_returns_error() {
        let json = r#"{"why":"Useful tool","use_case":"Some use case","category":"Library","tags":["test"]}"#;
        let result = parse_llm_json(json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("what"));
    }

    #[test]
    fn tags_truncated_to_four() {
        let json = r#"{"what":"A tool","why":"Useful","use_case":"Use it","category":"Library","tags":["a","b","c","d","e"]}"#;
        let result = parse_llm_json(json).unwrap();
        assert_eq!(result.tags.len(), 4);
    }

    #[test]
    fn field_over_80_chars_truncated() {
        let long = "x".repeat(120);
        let json = format!(
            r#"{{"what":"{long}","why":"Short","use_case":"Short","category":"Library","tags":["a"]}}"#
        );
        let result = parse_llm_json(&json).unwrap();
        assert_eq!(result.what.chars().count(), 80);
    }
}
