use crate::db::{migrations, DbState};
use crate::models::{BatchDescribeResult, LlmResult, Repo};
use rusqlite::{params, Connection};
use serde::Deserialize;
use tauri::{Emitter, State};

pub const CURRENT_PROMPT_VERSION: u32 = 1;

const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL: &str = "claude-haiku-4-5-20251001";
pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
pub const DEFAULT_OLLAMA_MODEL: &str = "llama3";
pub const DEFAULT_OPENCODE_GO_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_LMSTUDIO_URL: &str = "http://127.0.0.1:1234/v1";

/// OpenAI-compatible chat-completions endpoint for every provider that
/// speaks that shape. Mirror of the @conduit/core presets (which only
/// declare the models endpoint); anthropic/ollama/azure-foundry/lmstudio
/// are handled separately in `call_llm`.
fn chat_completions_url(provider: &str) -> Option<&'static str> {
    Some(match provider {
        "openai" => "https://api.openai.com/v1/chat/completions",
        "opencode-go" => "https://opencode.ai/zen/go/v1/chat/completions",
        "opencode" => "https://opencode.ai/zen/v1/chat/completions",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "openrouter" => "https://openrouter.ai/api/v1/chat/completions",
        "deepseek" => "https://api.deepseek.com/chat/completions",
        "xai" => "https://api.x.ai/v1/chat/completions",
        "qwen" => "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
        "qwen-cn" => "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "zai" => "https://api.z.ai/api/paas/v4/chat/completions",
        "moonshot" => "https://api.moonshot.ai/v1/chat/completions",
        "moonshot-cn" => "https://api.moonshot.cn/v1/chat/completions",
        "minimax" => "https://api.minimax.io/v1/chat/completions",
        "minimax-cn" => "https://api.minimaxi.com/v1/chat/completions",
        "stepfun" => "https://api.stepfun.com/step_plan/v1/chat/completions",
        "xiaomi" => "https://api.xiaomimimo.com/v1/chat/completions",
        "upstage" => "https://api.upstage.ai/v1/chat/completions",
        "arcee" => "https://api.arcee.ai/v1/chat/completions",
        "nvidia" => "https://integrate.api.nvidia.com/v1/chat/completions",
        "huggingface" => "https://router.huggingface.co/v1/chat/completions",
        "fireworks" => "https://api.fireworks.ai/inference/v1/chat/completions",
        "deepinfra" => "https://api.deepinfra.com/v1/openai/chat/completions",
        "novita" => "https://api.novita.ai/openai/chat/completions",
        "gmi-cloud" => "https://api.gmi-serving.com/v1/chat/completions",
        "ollama-cloud" => "https://ollama.com/v1/chat/completions",
        "kilo" => "https://api.kilo.ai/api/gateway/chat/completions",
        "nous-portal" => "https://inference-api.nousresearch.com/v1/chat/completions",
        "tencent-tokenhub" => "https://tokenhub.tencentmaas.com/v1/chat/completions",
        "github-copilot" => "https://api.githubcopilot.com/chat/completions",
        _ => return None,
    })
}

/// How an OpenAI-compatible provider expects its credential.
#[derive(Clone, Copy)]
enum CompatibleAuth {
    /// `Authorization: Bearer <key>` (header skipped when the key is empty).
    Bearer,
    /// `api-key: <key>` — Azure OpenAI style.
    ApiKeyHeader,
}

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

/// Shared caller for OpenAI-compatible chat-completions APIs (OpenAI,
/// DeepSeek, xAI, Qwen, OpenCode, ...). `response_format: json_object` is
/// not supported by every compatible provider — try with it, retry
/// without on a 400.
async fn call_openai_compatible(
    prompt: &str,
    url: &str,
    api_key: &str,
    model: &str,
    error_label: &str,
    auth: CompatibleAuth,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    // Roomier than the old 500: reasoning models burn tokens before content.
    for json_mode in [true, false] {
        let mut body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1500
        });
        if json_mode {
            body["response_format"] = serde_json::json!({"type": "json_object"});
        }
        let mut req = client.post(url).json(&body);
        if !api_key.is_empty() {
            req = match auth {
                CompatibleAuth::Bearer => {
                    req.header("Authorization", format!("Bearer {api_key}"))
                }
                CompatibleAuth::ApiKeyHeader => req.header("api-key", api_key),
            };
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if resp.status().as_u16() == 400 && json_mode {
            continue; // provider rejected response_format — retry plain
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("{error_label} error {status}: {text}"));
        }

        let json: serde_json::Value =
            resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        return json["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or("No content in response".to_string());
    }
    unreachable!("the second attempt always returns")
}

fn require_model<'a>(model: Option<&'a str>, provider: &str) -> Result<&'a str, String> {
    model
        .filter(|m| !m.is_empty())
        .ok_or_else(|| format!("No model selected for {provider}. Open Settings (,) and pick a default model."))
}

async fn call_llm(prompt: &str, settings: &LlmSettings) -> Result<String, String> {
    let client = reqwest::Client::new();
    let api_key = settings.api_key.as_str();
    let model = settings.model.as_deref().filter(|m| !m.is_empty());

    match settings.provider.as_str() {
        "azure-foundry" => {
            let endpoint = settings
                .meta
                .get("endpoint")
                .map(|e| e.trim().trim_end_matches('/'))
                .filter(|e| !e.is_empty())
                .ok_or("Azure Foundry needs an endpoint URL. Set it in Settings.")?;
            call_openai_compatible(
                prompt,
                &format!("{endpoint}/chat/completions"),
                api_key,
                require_model(model, "azure-foundry")?,
                "Azure Foundry",
                CompatibleAuth::ApiKeyHeader,
            )
            .await
        }
        "lmstudio" => {
            let base = settings
                .meta
                .get("base_url")
                .map(|u| u.trim().trim_end_matches('/'))
                .filter(|u| !u.is_empty())
                .unwrap_or(DEFAULT_LMSTUDIO_URL);
            call_openai_compatible(
                prompt,
                &format!("{base}/chat/completions"),
                api_key,
                require_model(model, "lmstudio")?,
                "LM Studio",
                CompatibleAuth::Bearer,
            )
            .await
        }
        "anthropic" => {
            let body = serde_json::json!({
                "model": model.unwrap_or(DEFAULT_ANTHROPIC_MODEL),
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
            let base = settings
                .meta
                .get("base_url")
                .map(|u| u.as_str())
                .filter(|u| !u.is_empty())
                .unwrap_or(DEFAULT_OLLAMA_URL);
            let model = model.unwrap_or(DEFAULT_OLLAMA_MODEL);

            // Start `ollama serve` ourselves if nothing is listening.
            crate::ollama::ensure_running(base).await?;

            let body = serde_json::json!({
                "model": model,
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

            if resp.status().as_u16() == 404 {
                return Err(format!(
                    "Ollama model '{model}' is not pulled. Run `ollama pull {model}` once, then try again."
                ));
            }
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
        other => {
            let url = chat_completions_url(other)
                .ok_or_else(|| format!("Unknown provider: {other}"))?;
            let fallback = match other {
                "openai" => Some(DEFAULT_OPENAI_MODEL),
                "opencode-go" => Some(DEFAULT_OPENCODE_GO_MODEL),
                _ => None,
            };
            let model = require_model(model.or(fallback), other)?;
            call_openai_compatible(prompt, url, api_key, model, other, CompatibleAuth::Bearer).await
        }
    }
}

pub fn write_llm_description(
    conn: &Connection,
    repo_id: &str,
    result: &LlmResult,
) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&result.tags).unwrap_or_default();

    let locked: bool = conn
        .query_row(
            "SELECT category_locked FROM repos WHERE id = ?1",
            params![repo_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        != 0;

    let tx = conn.unchecked_transaction()?;
    if locked {
        tx.execute(
            "UPDATE repos SET
                llm_summary = ?1,
                llm_what = ?2,
                llm_why = ?3,
                llm_use_case = ?4,
                llm_tags = ?5,
                llm_generated_at = CURRENT_TIMESTAMP,
                prompt_version = ?6
             WHERE id = ?7",
            params![
                result.raw_json,
                result.what,
                result.why,
                result.use_case,
                tags_json,
                CURRENT_PROMPT_VERSION,
                repo_id,
            ],
        )?;
    } else {
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
    }
    tx.commit()
}

fn build_prompt(repo: &Repo, readme: Option<&str>, output_language: &str) -> String {
    let topics = repo
        .topics
        .as_deref()
        .and_then(|t| serde_json::from_str::<Vec<String>>(t).ok())
        .map(|v| v.join(", "))
        .unwrap_or_default();

    let lang_instruction = if output_language == "English" {
        String::new()
    } else {
        format!(
            "\nWrite the \"what\", \"why\", and \"use_case\" values in {output_language}. Keep \"category\" and \"tags\" in English."
        )
    };

    format!(
        r#"Given this GitHub repo:
- Name: {full_name}
- GitHub description: {description}
- Language: {language}
- Topics: {topics}
- README excerpt: {readme}
{lang_instruction}
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
        lang_instruction = lang_instruction,
    )
}

pub struct LlmSettings {
    pub provider: String,
    pub api_key: String,
    /// The active connection's default model; per-provider fallback when unset.
    pub model: Option<String>,
    /// Provider extras from the connection (base_url, endpoint, ...).
    pub meta: std::collections::HashMap<String, String>,
    pub pat: String,
}

/// LLM execution settings derived from the active Conduit connection
/// (`~/.eunha/connections.toml`). Connection management itself lives in the
/// frontend (`@conduit/core`) — this is the read-only execution view.
pub fn get_llm_settings() -> Result<LlmSettings, String> {
    let file = crate::conduit::read_connections();
    let no_connection =
        || "No AI provider connected. Open Settings (,) to connect one.".to_string();
    let active_id = file.active.ok_or_else(no_connection)?;
    let conn = file
        .connections
        .into_iter()
        .find(|c| c.id == active_id)
        .ok_or_else(no_connection)?;

    let api_key = conn.api_key.unwrap_or_default();
    // Keyless providers: local servers that ignore credentials.
    let keyless = matches!(conn.provider.as_str(), "ollama" | "lmstudio");
    if api_key.is_empty() && !keyless {
        return Err(format!(
            "No API key stored for the active {} connection. Open Settings (,) to reconnect.",
            conn.provider
        ));
    }

    let meta = conn.meta.unwrap_or_default();
    let pat = crate::commands::settings::get_secret("github_pat").unwrap_or_default();

    Ok(LlmSettings {
        provider: conn.provider,
        api_key,
        model: conn.default_model,
        meta,
        pat,
    })
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
        watching: row.get::<_, i64>(19).unwrap_or(0) != 0,
        category_locked: row.get::<_, i64>(20).unwrap_or(0) != 0,
        owner_avatar_url: row.get(21).ok(),
    })
}

pub(crate) const REPO_SELECT: &str =
    "SELECT id, full_name, description, url, language, stars_count, topics, added_at, source,
            llm_summary, llm_what, llm_why, llm_use_case, llm_category, llm_tags, llm_generated_at, prompt_version,
            user_notes, user_category, watching, category_locked, owner_avatar_url FROM repos";

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

    let llm = get_llm_settings()?;

    let output_language = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        migrations::settings_get(&conn, "output_language")
            .unwrap_or_else(|| "English".to_string())
    };

    let readme = if !llm.pat.is_empty() {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            fetch_readme(&repo.full_name, &llm.pat),
        )
        .await
        .unwrap_or(None)
    } else {
        None
    };

    let prompt = build_prompt(&repo, readme.as_deref(), &output_language);

    let raw = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        call_llm(&prompt, &llm),
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

    let llm = get_llm_settings()?;

    let output_language = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        migrations::settings_get(&conn, "output_language")
            .unwrap_or_else(|| "English".to_string())
    };

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

        let readme = if !llm.pat.is_empty() {
            tokio::time::timeout(
                std::time::Duration::from_secs(5),
                fetch_readme(&repo.full_name, &llm.pat),
            )
            .await
            .unwrap_or(None)
        } else {
            None
        };

        let prompt = build_prompt(repo, readme.as_deref(), &output_language);

        let raw_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            call_llm(&prompt, &llm),
        )
        .await;

        let raw = match raw_result {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => {
                if e.contains("429") || e.contains("503") {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(30),
                        call_llm(&prompt, &llm),
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
    fn chat_url_table_covers_all_openai_compatible_providers() {
        const PROVIDERS: &[&str] = &[
            "openai",
            "opencode-go",
            "opencode",
            "gemini",
            "openrouter",
            "deepseek",
            "xai",
            "qwen",
            "qwen-cn",
            "zai",
            "moonshot",
            "moonshot-cn",
            "minimax",
            "minimax-cn",
            "stepfun",
            "xiaomi",
            "upstage",
            "arcee",
            "nvidia",
            "huggingface",
            "fireworks",
            "deepinfra",
            "novita",
            "gmi-cloud",
            "ollama-cloud",
            "kilo",
            "nous-portal",
            "tencent-tokenhub",
            "github-copilot",
        ];
        for provider in PROVIDERS {
            let url = chat_completions_url(provider)
                .unwrap_or_else(|| panic!("missing chat URL for {provider}"));
            assert!(url.starts_with("https://"), "{provider}: {url}");
            assert!(url.ends_with("/chat/completions"), "{provider}: {url}");
        }
        // Non-compatible providers route elsewhere.
        assert!(chat_completions_url("anthropic").is_none());
        assert!(chat_completions_url("ollama").is_none());
        assert!(chat_completions_url("azure-foundry").is_none());
        assert!(chat_completions_url("lmstudio").is_none());
        assert!(chat_completions_url("nope").is_none());
    }

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

    fn make_test_repo() -> Repo {
        Repo {
            id: "test/repo".to_string(),
            full_name: "test/repo".to_string(),
            description: None,
            url: "https://github.com/test/repo".to_string(),
            language: None,
            stars_count: None,
            topics: None,
            added_at: None,
            source: "manual".to_string(),
            llm_summary: None,
            llm_what: None,
            llm_why: None,
            llm_use_case: None,
            llm_category: None,
            llm_tags: None,
            llm_generated_at: None,
            prompt_version: None,
            user_notes: None,
            user_category: None,
            watching: false,
            category_locked: false,
            owner_avatar_url: None,
        }
    }

    #[test]
    fn build_prompt_includes_language_instruction_for_non_english() {
        let repo = make_test_repo();
        let prompt = build_prompt(&repo, None, "Japanese");
        assert!(
            prompt.contains("in Japanese"),
            "Expected 'in Japanese' in prompt but got:\n{prompt}"
        );
    }

    #[test]
    fn build_prompt_has_no_language_instruction_for_english() {
        let repo = make_test_repo();
        let prompt = build_prompt(&repo, None, "English");
        assert!(
            !prompt.contains("in English"),
            "Unexpected language instruction in English prompt:\n{prompt}"
        );
    }
}
