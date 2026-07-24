//! Auto-manage a local Ollama server so users never run `ollama serve` themselves.
//!
//! When the Ollama provider is selected, `ensure_running` probes the configured
//! base URL; if nothing responds and the URL points at localhost, we spawn
//! `ollama serve` as a detached child process and wait until it answers.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const HEALTH_TIMEOUT: Duration = Duration::from_millis(1500);
const STARTUP_DEADLINE: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Strip the scheme and path from a base URL, returning "host[:port]".
fn authority_of(base: &str) -> &str {
    let no_scheme = base
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(base);
    no_scheme.split('/').next().unwrap_or("")
}

/// True when the base URL points at this machine (the only case where we can
/// spawn and manage a server ourselves).
fn is_localhost(base: &str) -> bool {
    let authority = authority_of(base);
    let host = if let Some(rest) = authority.strip_prefix('[') {
        // Bracketed IPv6: host runs to the closing ']'.
        rest.split(']').next().unwrap_or("")
    } else {
        authority.split(':').next().unwrap_or("")
    };
    host == "localhost" || host == "127.0.0.1" || host == "::1"
}

/// Locate the ollama binary: PATH lookup first, then well-known install dirs.
fn find_binary() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = {
        let mut v: Vec<PathBuf> = std::env::var("PATH")
            .unwrap_or_default()
            .split(':')
            .filter(|p| !p.is_empty())
            .map(|p| PathBuf::from(p).join("ollama"))
            .collect();
        // Homebrew / manual installs not always on the app bundle's PATH.
        v.push(PathBuf::from("/opt/homebrew/bin/ollama"));
        v.push(PathBuf::from("/usr/local/bin/ollama"));
        v.push(PathBuf::from("/usr/bin/ollama"));
        // macOS Ollama.app ships the CLI inside the bundle.
        v.push(PathBuf::from(
            "/Applications/Ollama.app/Contents/Resources/ollama",
        ));
        v
    };
    candidates.into_iter().find(|p| p.is_file())
}

async fn is_healthy(client: &reqwest::Client, base: &str) -> bool {
    client
        .get(format!("{base}/api/version"))
        .timeout(HEALTH_TIMEOUT)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Make sure an Ollama server answers at `base`, starting one if needed.
///
/// Only manages localhost URLs — a remote base URL that is down surfaces as a
/// plain connection error.
pub async fn ensure_running(base: &str) -> Result<(), String> {
    let client = reqwest::Client::new();

    if is_healthy(&client, base).await {
        return Ok(());
    }
    if !is_localhost(base) {
        return Err(format!(
            "Ollama is not reachable at {base}. Start it on that machine, or fix the Base URL in Settings."
        ));
    }

    let binary = find_binary().ok_or_else(|| {
        "Ollama is not installed. Install it from https://ollama.com/download (or `brew install ollama`), then try again."
            .to_string()
    })?;

    log::info!("ollama not responding at {base}; spawning `ollama serve` ({binary:?})");

    let mut cmd = Command::new(&binary);
    cmd.arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Non-default host/port → tell the server where to bind.
    let authority = authority_of(base);
    if authority != "localhost:11434" && authority != "127.0.0.1:11434" && !authority.is_empty() {
        cmd.env("OLLAMA_HOST", authority);
    }

    // Detach into its own process group so the server survives eunha and
    // isn't hit by Ctrl+C sent to our process group in dev.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to start `ollama serve`: {e}"))?;
    // Deliberately drop the Child handle — the server keeps running.

    let deadline = Instant::now() + STARTUP_DEADLINE;
    while Instant::now() < deadline {
        if is_healthy(&client, base).await {
            log::info!("ollama is healthy at {base}");
            return Ok(());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    Err(format!(
        "Started `ollama serve` but it did not respond at {base} within {}s.",
        STARTUP_DEADLINE.as_secs()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_detection() {
        assert!(is_localhost("http://localhost:11434"));
        assert!(is_localhost("http://127.0.0.1:11434"));
        assert!(is_localhost("http://[::1]:11434"));
        assert!(is_localhost("https://localhost:9999/api"));
        assert!(!is_localhost("http://192.168.1.10:11434"));
        assert!(!is_localhost("https://ollama.example.com"));
    }

    #[test]
    fn authority_extraction() {
        assert_eq!(authority_of("http://localhost:11434"), "localhost:11434");
        assert_eq!(authority_of("https://host:1/path"), "host:1");
        assert_eq!(authority_of("localhost:11434"), "localhost:11434");
    }
}

