use crate::db::{migrations, DbState};
use tauri::{AppHandle, State};

// Legacy keychain keys from a previous version of the app that used tauri-plugin-keychain
// (which stored under the bundle identifier as the service name).
const LEGACY_SERVICE: &str = "com.neungsohwa.eunha";

fn kr(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("eunha", key).map_err(|e| e.to_string())
}

pub(crate) fn get_secret(key: &str) -> Option<String> {
    // Try current location first.
    let current = keyring::Entry::new("eunha", key)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty());

    if current.is_some() {
        return current;
    }

    // Fall back to legacy keychain entries (pre-migration).
    let legacy_account = match key {
        "github_pat" => "github_token",
        "llm_api_key" => "ai_key_google",
        _ => return None,
    };
    keyring::Entry::new(LEGACY_SERVICE, legacy_account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty())
}

/// If the current keychain slot is empty but the legacy slot has a value, copy it over.
/// Best-effort — silently ignores all errors so it never blocks a save.
fn migrate_legacy_secret(current_key: &str, legacy_account: &str) {
    let already_set = keyring::Entry::new("eunha", current_key)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    if already_set {
        return;
    }

    if let Some(legacy_val) = keyring::Entry::new(LEGACY_SERVICE, legacy_account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|s| !s.is_empty())
    {
        let _ = set_secret(current_key, &legacy_val);
    }
}

fn set_secret(key: &str, value: &str) -> Result<(), String> {
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
    ollama_model: Option<String>,
    output_language: Option<String>,
    state: State<'_, DbState>,
    _app: AppHandle,
) -> Result<serde_json::Value, String> {
    let mut keychain_error: Option<String> = None;

    // Secrets go to keychain — failures are surfaced as a warning (not a hard error)
    // so SQLite settings always save even if keychain is unavailable.
    if let Some(pat) = github_pat {
        if let Err(e) = set_secret("github_pat", &pat) {
            keychain_error = Some(format!("Keychain error (PAT): {e}"));
        }
    } else {
        // No new PAT supplied — migrate legacy entry to current location if needed.
        migrate_legacy_secret("github_pat", "github_token");
    }
    if let Some(key) = llm_api_key {
        if let Err(e) = set_secret("llm_api_key", &key) {
            keychain_error = Some(format!("Keychain error (API key): {e}"));
        }
    } else {
        migrate_legacy_secret("llm_api_key", "ai_key_google");
    }

    // Non-secret settings go to SQLite
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(provider) = llm_provider {
        migrations::settings_set(&conn, "llm_provider", &provider)
            .map_err(|e| e.to_string())?;
    }
    if let Some(url) = ollama_url {
        migrations::settings_set(&conn, "ollama_url", &url)
            .map_err(|e| e.to_string())?;
    }
    if let Some(model) = ollama_model {
        migrations::settings_set(&conn, "ollama_model", &model)
            .map_err(|e| e.to_string())?;
    }
    if let Some(lang) = output_language {
        migrations::settings_set(&conn, "output_language", &lang)
            .map_err(|e| e.to_string())?;
    }

    Ok(serde_json::json!({ "keychain_error": keychain_error }))
}

#[tauri::command]
pub fn get_settings(
    state: State<'_, DbState>,
    _app: AppHandle,
) -> Result<serde_json::Value, String> {
    let pat = get_secret("github_pat").unwrap_or_default();
    let api_key = get_secret("llm_api_key").unwrap_or_default();

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let provider = migrations::settings_get(&conn, "llm_provider")
        .unwrap_or_else(|| "openai".to_string());
    let ollama_url = migrations::settings_get(&conn, "ollama_url")
        .unwrap_or_else(|| "http://localhost:11434".to_string());
    let ollama_model = migrations::settings_get(&conn, "ollama_model")
        .unwrap_or_else(|| "llama3".to_string());
    let output_language = migrations::settings_get(&conn, "output_language")
        .unwrap_or_else(|| "English".to_string());

    Ok(serde_json::json!({
        "pat_set": !pat.is_empty(),
        "pat_masked": mask_secret(&pat),
        "provider": provider,
        "api_key_set": !api_key.is_empty(),
        "api_key_masked": mask_secret(&api_key),
        "ollama_url": ollama_url,
        "ollama_model": ollama_model,
        "output_language": output_language,
    }))
}
