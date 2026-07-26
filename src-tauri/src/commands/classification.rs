use crate::commands::describe::{repo_from_row, REPO_SELECT};
use crate::db::DbState;
use crate::models::{ClassificationSuggestion, Purpose, Repo, UserTag};
use rusqlite::{params, Connection};
use tauri::State;

fn names_from_topics(raw: &Option<String>) -> Vec<String> {
    raw.as_deref().and_then(|v| serde_json::from_str::<Vec<String>>(v).ok()).unwrap_or_default()
        .into_iter().filter(|s| !s.trim().is_empty()).take(3).collect()
}

fn rule_suggestion(repo: &Repo) -> (Vec<String>, Vec<String>) {
    let mut tags = names_from_topics(&repo.topics);
    if let Some(language) = &repo.language {
        if !tags.iter().any(|t| t.eq_ignore_ascii_case(language)) { tags.insert(0, language.clone()); }
    }
    let text = format!("{} {}", repo.full_name, repo.description.clone().unwrap_or_default()).to_lowercase();
    let purpose = if text.contains("learn") || text.contains("tutorial") || text.contains("course") { "학습" }
        else if text.contains("alternative") || text.contains("comparison") { "대체재 탐색" }
        else if text.contains("template") || text.contains("example") { "개발 참고" }
        else { "나중에 읽기" };
    (tags, vec![purpose.to_string()])
}

fn ensure_suggestion(conn: &Connection, repo: &Repo) -> rusqlite::Result<(Vec<String>, Vec<String>, String)> {
    if let Ok((tags, purposes, status)) = conn.query_row(
        "SELECT suggested_tags, suggested_purposes, status FROM classification_suggestions WHERE repo_id=?1",
        [&repo.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))) {
        return Ok((serde_json::from_str(&tags).unwrap_or_default(), serde_json::from_str(&purposes).unwrap_or_default(), status));
    }
    let (tags, purposes) = rule_suggestion(repo);
    conn.execute("INSERT INTO classification_suggestions (repo_id, suggested_tags, suggested_purposes) VALUES (?1, ?2, ?3)",
        params![repo.id, serde_json::to_string(&tags).unwrap(), serde_json::to_string(&purposes).unwrap()])?;
    Ok((tags, purposes, "pending".to_string()))
}

#[tauri::command]
pub fn list_classification_suggestions(state: State<'_, DbState>) -> Result<Vec<ClassificationSuggestion>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&format!("{REPO_SELECT} WHERE source = 'starred' AND COALESCE((SELECT status FROM classification_suggestions cs WHERE cs.repo_id = repos.id), 'pending') = 'pending' ORDER BY COALESCE(starred_at, added_at) DESC"))
        .map_err(|e| e.to_string())?;
    let repos: Vec<Repo> = stmt.query_map([], repo_from_row).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    repos.into_iter().map(|repo| {
        let (suggested_tags, suggested_purposes, _) = ensure_suggestion(&conn, &repo).map_err(|e| e.to_string())?;
        Ok(ClassificationSuggestion { repo, suggested_tags, suggested_purposes })
    }).collect()
}

#[tauri::command]
pub fn list_user_tags(state: State<'_, DbState>) -> Result<Vec<UserTag>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name FROM user_tags ORDER BY name COLLATE NOCASE").map_err(|e| e.to_string())?;
    let result = stmt.query_map([], |r| Ok(UserTag { id: r.get(0)?, name: r.get(1)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn create_user_tag(name: String, state: State<'_, DbState>) -> Result<UserTag, String> {
    let name = name.trim().to_string(); if name.is_empty() { return Err("Tag name is required".into()); }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO user_tags (name) VALUES (?1)", [&name]).map_err(|e| e.to_string())?;
    conn.query_row("SELECT id, name FROM user_tags WHERE name=?1", [&name], |r| Ok(UserTag { id: r.get(0)?, name: r.get(1)? })).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_user_tag(id: i64, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let name = name.trim(); if name.is_empty() { return Err("Tag name is required".into()); }
    state.0.lock().map_err(|e| e.to_string())?.execute("UPDATE user_tags SET name=?1 WHERE id=?2", params![name, id]).map_err(|e| e.to_string())?; Ok(())
}

#[tauri::command]
pub fn merge_user_tags(source_id: i64, target_id: i64, state: State<'_, DbState>) -> Result<(), String> {
    if source_id == target_id { return Ok(()); }
    let mut conn = state.0.lock().map_err(|e| e.to_string())?; let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT OR IGNORE INTO repo_tags (repo_id, tag_id) SELECT repo_id, ?1 FROM repo_tags WHERE tag_id=?2", params![target_id, source_id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM user_tags WHERE id=?1", [source_id]).map_err(|e| e.to_string())?; tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_purposes(state: State<'_, DbState>) -> Result<Vec<Purpose>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?; let mut stmt = conn.prepare("SELECT id, name, is_default FROM purposes ORDER BY is_default DESC, name COLLATE NOCASE").map_err(|e| e.to_string())?;
    let result = stmt.query_map([], |r| Ok(Purpose { id:r.get(0)?, name:r.get(1)?, is_default:r.get::<_,i64>(2)? != 0 })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string()); result
}

#[tauri::command]
pub fn create_purpose(name: String, state: State<'_, DbState>) -> Result<Purpose, String> {
    let name=name.trim().to_string(); if name.is_empty(){return Err("Purpose name is required".into())}; let conn=state.0.lock().map_err(|e|e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO purposes (name) VALUES (?1)",[&name]).map_err(|e|e.to_string())?;
    conn.query_row("SELECT id,name,is_default FROM purposes WHERE name=?1",[&name],|r|Ok(Purpose{id:r.get(0)?,name:r.get(1)?,is_default:r.get::<_,i64>(2)?!=0})).map_err(|e|e.to_string())
}

fn set_repo_classification(conn: &mut Connection, repo_id: &str, tag_names: &[String], purpose_ids: &[i64], status: &str) -> Result<Repo, String> {
    if status == "approved" && purpose_ids.is_empty() { return Err("Choose at least one purpose before approving".into()); }
    let tx=conn.transaction().map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM repo_tags WHERE repo_id=?1",[repo_id]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM repo_purposes WHERE repo_id=?1",[repo_id]).map_err(|e|e.to_string())?;
    for tag in tag_names.iter().map(|t|t.trim()).filter(|t|!t.is_empty()) { tx.execute("INSERT OR IGNORE INTO user_tags(name) VALUES(?1)",[tag]).map_err(|e|e.to_string())?; tx.execute("INSERT OR IGNORE INTO repo_tags(repo_id,tag_id) SELECT ?1,id FROM user_tags WHERE name=?2",params![repo_id,tag]).map_err(|e|e.to_string())?; }
    for id in purpose_ids { tx.execute("INSERT OR IGNORE INTO repo_purposes(repo_id,purpose_id) VALUES(?1,?2)",params![repo_id,id]).map_err(|e|e.to_string())?; }
    tx.execute("INSERT INTO classification_suggestions(repo_id,status,reviewed_at) VALUES(?1,?2,datetime('now')) ON CONFLICT(repo_id) DO UPDATE SET status=excluded.status,reviewed_at=excluded.reviewed_at",params![repo_id,status]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    conn.query_row(&format!("{REPO_SELECT} WHERE id=?1"),[repo_id],repo_from_row).map_err(|e|e.to_string())
}

#[tauri::command]
pub fn save_repo_classification(repo_id:String, tag_names:Vec<String>, purpose_ids:Vec<i64>, state:State<'_,DbState>) -> Result<Repo,String> { let mut conn=state.0.lock().map_err(|e|e.to_string())?; set_repo_classification(&mut conn,&repo_id,&tag_names,&purpose_ids,"approved") }
#[tauri::command]
pub fn defer_repo_classification(repo_id:String, state:State<'_,DbState>) -> Result<(),String> { let conn=state.0.lock().map_err(|e|e.to_string())?; conn.execute("INSERT INTO classification_suggestions(repo_id,status,reviewed_at) VALUES(?1,'deferred',datetime('now')) ON CONFLICT(repo_id) DO UPDATE SET status='deferred',reviewed_at=datetime('now')",[repo_id]).map_err(|e|e.to_string())?; Ok(()) }
#[tauri::command]
pub fn list_recent_star_candidates(state:State<'_,DbState>) -> Result<Vec<Repo>,String> { let conn=state.0.lock().map_err(|e|e.to_string())?; let mut stmt=conn.prepare(&format!("{REPO_SELECT} WHERE source='starred' ORDER BY COALESCE(starred_at, added_at) DESC LIMIT 10")).map_err(|e|e.to_string())?; let result=stmt.query_map([],repo_from_row).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string()); result }

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        conn.execute("INSERT INTO repos (id, full_name, url, source) VALUES ('a/b', 'a/b', 'https://x', 'starred')", []).unwrap();
        conn
    }

    #[test]
    fn approval_requires_a_purpose_and_keeps_multiple_links() {
        let mut conn = db();
        assert!(set_repo_classification(&mut conn, "a/b", &["rust".into()], &[], "approved").is_err());
        let ids: Vec<i64> = conn.prepare("SELECT id FROM purposes LIMIT 2").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        let repo = set_repo_classification(&mut conn, "a/b", &["rust".into(), "cli".into()], &ids, "approved").unwrap();
        assert_eq!(repo.user_tags.len(), 2);
        assert!(repo.user_tags.contains(&"cli".to_string()));
        assert!(repo.user_tags.contains(&"rust".to_string()));
        assert_eq!(repo.purposes.len(), 2);
        assert_eq!(repo.classification_status, "approved");
    }

    #[test]
    fn merging_tags_preserves_repo_membership() {
        let mut conn = db();
        conn.execute("INSERT INTO user_tags (id, name) VALUES (1, 'old'), (2, 'new')", []).unwrap();
        conn.execute("INSERT INTO repo_tags (repo_id, tag_id) VALUES ('a/b', 1)", []).unwrap();
        let tx = conn.transaction().unwrap();
        tx.execute("INSERT OR IGNORE INTO repo_tags (repo_id, tag_id) SELECT repo_id, 2 FROM repo_tags WHERE tag_id=1", []).unwrap();
        tx.execute("DELETE FROM user_tags WHERE id=1", []).unwrap(); tx.commit().unwrap();
        let count:i64=conn.query_row("SELECT COUNT(*) FROM repo_tags WHERE repo_id='a/b' AND tag_id=2",[],|r|r.get(0)).unwrap();
        assert_eq!(count, 1);
    }
}
