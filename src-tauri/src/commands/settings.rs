use crate::db::{migrations, DbState};
use crate::TrayState;
use tauri::{AppHandle, State};

pub(crate) fn get_secret(key: &str) -> Option<String> {
    crate::config::get_secret(key)
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

/// LLM provider/key/model settings are owned by Conduit connections
/// (`crate::conduit`) — this command only handles app-level settings.
#[tauri::command]
pub fn save_settings(
    github_pat: Option<String>,
    output_language: Option<String>,
    star_sync_interval_minutes: Option<String>,
    state: State<'_, DbState>,
    _app: AppHandle,
) -> Result<serde_json::Value, String> {
    let mut config_error: Option<String> = None;

    if let Some(pat) = github_pat {
        if let Err(e) = crate::config::set_secret("github_pat", &pat) {
            config_error = Some(format!("Config error (PAT): {e}"));
        }
    }

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(lang) = output_language {
        migrations::settings_set(&conn, "output_language", &lang)
            .map_err(|e| e.to_string())?;
    }
    if let Some(interval) = star_sync_interval_minutes {
        migrations::settings_set(&conn, "star_sync_interval_minutes", &interval)
            .map_err(|e| e.to_string())?;
    }

    Ok(serde_json::json!({ "keychain_error": config_error }))
}

#[tauri::command]
pub fn get_settings(
    state: State<'_, DbState>,
    _app: AppHandle,
) -> Result<serde_json::Value, String> {
    let pat = get_secret("github_pat").unwrap_or_default();

    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let output_language = migrations::settings_get(&conn, "output_language")
        .unwrap_or_else(|| "English".to_string());
    let show_tray_icon = migrations::settings_get(&conn, "show_tray_icon")
        .map(|v| v != "false")
        .unwrap_or(true);
    let star_sync_interval_minutes = migrations::settings_get(&conn, "star_sync_interval_minutes")
        .unwrap_or_else(|| crate::commands::sync::DEFAULT_SYNC_INTERVAL_MINUTES.to_string());
    let last_star_sync_at = migrations::settings_get(&conn, "last_star_sync_at");

    Ok(serde_json::json!({
        "pat_set": !pat.is_empty(),
        "pat_masked": mask_secret(&pat),
        "output_language": output_language,
        "show_tray_icon": show_tray_icon,
        "star_sync_interval_minutes": star_sync_interval_minutes,
        "last_star_sync_at": last_star_sync_at,
    }))
}

#[tauri::command]
pub fn set_tray_visible(
    visible: bool,
    tray_state: State<'_, TrayState>,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    migrations::settings_set(&conn, "show_tray_icon", if visible { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    drop(conn);

    let lock = tray_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(tray) = lock.as_ref() {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}
