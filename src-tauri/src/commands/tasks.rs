use crate::commands::projects::{git_output, inspect_workspace};
use crate::db::DbState;
use crate::models::{
    ContributionTask, DetectedTool, RecentCommit, TaskGitContext, TaskWorkspace, Workspace,
};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use std::path::{Path, PathBuf};
use tauri::State;

const TASK_SELECT: &str = "
    SELECT t.id,t.project_id,p.display_name,p.github_full_name,t.issue_id,i.number,i.html_url,
           t.workspace_id,t.title,t.status,t.branch_name,t.notes,
           strftime('%Y-%m-%dT%H:%M:%SZ',t.created_at),
           strftime('%Y-%m-%dT%H:%M:%SZ',t.updated_at)
    FROM contribution_tasks t
    JOIN projects p ON p.id=t.project_id
    LEFT JOIN project_issues i ON i.github_issue_id=t.issue_id";

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<ContributionTask> {
    Ok(ContributionTask {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        github_full_name: row.get(3)?,
        issue_id: row.get(4)?,
        issue_number: row.get(5)?,
        issue_url: row.get(6)?,
        workspace_id: row.get(7)?,
        title: row.get(8)?,
        status: row.get(9)?,
        branch_name: row.get(10)?,
        notes: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn get_task(conn: &rusqlite::Connection, task_id: &str) -> Result<ContributionTask, String> {
    conn.query_row(
        &format!("{TASK_SELECT} WHERE t.id=?1"),
        [task_id],
        task_from_row,
    )
    .map_err(|_| "Task not found.".to_string())
}

fn valid_transition(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    if matches!(to, "blocked" | "abandoned") && from != "submitted" {
        return true;
    }
    matches!(
        (from, to),
        ("candidate", "selected")
            | ("selected", "preparing")
            | ("preparing", "in_progress")
            | ("blocked", "selected")
            | ("blocked", "preparing")
            | ("blocked", "in_progress")
            | ("abandoned", "selected")
    )
}

fn validate_branch_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed != name || trimmed.len() > 160 {
        return Err("Enter a valid branch name.".into());
    }
    if trimmed.starts_with('-') || trimmed.contains(char::is_whitespace) {
        return Err("Branch names cannot start with '-' or contain whitespace.".into());
    }
    Ok(())
}

fn require_mutation_confirmation(confirmed: bool) -> Result<(), String> {
    if confirmed {
        Ok(())
    } else {
        Err("Branch creation requires explicit confirmation.".into())
    }
}

#[tauri::command]
pub fn create_contribution_task(
    project_id: String,
    issue_id: Option<i64>,
    title: String,
    notes: Option<String>,
    state: State<'_, DbState>,
) -> Result<ContributionTask, String> {
    let title = title.trim();
    if title.is_empty() || title.len() > 240 {
        return Err("Task title must be between 1 and 240 characters.".into());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let workspace_id: Option<String> = conn
        .query_row(
            "SELECT id FROM workspaces WHERE project_id=?1 ORDER BY created_at LIMIT 1",
            [&project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(issue_id) = issue_id {
        let belongs: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM project_issues WHERE github_issue_id=?1 AND project_id=?2 AND is_pull_request=0)",
                params![issue_id, project_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !belongs {
            return Err("The selected issue does not belong to this project.".into());
        }
    }
    let id = format!(
        "task:{}",
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    conn.execute(
        "INSERT INTO contribution_tasks (id,project_id,issue_id,workspace_id,title,status,notes)
         VALUES (?1,?2,?3,?4,?5,'selected',?6)",
        params![
            id,
            project_id,
            issue_id,
            workspace_id,
            title,
            notes.unwrap_or_default()
        ],
    )
    .map_err(|e| e.to_string())?;
    get_task(&conn, &id)
}

#[tauri::command]
pub fn list_contribution_tasks(state: State<'_, DbState>) -> Result<Vec<ContributionTask>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare(&format!(
            "{TASK_SELECT} ORDER BY t.updated_at DESC,t.created_at DESC"
        ))
        .map_err(|e| e.to_string())?;
    let tasks = statement
        .query_map([], task_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(tasks)
}

#[tauri::command]
pub fn update_task_status(
    task_id: String,
    status: String,
    state: State<'_, DbState>,
) -> Result<ContributionTask, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let current = get_task(&conn, &task_id)?;
    if matches!(status.as_str(), "ready_for_pr" | "submitted") {
        return Err("PR readiness states require the Phase 4 readiness flow.".into());
    }
    if !valid_transition(&current.status, &status) {
        return Err(format!(
            "Task cannot move from {} to {}.",
            current.status, status
        ));
    }
    conn.execute(
        "UPDATE contribution_tasks SET status=?1,updated_at=datetime('now') WHERE id=?2",
        params![status, task_id],
    )
    .map_err(|e| e.to_string())?;
    get_task(&conn, &task_id)
}

#[tauri::command]
pub fn update_task_notes(
    task_id: String,
    notes: String,
    state: State<'_, DbState>,
) -> Result<ContributionTask, String> {
    if notes.len() > 50_000 {
        return Err("Task notes are limited to 50,000 characters.".into());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE contribution_tasks SET notes=?1,updated_at=datetime('now') WHERE id=?2",
            params![notes, task_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Task not found.".into());
    }
    get_task(&conn, &task_id)
}

fn workspace_for_task(
    conn: &rusqlite::Connection,
    task: &ContributionTask,
) -> Result<Option<Workspace>, String> {
    conn.query_row(
        "SELECT id,project_id,local_path,default_branch,current_branch,head_sha,git_status_json,strftime('%Y-%m-%dT%H:%M:%SZ',last_scanned_at)
         FROM workspaces WHERE id=?1",
        [task.workspace_id.as_deref().unwrap_or("")],
        |row| {
            let raw: String = row.get(6)?;
            Ok(Workspace {
                id: row.get(0)?,
                project_id: row.get(1)?,
                local_path: row.get(2)?,
                default_branch: row.get(3)?,
                current_branch: row.get(4)?,
                head_sha: row.get(5)?,
                git_status: serde_json::from_str(&raw).unwrap_or_default(),
                last_scanned_at: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn recent_commits(root: &Path) -> Vec<RecentCommit> {
    let Ok(raw) = git_output(
        root,
        &[
            "log",
            "-5",
            "--date=iso-strict",
            "--format=%H%x1f%s%x1f%an%x1f%aI%x1e",
        ],
    ) else {
        return Vec::new();
    };
    raw.split('\u{1e}')
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim().split('\u{1f}').collect();
            (fields.len() == 4).then(|| RecentCommit {
                sha: fields[0].to_string(),
                summary: fields[1].to_string(),
                author: fields[2].to_string(),
                authored_at: fields[3].to_string(),
            })
        })
        .collect()
}

fn live_git_context(workspace: &Workspace) -> Result<TaskGitContext, String> {
    let canonical = PathBuf::from(&workspace.local_path)
        .canonicalize()
        .map_err(|_| "The connected workspace is no longer accessible.".to_string())?;
    let (root, _, status) = inspect_workspace(&canonical)?;
    if root.to_string_lossy() != workspace.local_path {
        return Err("The workspace path no longer resolves to its saved Git root.".into());
    }
    Ok(TaskGitContext {
        status,
        diff_stat: git_output(&root, &["diff", "--stat"]).unwrap_or_default(),
        staged_diff_stat: git_output(&root, &["diff", "--cached", "--stat"]).unwrap_or_default(),
        recent_commits: recent_commits(&root),
    })
}

#[tauri::command]
pub fn get_task_workspace(
    task_id: String,
    state: State<'_, DbState>,
) -> Result<TaskWorkspace, String> {
    let (task, workspace, issue_body, verification_commands) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let task = get_task(&conn, &task_id)?;
        let workspace = workspace_for_task(&conn, &task)?;
        let issue_body = task.issue_id.and_then(|issue_id| {
            conn.query_row(
                "SELECT body FROM project_issues WHERE github_issue_id=?1",
                [issue_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
        });
        let tools_json: Option<String> = conn
            .query_row(
                "SELECT detected_tools_json FROM project_snapshots WHERE project_id=?1",
                [&task.project_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let commands = tools_json
            .and_then(|raw| serde_json::from_str::<Vec<DetectedTool>>(&raw).ok())
            .unwrap_or_default()
            .into_iter()
            .flat_map(|tool| tool.commands)
            .collect();
        (task, workspace, issue_body, commands)
    };
    let git = workspace.as_ref().map(live_git_context).transpose()?;
    Ok(TaskWorkspace {
        task,
        workspace,
        git,
        issue_body,
        verification_commands,
    })
}

#[tauri::command]
pub fn create_task_branch(
    task_id: String,
    branch_name: String,
    confirmed: bool,
    state: State<'_, DbState>,
) -> Result<TaskWorkspace, String> {
    require_mutation_confirmation(confirmed)?;
    validate_branch_name(&branch_name)?;
    let (task, workspace) = {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let task = get_task(&conn, &task_id)?;
        let workspace = workspace_for_task(&conn, &task)?
            .ok_or_else(|| "Connect a local workspace before creating a branch.".to_string())?;
        (task, workspace)
    };
    if !matches!(task.status.as_str(), "selected" | "preparing" | "blocked") {
        return Err("A branch can only be created while a task is selected or preparing.".into());
    }
    let canonical = PathBuf::from(&workspace.local_path)
        .canonicalize()
        .map_err(|_| "The connected workspace is no longer accessible.".to_string())?;
    let (root, default_branch, before) = inspect_workspace(&canonical)?;
    if root.to_string_lossy() != workspace.local_path {
        return Err("The workspace path no longer resolves to its saved Git root.".into());
    }
    git_output(&root, &["check-ref-format", "--branch", &branch_name])
        .map_err(|_| "Git rejected this branch name.".to_string())?;
    if before.branch.as_deref() != Some(branch_name.as_str()) {
        git_output(&root, &["switch", "-c", &branch_name])?;
    }
    let (_, _, status) = inspect_workspace(&root)?;
    let status_json = serde_json::to_string(&status).map_err(|e| e.to_string())?;
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE workspaces SET default_branch=COALESCE(?1,default_branch),current_branch=?2,head_sha=?3,git_status_json=?4,last_scanned_at=datetime('now') WHERE id=?5",
        params![default_branch, status.branch, status.head_sha, status_json, workspace.id],
    ).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE contribution_tasks SET branch_name=?1,status='in_progress',updated_at=datetime('now') WHERE id=?2",
        params![branch_name, task_id],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    get_task_workspace(task_id, state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_state_machine_rejects_skips() {
        assert!(valid_transition("selected", "preparing"));
        assert!(valid_transition("in_progress", "blocked"));
        assert!(!valid_transition("in_progress", "ready_for_pr"));
        assert!(!valid_transition("selected", "ready_for_pr"));
        assert!(!valid_transition("submitted", "in_progress"));
    }

    #[test]
    fn branch_names_receive_an_initial_safety_check() {
        assert!(validate_branch_name("issue-42/fix-parser").is_ok());
        assert!(validate_branch_name(" spaced").is_err());
        assert!(validate_branch_name("two words").is_err());
        assert!(validate_branch_name("-danger").is_err());
    }

    #[test]
    fn branch_mutation_requires_explicit_confirmation() {
        assert!(require_mutation_confirmation(false).is_err());
        assert!(require_mutation_confirmation(true).is_ok());
    }
}
