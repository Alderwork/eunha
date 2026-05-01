use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Config {
    pub github_pat: Option<String>,
    pub llm_api_key: Option<String>,
}

fn config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".eunha").join("config.toml")
}

pub fn read() -> Config {
    let path = config_path();
    let Ok(contents) = fs::read_to_string(&path) else {
        return Config::default();
    };
    toml::from_str(&contents).unwrap_or_default()
}

pub fn write(config: &Config) -> Result<(), String> {
    let path = config_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let contents = toml::to_string(config).map_err(|e| e.to_string())?;
    fs::write(&path, &contents).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&path, perms);
    }
    Ok(())
}

pub fn get_secret(key: &str) -> Option<String> {
    let config = read();
    match key {
        "github_pat" => config.github_pat.filter(|s| !s.is_empty()),
        "llm_api_key" => config.llm_api_key.filter(|s| !s.is_empty()),
        _ => None,
    }
}

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let mut config = read();
    match key {
        "github_pat" => config.github_pat = Some(value.to_string()),
        "llm_api_key" => config.llm_api_key = Some(value.to_string()),
        _ => return Err(format!("Unknown secret key: {key}")),
    }
    write(&config)
}
