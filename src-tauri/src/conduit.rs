//! AI connection storage in `~/.eunha/connections.toml`.
//!
//! The webview can save or replace a key, but list responses never return it.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const SUPPORTED_PROVIDERS: &[&str] =
    &["openai", "anthropic", "openrouter", "opencode-go", "ollama"];
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

pub(crate) fn provider_supported(provider: &str) -> bool {
    SUPPORTED_PROVIDERS.contains(&provider)
}

pub(crate) fn ollama_base(meta: &HashMap<String, String>) -> Result<String, String> {
    let raw = meta
        .get("base_url")
        .map(String::as_str)
        .unwrap_or(DEFAULT_OLLAMA_URL)
        .trim()
        .trim_end_matches('/');
    let url = reqwest::Url::parse(raw).map_err(|_| "Enter a valid Ollama Base URL.".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if !local
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Ollama must use a local HTTP(S) Base URL without a path or credentials.".into(),
        );
    }
    Ok(raw.to_string())
}

// ── Storage (TOML, snake_case) ───────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConnectionRecord {
    pub id: String,
    pub provider: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<HashMap<String, String>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ConnectionsFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    #[serde(default)]
    pub connections: Vec<ConnectionRecord>,
}

fn connections_path_from(home: &Path) -> PathBuf {
    home.join(".eunha").join("connections.toml")
}

pub fn read_connections_from(home: &Path) -> ConnectionsFile {
    let path = connections_path_from(home);
    let Ok(contents) = fs::read_to_string(&path) else {
        return ConnectionsFile::default();
    };
    toml::from_str(&contents).unwrap_or_default()
}

pub fn write_connections_to(home: &Path, file: &ConnectionsFile) -> Result<(), String> {
    let path = connections_path_from(home);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let contents = toml::to_string(file).map_err(|e| e.to_string())?;
    fs::write(&path, &contents).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn read_connections() -> ConnectionsFile {
    read_connections_from(&crate::config::home_dir())
}

pub fn write_connections(file: &ConnectionsFile) -> Result<(), String> {
    write_connections_to(&crate::config::home_dir(), file)
}

/// Upsert by id. A save that carries no key never wipes an existing one.
pub fn upsert(file: &mut ConnectionsFile, record: ConnectionRecord) {
    match file.connections.iter_mut().find(|c| c.id == record.id) {
        Some(existing) => {
            let api_key = record.api_key.or_else(|| existing.api_key.clone());
            let created_at = existing.created_at.clone();
            *existing = ConnectionRecord {
                api_key,
                created_at,
                ..record
            };
        }
        None => file.connections.push(record),
    }
}

fn require_connection_key(file: &ConnectionsFile, record: &ConnectionRecord) -> Result<(), String> {
    let saved_key = file
        .connections
        .iter()
        .find(|connection| connection.id == record.id)
        .and_then(|connection| connection.api_key.as_deref())
        .is_some_and(|key| !key.is_empty());
    if record.provider != "ollama" && record.api_key.is_none() && !saved_key {
        return Err("Enter an API key for this provider.".into());
    }
    Ok(())
}

// ── IPC boundary ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInput {
    pub provider: String,
    pub credentials: Option<String>,
    pub default_model: Option<String>,
    pub meta: Option<HashMap<String, String>>,
}

fn record_from_input(input: ConnectionInput) -> Result<ConnectionRecord, String> {
    if !provider_supported(&input.provider) {
        return Err("Unsupported AI provider.".into());
    }
    let model = input
        .default_model
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty() && model.len() <= 200)
        .ok_or("Enter a model identifier up to 200 characters.")?;
    let api_key = input
        .credentials
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());
    if api_key.as_ref().is_some_and(|key| key.len() > 8_192) {
        return Err("AI API keys are limited to 8,192 characters.".into());
    }
    let meta = if input.provider == "ollama" {
        Some(HashMap::from([(
            "base_url".into(),
            ollama_base(&input.meta.unwrap_or_default())?,
        )]))
    } else {
        None
    };
    let now = chrono::Utc::now().to_rfc3339();
    Ok(ConnectionRecord {
        id: input.provider.clone(),
        provider: input.provider,
        status: "configured".into(),
        api_key,
        default_model: Some(model),
        validated_at: None,
        meta,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn record_to_ipc(c: &ConnectionRecord) -> serde_json::Value {
    serde_json::json!({
        "id": c.id,
        "provider": c.provider,
        "status": c.status,
        // credentials stripped — key_set tells the UI a key exists, nothing more
        "key_set": c.api_key.as_ref().is_some_and(|k| !k.is_empty()),
        "defaultModel": c.default_model,
        "validatedAt": c.validated_at,
        "meta": c.meta,
        "createdAt": c.created_at,
        "updatedAt": c.updated_at,
    })
}

#[tauri::command]
pub fn conduit_list() -> Result<serde_json::Value, String> {
    let file = read_connections();
    let connections: Vec<serde_json::Value> = file.connections.iter().map(record_to_ipc).collect();
    Ok(serde_json::json!({ "active": file.active, "connections": connections }))
}

#[tauri::command]
pub fn conduit_save(input: ConnectionInput) -> Result<(), String> {
    let mut file = read_connections();
    let record = record_from_input(input)?;
    require_connection_key(&file, &record)?;
    upsert(&mut file, record);
    write_connections(&file)
}

#[tauri::command]
pub fn conduit_delete(id: String) -> Result<(), String> {
    let mut file = read_connections();
    file.connections.retain(|c| c.id != id);
    if file.active.as_deref() == Some(id.as_str()) {
        file.active = None;
    }
    write_connections(&file)
}

#[tauri::command]
pub fn conduit_set_active(id: Option<String>) -> Result<(), String> {
    let mut file = read_connections();
    if let Some(ref active) = id {
        if !file.connections.iter().any(|c| &c.id == active) {
            return Err(format!("Unknown connection: {active}"));
        }
    }
    file.active = id;
    write_connections(&file)
}

// ── One-time migration from legacy settings ──────────────

/// config.toml's `llm_api_key` + sqlite `llm_provider`/`ollama_*`/
/// `opencode_go_model` settings → the first connection in connections.toml.
/// Idempotent: no-op once connections.toml exists.
pub fn migrate_legacy_llm_settings_from(
    home: &Path,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    if connections_path_from(home).exists() {
        return Ok(());
    }
    use crate::db::migrations::settings_get;

    let legacy_key = crate::config::read_from(home)
        .llm_api_key
        .filter(|k| !k.is_empty());
    let provider = settings_get(conn, "llm_provider").unwrap_or_else(|| "openai".to_string());

    // Fresh install: nothing to migrate — the user will connect via the UI.
    if legacy_key.is_none() && provider != "ollama" {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let (default_model, meta) = match provider.as_str() {
        "opencode-go" => (settings_get(conn, "opencode_go_model"), None),
        "ollama" => {
            let base_url = settings_get(conn, "ollama_url")
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            (
                settings_get(conn, "ollama_model"),
                Some(HashMap::from([("base_url".to_string(), base_url)])),
            )
        }
        "anthropic" => (Some("claude-haiku-4-5-20251001".to_string()), None),
        _ => (Some("gpt-4o-mini".to_string()), None),
    };

    let record = ConnectionRecord {
        id: provider.clone(),
        provider,
        // It was working before the migration; treat it as ready.
        status: "ready".to_string(),
        api_key: legacy_key,
        default_model,
        validated_at: Some(now.clone()),
        meta,
        created_at: now.clone(),
        updated_at: now,
    };
    let file = ConnectionsFile {
        active: Some(record.id.clone()),
        connections: vec![record],
    };
    write_connections_to(home, &file)?;

    // The key now lives in connections.toml; drop the legacy copy.
    crate::config::write_to(home, &{
        let mut config = crate::config::read_from(home);
        config.llm_api_key = None;
        config
    })?;
    log::info!("migrated legacy LLM settings into connections.toml");
    Ok(())
}

pub fn migrate_legacy_llm_settings(conn: &rusqlite::Connection) -> Result<(), String> {
    migrate_legacy_llm_settings_from(&crate::config::home_dir(), conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("eunha-conduit-test-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn open_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn
    }

    #[test]
    fn storage_roundtrip_and_permissions() {
        let home = temp_home("roundtrip");
        let file = ConnectionsFile {
            active: Some("openai".into()),
            connections: vec![ConnectionRecord {
                id: "openai".into(),
                provider: "openai".into(),
                status: "ready".into(),
                api_key: Some("sk-test".into()),
                default_model: Some("gpt-4o-mini".into()),
                created_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                ..Default::default()
            }],
        };
        write_connections_to(&home, &file).unwrap();
        let loaded = read_connections_from(&home);
        assert_eq!(loaded.active.as_deref(), Some("openai"));
        assert_eq!(loaded.connections[0].api_key.as_deref(), Some("sk-test"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(connections_path_from(&home))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn upsert_preserves_key_when_save_omits_credentials() {
        let mut file = ConnectionsFile {
            active: None,
            connections: vec![ConnectionRecord {
                id: "openai".into(),
                api_key: Some("sk-live".into()),
                created_at: "t0".into(),
                ..Default::default()
            }],
        };
        // JS status update: same id, no credentials
        upsert(
            &mut file,
            ConnectionRecord {
                id: "openai".into(),
                status: "validated".into(),
                updated_at: "t1".into(),
                ..Default::default()
            },
        );
        assert_eq!(file.connections.len(), 1);
        assert_eq!(file.connections[0].api_key.as_deref(), Some("sk-live"));
        assert_eq!(file.connections[0].status, "validated");
        assert_eq!(file.connections[0].created_at, "t0");

        // Key rotation: credentials present → overwrite
        upsert(
            &mut file,
            ConnectionRecord {
                id: "openai".into(),
                api_key: Some("sk-new".into()),
                updated_at: "t2".into(),
                ..Default::default()
            },
        );
        assert_eq!(file.connections[0].api_key.as_deref(), Some("sk-new"));
    }

    #[test]
    fn connection_input_rejects_unsupported_providers_and_remote_ollama() {
        let input = |provider: &str, base_url: Option<&str>| ConnectionInput {
            provider: provider.into(),
            credentials: Some("secret".into()),
            default_model: Some("model".into()),
            meta: base_url.map(|url| HashMap::from([("base_url".into(), url.into())])),
        };

        assert!(record_from_input(input("openai", None)).is_ok());
        assert!(record_from_input(input("unknown", None)).is_err());
        assert!(record_from_input(input("ollama", Some("https://example.com"))).is_err());
        assert_eq!(
            record_from_input(input("ollama", Some("http://127.0.0.1:11434/")))
                .unwrap()
                .meta
                .unwrap()["base_url"],
            "http://127.0.0.1:11434"
        );
    }

    #[test]
    fn remote_provider_requires_a_new_or_saved_key() {
        let record = ConnectionRecord {
            id: "openai".into(),
            provider: "openai".into(),
            ..Default::default()
        };
        assert!(require_connection_key(&ConnectionsFile::default(), &record).is_err());

        let saved = ConnectionsFile {
            connections: vec![ConnectionRecord {
                id: "openai".into(),
                api_key: Some("sk-saved".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(require_connection_key(&saved, &record).is_ok());
    }

    #[test]
    fn migration_converts_legacy_settings() {
        let home = temp_home("migration");
        let conn = open_test_db();
        crate::db::migrations::settings_set(&conn, "llm_provider", "anthropic").unwrap();
        crate::config::write_to(
            &home,
            &crate::config::Config {
                github_pat: Some("ghp_keep".into()),
                llm_api_key: Some("sk-ant-legacy".into()),
                ..Default::default()
            },
        )
        .unwrap();

        migrate_legacy_llm_settings_from(&home, &conn).unwrap();

        let file = read_connections_from(&home);
        assert_eq!(file.active.as_deref(), Some("anthropic"));
        let rec = &file.connections[0];
        assert_eq!(rec.provider, "anthropic");
        assert_eq!(rec.api_key.as_deref(), Some("sk-ant-legacy"));
        assert_eq!(
            rec.default_model.as_deref(),
            Some("claude-haiku-4-5-20251001")
        );
        assert_eq!(rec.status, "ready");

        // legacy key removed, PAT kept
        let config = crate::config::read_from(&home);
        assert_eq!(config.llm_api_key, None);
        assert_eq!(config.github_pat.as_deref(), Some("ghp_keep"));

        // idempotent: second run is a no-op
        migrate_legacy_llm_settings_from(&home, &conn).unwrap();
        assert_eq!(read_connections_from(&home).connections.len(), 1);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migration_ollama_carries_base_url_without_key() {
        let home = temp_home("migration-ollama");
        let conn = open_test_db();
        crate::db::migrations::settings_set(&conn, "llm_provider", "ollama").unwrap();
        crate::db::migrations::settings_set(&conn, "ollama_url", "http://127.0.0.1:11434").unwrap();
        crate::db::migrations::settings_set(&conn, "ollama_model", "llama3.2").unwrap();

        migrate_legacy_llm_settings_from(&home, &conn).unwrap();

        let file = read_connections_from(&home);
        let rec = &file.connections[0];
        assert_eq!(rec.provider, "ollama");
        assert_eq!(rec.api_key, None);
        assert_eq!(
            rec.meta
                .as_ref()
                .and_then(|m| m.get("base_url"))
                .map(String::as_str),
            Some("http://127.0.0.1:11434")
        );
        assert_eq!(rec.default_model.as_deref(), Some("llama3.2"));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn migration_skips_fresh_install() {
        let home = temp_home("migration-fresh");
        let conn = open_test_db();
        migrate_legacy_llm_settings_from(&home, &conn).unwrap();
        assert!(!connections_path_from(&home).exists());
        let _ = fs::remove_dir_all(&home);
    }
}
