use std::collections::HashMap;
use std::time::Duration;

const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL: &str = "claude-haiku-4-5-20251001";
const DEFAULT_OLLAMA_MODEL: &str = "llama3";
const DEFAULT_OPENCODE_GO_MODEL: &str = "deepseek-v4-flash";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

fn chat_completions_url(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("https://api.openai.com/v1/chat/completions"),
        "openrouter" => Some("https://openrouter.ai/api/v1/chat/completions"),
        "opencode-go" => Some("https://opencode.ai/zen/go/v1/chat/completions"),
        _ => None,
    }
}

async fn call_openai_compatible(
    prompt: &str,
    url: &str,
    api_key: &str,
    model: &str,
    provider: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    for json_mode in [true, false] {
        let mut body = serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1500
        });
        if json_mode {
            body["response_format"] = serde_json::json!({"type": "json_object"});
        }
        let response = client
            .post(url)
            .bearer_auth(api_key)
            .timeout(REQUEST_TIMEOUT)
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("{provider} request failed: {error}"))?;

        if response.status().as_u16() == 400 && json_mode {
            continue;
        }
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("{provider} error {status}: {text}"));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("{provider} response parse failed: {error}"))?;
        return json["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("{provider} returned no message content."));
    }
    unreachable!("the fallback request always returns")
}

fn require_model<'a>(model: Option<&'a str>, provider: &str) -> Result<&'a str, String> {
    model.filter(|model| !model.is_empty()).ok_or_else(|| {
        format!("No model selected for {provider}. Open Settings and enter a model identifier.")
    })
}

pub(crate) struct LlmSettings {
    provider: String,
    api_key: String,
    model: Option<String>,
    meta: HashMap<String, String>,
}

pub(crate) fn get_llm_settings() -> Result<LlmSettings, String> {
    let file = crate::conduit::read_connections();
    let no_connection = || "No AI provider connected. Open Settings to connect one.".to_string();
    let active_id = file.active.ok_or_else(no_connection)?;
    let connection = file
        .connections
        .into_iter()
        .find(|connection| connection.id == active_id)
        .ok_or_else(no_connection)?;

    if !crate::conduit::provider_supported(&connection.provider) {
        return Err(
            "The active AI provider is no longer supported. Reconnect it in Settings.".into(),
        );
    }
    let api_key = connection.api_key.unwrap_or_default();
    if connection.provider != "ollama" && api_key.is_empty() {
        return Err(format!(
            "No API key stored for the active {} connection. Reconnect it in Settings.",
            connection.provider
        ));
    }

    Ok(LlmSettings {
        provider: connection.provider,
        api_key,
        model: connection.default_model,
        meta: connection.meta.unwrap_or_default(),
    })
}

pub(crate) async fn call_llm(prompt: &str, settings: &LlmSettings) -> Result<String, String> {
    let client = reqwest::Client::new();
    let model = settings.model.as_deref().filter(|model| !model.is_empty());

    match settings.provider.as_str() {
        "anthropic" => {
            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &settings.api_key)
                .header("anthropic-version", "2023-06-01")
                .timeout(REQUEST_TIMEOUT)
                .json(&serde_json::json!({
                    "model": model.unwrap_or(DEFAULT_ANTHROPIC_MODEL),
                    "max_tokens": 1500,
                    "messages": [{"role": "user", "content": prompt}]
                }))
                .send()
                .await
                .map_err(|error| format!("Anthropic request failed: {error}"))?;

            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic error {status}: {text}"));
            }
            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|error| format!("Anthropic response parse failed: {error}"))?;
            json["content"][0]["text"]
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| "Anthropic returned no message content.".to_string())
        }
        "ollama" => {
            let base = crate::conduit::ollama_base(&settings.meta)?;
            let model = model.unwrap_or(DEFAULT_OLLAMA_MODEL);
            let response = client
                .post(format!("{base}/api/generate"))
                .timeout(REQUEST_TIMEOUT)
                .json(&serde_json::json!({
                    "model": model,
                    "prompt": prompt,
                    "format": "json",
                    "stream": false
                }))
                .send()
                .await
                .map_err(|error| {
                    format!(
                        "Ollama is unavailable at {base}: {error}. Start Ollama yourself, then try again."
                    )
                })?;

            if response.status().as_u16() == 404 {
                return Err(format!(
                    "Ollama model '{model}' is not pulled. Run `ollama pull {model}` yourself, then try again."
                ));
            }
            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return Err(format!("Ollama error {status}: {text}"));
            }
            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|error| format!("Ollama response parse failed: {error}"))?;
            json["response"]
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| "Ollama returned no response content.".to_string())
        }
        provider => {
            let url = chat_completions_url(provider)
                .ok_or_else(|| format!("Unsupported AI provider: {provider}"))?;
            let fallback = match provider {
                "openai" => Some(DEFAULT_OPENAI_MODEL),
                "opencode-go" => Some(DEFAULT_OPENCODE_GO_MODEL),
                _ => None,
            };
            call_openai_compatible(
                prompt,
                url,
                &settings.api_key,
                require_model(model.or(fallback), provider)?,
                provider,
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatible_provider_endpoints_are_fixed_https_urls() {
        for provider in ["openai", "openrouter", "opencode-go"] {
            let url = chat_completions_url(provider).unwrap();
            assert!(url.starts_with("https://"), "{provider}: {url}");
            assert!(url.ends_with("/chat/completions"), "{provider}: {url}");
        }
        for provider in [
            "anthropic",
            "ollama",
            "azure-foundry",
            "lmstudio",
            "unknown",
        ] {
            assert!(chat_completions_url(provider).is_none());
        }
    }
}
