mod fsio;
mod menu;
mod state;

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
            state::save_app_state
        ])
        .setup(|app| {
            menu::build(app.handle())?;
            Ok(())
        })
        // 菜单动作统一转发给前端注册表执行（菜单加速键 → 真实功能）
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.clone());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
