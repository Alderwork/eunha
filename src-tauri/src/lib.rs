mod commands;
mod config;
mod db;
mod models;

use commands::feed::FeedCancelState;
use commands::import::CancelState;
use db::DbState;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use tauri::{Emitter, Manager};

/// Shared tray handle — used by `set_tray_visible` command to show/hide the icon.
pub(crate) struct TrayState(pub Mutex<Option<tauri::tray::TrayIcon>>);

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
            app.manage(TrayState(Mutex::new(None)));

            // Set app icon at runtime so it shows in Cmd+Tab / Mission Control
            // even when running via `tauri dev` (no .app bundle present).
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/icon-transparent.png"));
            }

            #[cfg(target_os = "macos")]
            setup_tray(app)?;

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
            commands::settings::set_tray_visible,
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
            commands::onboarding::get_onboarded_at,
            commands::onboarding::set_onboarded_at,
            commands::onboarding::validate_pat,
            commands::onboarding::save_pat,
            commands::digest::get_current_digest,
            commands::digest::record_digest_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use db::migrations;
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    // Read persisted visibility preference (default: true).
    let show_tray = {
        let db = app.state::<DbState>();
        let conn = db.0.lock().unwrap();
        migrations::settings_get(&conn, "show_tray_icon")
            .map(|v| v != "false")
            .unwrap_or(true)
    };

    let show_item = MenuItem::with_id(app, "show", "Show eunha", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit eunha", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &sep1, &settings_item, &sep2, &quit_item])?;

    // Handle context menu clicks.
    app.on_menu_event(|app, event| match event.id().as_ref() {
        "show" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        "settings" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            let _ = app.emit("tray:open-settings", ());
        }
        "quit" => app.exit(0),
        _ => {}
    });

    let tray = TrayIconBuilder::new()
        .icon(tauri::include_image!("icons/tray-iconTemplate@2x.png"))
        .icon_as_template(true)
        .menu(&menu)
        // Left click toggles the window; right click shows the menu.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    if !show_tray {
        let _ = tray.set_visible(false);
    }
    *app.state::<TrayState>().0.lock().unwrap() = Some(tray);
    Ok(())
}
