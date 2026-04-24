use tauri::AppHandle;

fn kr(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("eunha", key).map_err(|e| e.to_string())
}

fn get_kv(key: &str) -> Option<String> {
    keyring::Entry::new("eunha", key)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty())
}

fn set_kv(key: &str, value: &str) -> Result<(), String> {
    kr(key)?.set_password(value).map_err(|e| e.to_string())
}

fn mask_secret(s: &str) -> String {
    if s.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = s.chars().collect();
    let visible = chars.len().min(4);
    let hidden = chars.len().saturating_sub(visible);
    let dots = "•".repeat(hidden.min(24));
    let tail: String = chars[chars.len() - visible..].iter().collect();
    format!("{}{}", dots, tail)
}

#[tauri::command]
pub fn save_settings(
    github_pat: Option<String>,
    llm_provider: Option<String>,
    llm_api_key: Option<String>,
    ollama_url: Option<String>,
    _app: AppHandle,
) -> Result<(), String> {
    if let Some(pat) = github_pat {
        set_kv("github_pat", &pat)?;
    }
    if let Some(provider) = llm_provider {
        set_kv("llm_provider", &provider)?;
    }
    if let Some(key) = llm_api_key {
        set_kv("llm_api_key", &key)?;
    }
    if let Some(url) = ollama_url {
        set_kv("ollama_url", &url)?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(_app: AppHandle) -> Result<serde_json::Value, String> {
    let pat = get_kv("github_pat").unwrap_or_default();
    let provider = get_kv("llm_provider").unwrap_or_else(|| "openai".to_string());
    let api_key = get_kv("llm_api_key").unwrap_or_default();
    let ollama_url = get_kv("ollama_url").unwrap_or_else(|| "http://localhost:11434".to_string());

    Ok(serde_json::json!({
        "pat_set": !pat.is_empty(),
        "pat_masked": mask_secret(&pat),
        "provider": provider,
        "api_key_set": !api_key.is_empty(),
        "api_key_masked": mask_secret(&api_key),
        "ollama_url": ollama_url,
    }))
}
