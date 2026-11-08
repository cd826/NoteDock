mod files;
mod fsio;
mod menu;
mod state;
mod watch;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：Finder 双击文件时进入已有实例（插件要求最先注册）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            state::load_app_state,
            state::save_app_state,
            files::read_text_file,
            files::write_text_file,
            files::stat_path,
            files::create_text_file,
            files::rename_file,
            files::reveal_in_finder,
            files::open_external,
            files::get_documents_dir,
            files::debug_log,
            files::search_in_files,
            watch::set_watched_paths
        ])
        .setup(|app| {
            menu::build(app.handle())?;
            watch::init(app).expect("初始化文件监听失败");
            Ok(())
        })
        // 菜单动作统一转发给前端注册表执行（菜单加速键 → 真实功能）
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.clone());
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // macOS 惯例：红点仅关窗口，应用留在 Dock；点 Dock 图标恢复窗口
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(win) = _app_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    } else if let Some(cfg) = _app_handle.config().app.windows.first().cloned() {
                        if let Ok(builder) = tauri::WebviewWindowBuilder::from_config(_app_handle, &cfg) {
                            let _ = builder.build();
                        }
                    }
                }
            }
            // Finder 双击文件 / 拖到 Dock 图标打开（需求 §6.2；文件关联在 Phase 5 配置）
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    let _ = _app_handle.emit("open-paths", paths);
                }
            }
        });
}
