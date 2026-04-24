pub mod migrations;

use rusqlite::{Connection, Result};
use std::sync::Mutex;
use tauri::Manager;

pub struct DbState(pub Mutex<Connection>);

pub fn open(app: &tauri::AppHandle) -> Result<Connection> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
    let db_path = app_dir.join("eunha.db");
    let conn = Connection::open(db_path)?;
    migrations::run(&conn)?;
    Ok(conn)
}
