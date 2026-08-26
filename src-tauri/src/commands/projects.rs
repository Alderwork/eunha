use crate::db::DbState;
use crate::models::{GitStatusSummary, Project, ProjectDraft, Workspace};
use rusqlite::{params, OptionalExtension, Row};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

#[derive(Debug)]
enum ProjectInput {
    Github(String),
    Local(PathBuf),
}

#[derive(Deserialize)]
struct GithubRepository {
    full_name: String,
    html_url: String,
    name: String,
    description: Option<String>,
    default_branch: Option<String>,
    private: bool,
}

fn expand_local_path(input: &str) -> PathBuf {
    if input == "~" {
        return crate::config::home_dir();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return crate::config::home_dir().join(rest);
    }
    PathBuf::from(input)
}

fn parse_github_full_name(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('/').trim_end_matches(".git");
    if let Some(path) = trimmed.strip_prefix("git@github.com:") {
        return normalize_owner_repo(path);
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        let url = reqwest::Url::parse(trimmed).ok()?;
        if !matches!(url.host_str(), Some("github.com") | Some("www.github.com")) {
            return None;
        }
        return normalize_owner_repo(url.path().trim_matches('/'));
    }
    normalize_owner_repo(trimmed)
}

fn normalize_owner_repo(value: &str) -> Option<String> {
    let mut parts = value.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim().trim_end_matches(".git");
    if owner.is_empty()
        || repo.is_empty()
        || parts.next().is_some()
        || !owner.chars().all(valid_github_char)
        || !repo.chars().all(valid_github_char)
    {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn valid_github_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')
}

fn normalize_input(input: &str) -> Result<ProjectInput, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter a GitHub repository or local path.".to_string());
    }
    let path = expand_local_path(trimmed);
    let path_like = path.is_absolute()
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || trimmed.starts_with("~/")
        || path.exists();
    if path_like {
        let canonical = path
            .canonicalize()
            .map_err(|_| "Local path does not exist or cannot be accessed.".to_string())?;
        return Ok(ProjectInput::Local(canonical));
    }
    parse_github_full_name(trimmed)
        .map(ProjectInput::Github)
        .ok_or_else(|| "Enter owner/repo, a GitHub URL, or an existing local path.".to_string())
}

fn git_output(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("Could not start git: {e}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "Git inspection failed.".into()
        } else {
            message
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn inspect_workspace(path: &Path) -> Result<(PathBuf, Option<String>, GitStatusSummary), String> {
    let root_raw = git_output(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| "The selected path is not inside a Git repository.".to_string())?;
    let root = PathBuf::from(root_raw)
        .canonicalize()
        .map_err(|_| "Git returned an inaccessible repository root.".to_string())?;
    let branch = git_output(&root, &["branch", "--show-current"])
        .ok()
        .filter(|s| !s.is_empty());
    let head_sha = git_output(&root, &["rev-parse", "HEAD"])
        .ok()
        .filter(|s| !s.is_empty());
    let porcelain = git_output(&root, &["status", "--porcelain=v1"])?;
    let mut status = GitStatusSummary {
        branch,
        head_sha,
        clean: porcelain.is_empty(),
        ..Default::default()
    };
    for line in porcelain.lines() {
        if line.len() < 3 {
            continue;
        }
        let code = &line[..2];
        let file = line[3..].trim().to_string();
        status.changed_files.push(file);
        if code == "??" {
            status.untracked += 1;
            continue;
        }
        if code.as_bytes()[0] != b' ' {
            status.staged += 1;
        }
        if code.as_bytes()[1] != b' ' {
            status.unstaged += 1;
        }
    }
    Ok((root, default_branch(path), status))
}

fn default_branch(path: &Path) -> Option<String> {
    git_output(
        path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )
    .ok()
    .and_then(|value| value.strip_prefix("origin/").map(str::to_string))
    .or_else(|| {
        for candidate in ["main", "master"] {
            if git_output(
                path,
                &["show-ref", "--verify", &format!("refs/heads/{candidate}")],
            )
            .is_ok()
            {
                return Some(candidate.to_string());
            }
        }
        None
    })
}

fn remote_origin(path: &Path) -> Option<String> {
    git_output(path, &["remote", "get-url", "origin"])
        .ok()
        .filter(|s| !s.is_empty())
}

async fn github_metadata(full_name: &str) -> Result<GithubRepository, String> {
    let mut request = reqwest::Client::new()
        .get(format!("https://api.github.com/repos/{full_name}"))
        .header("User-Agent", "eunha/1.0")
        .header("Accept", "application/vnd.github+json");
    if let Some(token) = crate::config::get_secret("github_pat").filter(|token| !token.is_empty()) {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("GitHub is unavailable: {e}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Public GitHub repository not found.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("GitHub returned {}.", response.status()));
    }
    let repository: GithubRepository = response
        .json()
        .await
        .map_err(|e| format!("Invalid GitHub response: {e}"))?;
    if repository.private {
        return Err("Private repositories are outside the MVP scope.".to_string());
    }
    Ok(repository)
}

fn clone_suggestion(full_name: &str) -> String {
    let repo = full_name.split('/').next_back().unwrap_or("project");
    crate::config::home_dir()
        .join("Developer")
        .join(repo)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
pub async fn inspect_project_input(input: String) -> Result<ProjectDraft, String> {
    match normalize_input(&input)? {
        ProjectInput::Github(full_name) => {
            let metadata = github_metadata(&full_name).await?;
            Ok(ProjectDraft {
                github_full_name: Some(metadata.full_name.clone()),
                remote_url: Some(metadata.html_url),
                display_name: metadata.name,
                description: metadata.description,
                local_path: None,
                clone_suggestion: Some(clone_suggestion(&metadata.full_name)),
                workspace_status: None,
                default_branch: metadata.default_branch,
                warnings: vec![
                    "No local workspace is connected yet. Clone remains a user-approved action."
                        .into(),
                ],
            })
        }
        ProjectInput::Local(path) => {
            let (root, default_branch, status) = inspect_workspace(&path)?;
            let remote_url = remote_origin(&root);
            let github_full_name = remote_url.as_deref().and_then(parse_github_full_name);
            let mut warnings = Vec::new();
            let metadata = if let Some(full_name) = github_full_name.as_deref() {
                match github_metadata(full_name).await {
                    Ok(metadata) => Some(metadata),
                    Err(error) if error.contains("Private repositories") => return Err(error),
                    Err(error) => {
                        warnings.push(error);
                        None
                    }
                }
            } else {
                warnings
                    .push("No GitHub origin was detected; the project will be local-only.".into());
                None
            };
            let display_name = metadata
                .as_ref()
                .map(|m| m.name.clone())
                .or_else(|| {
                    root.file_name()
                        .map(|name| name.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| "Local project".into());
            Ok(ProjectDraft {
                github_full_name,
                remote_url: metadata.as_ref().map(|m| m.html_url.clone()).or(remote_url),
                display_name,
                description: metadata.and_then(|m| m.description),
                local_path: Some(root.to_string_lossy().to_string()),
                clone_suggestion: None,
                workspace_status: Some(status),
                default_branch,
                warnings,
            })
        }
    }
}

fn project_id(draft: &ProjectDraft) -> String {
    draft
        .github_full_name
        .as_ref()
        .map(|name| format!("github:{name}"))
        .unwrap_or_else(|| {
            format!(
                "local:{}",
                draft.local_path.as_deref().unwrap_or(&draft.display_name)
            )
        })
}

fn workspace_id(path: &str) -> String {
    format!("workspace:{path}")
}

#[tauri::command]
pub fn save_project(
    draft: ProjectDraft,
    role_mode: String,
    state: State<'_, DbState>,
) -> Result<Project, String> {
    if !matches!(role_mode.as_str(), "contributor" | "maintainer" | "owner") {
        return Err("Invalid project role.".into());
    }
    let id = project_id(&draft);
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO projects (id, github_full_name, remote_url, display_name, description, default_branch, role_mode) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![id, draft.github_full_name, draft.remote_url, draft.display_name, draft.description, draft.default_branch, role_mode],
    ).map_err(|e| if e.to_string().contains("UNIQUE") { "This project or workspace is already added.".into() } else { e.to_string() })?;
    if let (Some(path), Some(status)) = (draft.local_path, draft.workspace_status) {
        tx.execute(
            "INSERT INTO workspaces (id, project_id, local_path, default_branch, current_branch, head_sha, git_status_json, last_scanned_at) VALUES (?1,?2,?3,?4,?5,?6,?7,datetime('now'))",
            params![workspace_id(&path), id, path, draft.default_branch, status.branch, status.head_sha, serde_json::to_string(&status).map_err(|e| e.to_string())?],
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    get_project_inner(&state, &id)
}

fn workspace_from_row(row: &Row<'_>, offset: usize) -> rusqlite::Result<Option<Workspace>> {
    let id: Option<String> = row.get(offset)?;
    Ok(id.map(|id| {
        let raw: String = row.get(offset + 6).unwrap_or_else(|_| "{}".into());
        Workspace {
            id,
            project_id: row.get(offset + 1).unwrap_or_default(),
            local_path: row.get(offset + 2).unwrap_or_default(),
            default_branch: row.get(offset + 3).ok(),
            current_branch: row.get(offset + 4).ok(),
            head_sha: row.get(offset + 5).ok(),
            git_status: serde_json::from_str(&raw).unwrap_or_default(),
            last_scanned_at: row.get(offset + 7).ok(),
        }
    }))
}

const PROJECT_SELECT: &str = "SELECT p.id,p.github_full_name,p.remote_url,p.display_name,p.description,p.default_branch,p.role_mode,p.created_at,p.updated_at,w.id,w.project_id,w.local_path,w.default_branch,w.current_branch,w.head_sha,w.git_status_json,w.last_scanned_at FROM projects p LEFT JOIN workspaces w ON w.project_id=p.id";

fn project_from_row(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        github_full_name: row.get(1)?,
        remote_url: row.get(2)?,
        display_name: row.get(3)?,
        description: row.get(4)?,
        default_branch: row.get(5)?,
        role_mode: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        workspace: workspace_from_row(row, 9)?,
    })
}

fn get_project_inner(state: &State<'_, DbState>, id: &str) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("{PROJECT_SELECT} WHERE p.id=?1"),
        [id],
        project_from_row,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_projects(state: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare(&format!(
            "{PROJECT_SELECT} ORDER BY p.updated_at DESC, p.display_name COLLATE NOCASE"
        ))
        .map_err(|e| e.to_string())?;
    let projects = statement
        .query_map([], project_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(projects)
}

#[tauri::command]
pub fn get_project(project_id: String, state: State<'_, DbState>) -> Result<Project, String> {
    get_project_inner(&state, &project_id)
}

#[tauri::command]
pub fn set_project_role(
    project_id: String,
    role_mode: String,
    state: State<'_, DbState>,
) -> Result<Project, String> {
    if !matches!(role_mode.as_str(), "contributor" | "maintainer" | "owner") {
        return Err("Invalid project role.".into());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE projects SET role_mode=?1,updated_at=datetime('now') WHERE id=?2",
            params![role_mode, project_id],
        )
        .map_err(|e| e.to_string())?;
    drop(conn);
    if changed == 0 {
        return Err("Project not found.".into());
    }
    get_project_inner(&state, &project_id)
}

#[tauri::command]
pub fn refresh_project_workspace(
    project_id: String,
    state: State<'_, DbState>,
) -> Result<Project, String> {
    let path: Option<String> = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT local_path FROM workspaces WHERE project_id=?1",
            [&project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    };
    let path = path.ok_or_else(|| "This project has no local workspace.".to_string())?;
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|_| "The connected workspace is no longer accessible.".to_string())?;
    let (root, default_branch, status) = inspect_workspace(&canonical)?;
    if root.to_string_lossy() != path {
        return Err("The workspace path no longer resolves to its saved Git root.".into());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE workspaces SET default_branch=?1,current_branch=?2,head_sha=?3,git_status_json=?4,last_scanned_at=datetime('now') WHERE project_id=?5", params![default_branch, status.branch, status.head_sha, serde_json::to_string(&status).map_err(|e| e.to_string())?, project_id]).map_err(|e| e.to_string())?;
    drop(conn);
    get_project_inner(&state, &project_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_inputs_are_strictly_normalized() {
        assert_eq!(
            parse_github_full_name("https://github.com/rust-lang/rust.git"),
            Some("rust-lang/rust".into())
        );
        assert_eq!(
            parse_github_full_name("git@github.com:tauri-apps/tauri.git"),
            Some("tauri-apps/tauri".into())
        );
        assert_eq!(
            parse_github_full_name("owner/repo"),
            Some("owner/repo".into())
        );
        assert_eq!(
            parse_github_full_name("https://gitlab.com/owner/repo"),
            None
        );
        assert_eq!(parse_github_full_name("owner/repo/issues"), None);
    }

    #[test]
    fn non_existing_absolute_path_is_not_reinterpreted_as_github() {
        assert!(
            matches!(normalize_input("/definitely/not/a/real/eunha/path"), Err(message) if message.contains("does not exist"))
        );
    }

    #[test]
    fn current_repository_can_be_inspected_without_mutation() {
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let (root, _, status) = inspect_workspace(&here).unwrap();
        assert_eq!(root, here.canonicalize().unwrap());
        assert!(status.branch.is_some());
        assert!(status.head_sha.is_some());
    }
}
