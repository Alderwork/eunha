use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Config {
    pub github_pat: Option<String>,
    pub llm_api_key: Option<String>,
    pub onboarded_at: Option<String>,
}

pub fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()))
}

fn config_path_from(home: &Path) -> PathBuf {
    home.join(".eunha").join("config.toml")
}

pub fn read_from(home: &Path) -> Config {
    let path = config_path_from(home);
    let Ok(contents) = fs::read_to_string(&path) else {
        return Config::default();
    };
    toml::from_str(&contents).unwrap_or_default()
}

pub fn write_to(home: &Path, config: &Config) -> Result<(), String> {
    let path = config_path_from(home);
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

pub fn read() -> Config {
    read_from(&home_dir())
}

pub fn write(config: &Config) -> Result<(), String> {
    write_to(&home_dir(), config)
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



pub fn get_onboarded_at() -> Option<String> {
    read().onboarded_at.filter(|s| !s.is_empty())
}

pub fn set_onboarded_at(value: &str) -> Result<(), String> {
    let mut config = read();
    config.onboarded_at = Some(value.to_string());
    write(&config)
}
