//! Conduit bridge: connection storage (`~/.eunha/connections.toml`, 0600) and
//! the credential-injecting HTTP proxy the TS `@conduit/core` talks to.
//!
//! Security model: the webview never receives API keys. `conduit_list` strips
//! them; `conduit_http` is the only code path that touches them, and it only
//! injects keys into requests whose target host is on the proxy allowlist.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

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

/// Upsert by id. A save that carries no key never wipes an existing one:
/// JS-side status updates omit credentials, key entries include them.
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

// ── IPC boundary (camelCase JSON, matching TS StoredConnection) ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub id: String,
    pub provider: String,
    pub status: String,
    pub credentials: Option<String>,
    pub default_model: Option<String>,
    pub validated_at: Option<String>,
    pub meta: Option<HashMap<String, String>>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ConnectionInput> for ConnectionRecord {
    fn from(input: ConnectionInput) -> Self {
        ConnectionRecord {
            id: input.id,
            provider: input.provider,
            status: input.status,
            api_key: input.credentials.filter(|k| !k.is_empty()),
            default_model: input.default_model,
            validated_at: input.validated_at,
            meta: input.meta,
            created_at: input.created_at,
            updated_at: input.updated_at,
        }
    }
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
    upsert(&mut file, input.into());
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

// ── HTTP proxy with credential injection ─────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AuthScheme {
    Bearer,
    Header {
        name: String,
        extra: Option<HashMap<String, String>>,
    },
    Query {
        name: String,
    },
    None,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

/// Remote hosts the proxy will attach credentials to. Localhost is always
/// allowed (self-hosted providers like Ollama carry no key).
/// Adding a provider to Conduit means adding its host here.
const ALLOWED_REMOTE_HOSTS: &[&str] = &[
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "openrouter.ai",
    "opencode.ai",
    "api.deepseek.com",
    "api.x.ai",
    "dashscope-intl.aliyuncs.com",
    "dashscope.aliyuncs.com",
    "api.z.ai",
    "api.moonshot.ai",
    "api.moonshot.cn",
    "api.minimax.io",
    "api.minimaxi.com",
    "api.stepfun.com",
    "api.xiaomimimo.com",
    "api.upstage.ai",
    "api.arcee.ai",
    "integrate.api.nvidia.com",
    "router.huggingface.co",
    "api.fireworks.ai",
    "api.deepinfra.com",
    "api.novita.ai",
    "api.gmi-serving.com",
    "ollama.com",
    "api.kilo.ai",
    "inference-api.nousresearch.com",
    "tokenhub.tencentmaas.com",
    "api.githubcopilot.com",
];

/// Azure OpenAI / Foundry endpoints are per-resource subdomains.
fn is_azure_openai_host(host: &str) -> bool {
    host == "openai.azure.com" || host.ends_with(".openai.azure.com")
}

fn is_localhost_host(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "::1"
}

pub fn url_allowed(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    match parsed.host_str() {
        Some(host) if is_localhost_host(host) => true,
        Some(host) => ALLOWED_REMOTE_HOSTS.contains(&host) || is_azure_openai_host(host),
        None => false,
    }
}

async fn proxy_send(
    home: &Path,
    connection_id: &str,
    auth: &AuthScheme,
    request: &ProxyRequest,
) -> Result<serde_json::Value, String> {
    if !url_allowed(&request.url) {
        return Err(format!("Blocked by proxy allowlist: {}", request.url));
    }

    let file = read_connections_from(home);
    let conn = file.connections.iter().find(|c| c.id == connection_id);

    // Keep the "Ollama is auto-managed" invariant for proxied localhost
    // calls — for the Ollama provider only, so other localhost providers
    // (LM Studio) never spawn `ollama serve` on their port.
    if let Some(conn) = conn {
        if conn.provider == "ollama" {
            if let Ok(parsed) = reqwest::Url::parse(&request.url) {
                if parsed.host_str().is_some_and(is_localhost_host) {
                    crate::ollama::ensure_running(&parsed.origin().ascii_serialization()).await?;
                }
            }
        }
    }

    // The key is read here, injected here, and never returned to the caller.
    let key: Option<String> = match auth {
        AuthScheme::None => None,
        _ => Some(
            conn.ok_or_else(|| format!("Unknown connection: {connection_id}"))?
                .api_key
                .clone()
                .filter(|k| !k.is_empty())
                .ok_or_else(|| format!("No API key stored for connection: {connection_id}"))?,
        ),
    };

    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|e| format!("Invalid method: {e}"))?;

    let mut url = request.url.clone();
    if let (AuthScheme::Query { name }, Some(k)) = (auth, &key) {
        let mut parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
        parsed.query_pairs_mut().append_pair(name, k);
        url = parsed.to_string();
    }

    let client = reqwest::Client::new();
    let mut req = client.request(method, &url);
    if let Some(headers) = &request.headers {
        for (k, v) in headers {
            req = req.header(k, v);
        }
    }
    match (auth, &key) {
        (AuthScheme::Bearer, Some(k)) => {
            req = req.bearer_auth(k);
        }
        (AuthScheme::Header { name, extra }, Some(k)) => {
            req = req.header(name, k);
            if let Some(extra) = extra {
                for (hk, hv) in extra {
                    req = req.header(hk, hv);
                }
            }
        }
        _ => {}
    }
    if let Some(body) = &request.body {
        req = req.header("Content-Type", "application/json").body(body.clone());
    }

    let resp = req
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    Ok(serde_json::json!({ "status": status, "body": body }))
}

#[tauri::command]
pub async fn conduit_http(
    connection_id: String,
    auth: AuthScheme,
    request: ProxyRequest,
) -> Result<serde_json::Value, String> {
    proxy_send(&crate::config::home_dir(), &connection_id, &auth, &request).await
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

    let legacy_key = crate::config::read_from(home).llm_api_key.filter(|k| !k.is_empty());
    let provider =
        settings_get(conn, "llm_provider").unwrap_or_else(|| "openai".to_string());

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
        let dir = std::env::temp_dir().join(format!(
            "eunha-conduit-test-{}-{}",
            tag,
            std::process::id()
        ));
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
    fn proxy_allowlist() {
        assert!(url_allowed("https://api.openai.com/v1/models"));
        assert!(url_allowed("https://api.anthropic.com/v1/models"));
        assert!(url_allowed(
            "https://generativelanguage.googleapis.com/v1beta/models"
        ));
        assert!(url_allowed("https://openrouter.ai/api/v1/models"));
        assert!(url_allowed("http://localhost:11434/api/tags"));
        assert!(url_allowed("http://127.0.0.1:11434/api/version"));

        // Preset providers added with the expanded registry.
        assert!(url_allowed("https://api.deepseek.com/models"));
        assert!(url_allowed("https://api.x.ai/v1/models"));
        assert!(url_allowed(
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models"
        ));
        assert!(url_allowed("https://api.moonshot.cn/v1/models"));
        assert!(url_allowed("https://router.huggingface.co/v1/models"));
        assert!(url_allowed("https://ollama.com/v1/models"));

        // Azure Foundry: per-resource subdomains of openai.azure.com.
        assert!(url_allowed(
            "https://my-resource.openai.azure.com/openai/v1/models"
        ));

        assert!(!url_allowed("https://evil.example.com/collect"));
        assert!(!url_allowed("https://api.openai.com.evil.com/v1/models"));
        assert!(!url_allowed("https://openai.azure.com.evil.com/openai/v1/models"));
        assert!(!url_allowed("https://notopenai.azure.com/openai/v1/models"));
        assert!(!url_allowed("not a url"));
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
        assert_eq!(rec.default_model.as_deref(), Some("claude-haiku-4-5-20251001"));
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
            rec.meta.as_ref().and_then(|m| m.get("base_url")).map(String::as_str),
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

    /// End-to-end: the proxy reads the key from connections.toml and injects
    /// it into the outgoing request — the response carries no key material.
    /// A non-Ollama provider must NOT trigger the auto-manage health probe.
    #[tokio::test]
    async fn proxy_injects_bearer_key_from_storage() {
        let home = temp_home("proxy");
        write_connections_to(
            &home,
            &ConnectionsFile {
                active: Some("openai".into()),
                connections: vec![ConnectionRecord {
                    id: "openai".into(),
                    provider: "openai".into(),
                    status: "ready".into(),
                    api_key: Some("sk-secret".into()),
                    ..Default::default()
                }],
            },
        )
        .unwrap();

        let requests = serve_n_requests(1);
        let addr = requests.addr;

        let res = proxy_send(
            &home,
            "openai",
            &AuthScheme::Bearer,
            &ProxyRequest {
                method: "GET".into(),
                url: format!("http://{addr}/v1/models"),
                headers: None,
                body: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(res["status"], 200);
        let requests = requests.join();
        assert_eq!(requests.len(), 1);
        let proxied = requests[0].to_lowercase();
        assert!(
            proxied.contains("authorization: bearer sk-secret"),
            "proxied request missing injected key:\n{proxied}"
        );
        // The response to the webview carries status + body only.
        assert!(res.get("api_key").is_none());
        let _ = fs::remove_dir_all(&home);
    }

    /// The Ollama provider keeps the auto-manage invariant: a health probe
    /// hits the server first (no credentials), then the proxied request.
    #[tokio::test]
    async fn proxy_probes_ollama_health_before_localhost_request() {
        let home = temp_home("proxy-ollama");
        write_connections_to(
            &home,
            &ConnectionsFile {
                active: Some("ollama".into()),
                connections: vec![ConnectionRecord {
                    id: "ollama".into(),
                    provider: "ollama".into(),
                    status: "ready".into(),
                    ..Default::default()
                }],
            },
        )
        .unwrap();

        let requests = serve_n_requests(2);
        let addr = requests.addr;

        let res = proxy_send(
            &home,
            "ollama",
            &AuthScheme::None,
            &ProxyRequest {
                method: "GET".into(),
                url: format!("http://{addr}/api/tags"),
                headers: None,
                body: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(res["status"], 200);
        let requests = requests.join();
        assert_eq!(requests.len(), 2);
        assert!(
            requests[0].to_lowercase().contains("/api/version"),
            "first request should be the ollama health probe:\n{}",
            requests[0]
        );
        let _ = fs::remove_dir_all(&home);
    }

    /// A tiny HTTP server that answers `n` requests with `{}` and records them.
    fn serve_n_requests(n: usize) -> ServedRequests {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let mut requests: Vec<String> = Vec::new();
            for _ in 0..n {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 1024];
                loop {
                    let n = stream.read(&mut chunk).unwrap();
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                requests.push(String::from_utf8_lossy(&buf).to_string());
                let body = "{}";
                let resp = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(resp.as_bytes()).unwrap();
            }
            requests
        });
        ServedRequests { addr, handle }
    }

    struct ServedRequests {
        addr: std::net::SocketAddr,
        handle: std::thread::JoinHandle<Vec<String>>,
    }

    impl ServedRequests {
        fn join(self) -> Vec<String> {
            self.handle.join().unwrap()
        }
    }
}
