mod commands;
mod db;
mod models;

use commands::import::CancelState;
use db::DbState;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let conn = db::open(app.handle())?;
            app.manage(DbState(Mutex::new(conn)));
            app.manage(CancelState(Arc::new(AtomicBool::new(false))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::list_repos,
            commands::library::get_categories,
            commands::library::update_repo_user_fields,
            commands::library::get_app_constants,
            commands::import::import_stars,
            commands::import::cancel_import,
            commands::add::add_repo,
            commands::describe::describe_repo,
            commands::describe::batch_describe,
            commands::settings::save_settings,
            commands::settings::get_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
