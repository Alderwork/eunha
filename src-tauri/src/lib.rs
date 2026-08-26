mod commands;
mod conduit;
mod config;
mod db;
mod llm;
mod models;

use db::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::open(app.handle())?;
            if let Err(error) = conduit::migrate_legacy_llm_settings(&conn) {
                log::error!("conduit migration failed: {error}");
            }
            app.manage(DbState(Mutex::new(conn)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::inspect_project_input,
            commands::projects::save_project,
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::refresh_project_workspace,
            commands::projects::connect_project_workspace,
            commands::project_brief::get_project_contribution,
            commands::project_brief::analyze_project_contribution,
            commands::tasks::create_contribution_task,
            commands::tasks::list_contribution_tasks,
            commands::tasks::get_task_workspace,
            commands::tasks::update_task_status,
            commands::tasks::update_task_notes,
            commands::tasks::create_task_branch,
            commands::settings::save_settings,
            commands::settings::get_settings,
            conduit::conduit_list,
            conduit::conduit_save,
            conduit::conduit_delete,
            conduit::conduit_set_active,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
