mod commands;
mod config;
mod db;
mod models;

use commands::feed::FeedCancelState;
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
            app.manage(FeedCancelState(Arc::new(AtomicBool::new(false))));

            // Set app icon at runtime so it shows in Cmd+Tab / Mission Control
            // even when running via `tauri dev` (no .app bundle present).
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/icon-transparent.png"));
            }

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
            commands::feed::fetch_feed,
            commands::feed::cancel_feed_fetch,
            commands::feed::get_feed_items,
            commands::feed::dismiss_feed_item,
            commands::feed::add_feed_repo_to_library,
            commands::feed::update_last_visited_at,
            commands::feed::get_feed_unread_count,
            commands::library::toggle_watching,
            commands::library::list_watching,
            commands::watching::get_latest_release,
            commands::feed::get_my_github_login,
            commands::feed::get_avatar_urls,
            commands::readme::fetch_readme,
            commands::trending::fetch_trending,
            commands::library::set_category_lock,
            commands::avatars::backfill_owner_avatars,
            commands::backup::export_database,
            commands::backup::import_database,
            commands::releases::sync_releases,
            commands::releases::list_releases,
            commands::releases::mark_release_read,
            commands::releases::mark_all_releases_read,
            commands::releases::get_unread_release_count,
            commands::releases::list_watched_repos_with_unread,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
