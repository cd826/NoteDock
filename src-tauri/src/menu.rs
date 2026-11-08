//! 原生菜单栏构建（需求 §7：快捷键必须真实生效，菜单栏显示对应快捷键）。
//!
//! 菜单项 id 与前端 `menuActions` 注册表约定一致；
//! 应用级动作通过 `menu-action` 事件转发给前端执行。
//! 菜单语言跟随系统语言（zh → 中文，其余 → 英文）。

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub const ID_NEW_MD: &str = "new-md";
pub const ID_NEW_TXT: &str = "new-txt";
pub const ID_OPEN_FILE: &str = "open-file";
pub const ID_SAVE: &str = "save";
pub const ID_SAVE_AS: &str = "save-as";
pub const ID_RENAME_FILE: &str = "rename-file";
pub const ID_REVEAL_FINDER: &str = "reveal-finder";
pub const ID_TOGGLE_PIN: &str = "toggle-pin";
pub const ID_CLOSE_TAB: &str = "close-tab";
pub const ID_UNDO: &str = "undo";
pub const ID_REDO: &str = "redo";
pub const ID_FIND: &str = "find";
pub const ID_REPLACE: &str = "replace";
pub const ID_TOGGLE_SOURCE_MODE: &str = "toggle-source-mode";
pub const ID_BOLD: &str = "bold";
pub const ID_ITALIC: &str = "italic";
pub const ID_LINK: &str = "link";
pub const ID_TOGGLE_SIDEBAR: &str = "toggle-sidebar";

/// 系统语言是否为中文。
pub fn is_zh() -> bool {
    sys_locale::get_locale()
        .map(|l| l.to_lowercase().starts_with("zh"))
        .unwrap_or(false)
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    zh_label: &'static str,
    en_label: &'static str,
    accelerator: &str,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let zh = is_zh();
    MenuItemBuilder::with_id(id, if zh { zh_label } else { en_label })
        .accelerator(accelerator)
        .build(app)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let zh = is_zh();
    let l = |zh_s: &'static str, en_s: &'static str| if zh { zh_s } else { en_s };

    // —— 应用菜单 ——
    let app_menu = SubmenuBuilder::new(app, "NoteDock")
        .about(None)
        .separator()
        .services()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // —— 文件 ——
    let file_menu = SubmenuBuilder::new(app, l("文件", "File"))
        .item(&item(app, ID_NEW_MD, "新建 Markdown 文件", "New Markdown File", "CmdOrCtrl+N")?)
        .item(&item(app, ID_NEW_TXT, "新建 TXT 文件", "New TXT File", "CmdOrCtrl+Shift+N")?)
        .separator()
        .item(&item(app, ID_OPEN_FILE, "打开文件…", "Open File…", "CmdOrCtrl+O")?)
        .separator()
        .item(&item(app, ID_SAVE, "保存", "Save", "CmdOrCtrl+S")?)
        .item(&item(app, ID_SAVE_AS, "另存为…", "Save As…", "CmdOrCtrl+Shift+S")?)
        .item(&item(app, ID_RENAME_FILE, "重命名…", "Rename…", "")?)
        .item(&item(app, ID_REVEAL_FINDER, "在 Finder 中显示", "Reveal in Finder", "")?)
        .separator()
        .item(&item(app, ID_TOGGLE_PIN, "固定 / 取消固定", "Pin / Unpin", "CmdOrCtrl+Shift+P")?)
        .separator()
        .item(&item(app, ID_CLOSE_TAB, "关闭标签页", "Close Tab", "CmdOrCtrl+W")?)
        .build()?;

    // —— 编辑 ——
    // 撤销/重做使用自定义项转发给前端：CM6 维护自己的历史栈，
    // 预定义的原生 undo: 动作不会作用于编辑器（需求 §7.4.1 快捷键必须真实执行）。
    let edit_menu = SubmenuBuilder::new(app, l("编辑", "Edit"))
        .item(&item(app, ID_UNDO, "撤销", "Undo", "CmdOrCtrl+Z")?)
        .item(&item(app, ID_REDO, "重做", "Redo", "CmdOrCtrl+Shift+Z")?)
        .separator()
        .cut_with_text(l("剪切", "Cut"))
        .copy_with_text(l("拷贝", "Copy"))
        .paste_with_text(l("粘贴", "Paste"))
        .select_all_with_text(l("全选", "Select All"))
        .separator()
        .item(&item(app, ID_FIND, "查找…", "Find…", "CmdOrCtrl+F")?)
        .item(&item(app, ID_REPLACE, "查找并替换…", "Find and Replace…", "CmdOrCtrl+Alt+F")?)
        .separator()
        .item(&item(
            app,
            ID_TOGGLE_SOURCE_MODE,
            "切换 Markdown 源码模式",
            "Toggle Markdown Source Mode",
            "CmdOrCtrl+/",
        )?)
        .build()?;

    // —— 格式（Markdown 编辑：转发前端命令，快捷键在菜单栏可见，需求 §7.4.3）——
    let format_menu = SubmenuBuilder::new(app, l("格式", "Format"))
        .item(&item(app, ID_BOLD, "粗体", "Bold", "CmdOrCtrl+B")?)
        .item(&item(app, ID_ITALIC, "斜体", "Italic", "CmdOrCtrl+I")?)
        .item(&item(app, ID_LINK, "链接…", "Link…", "CmdOrCtrl+K")?)
        .build()?;

    // —— 视图 ——
    let view_menu = SubmenuBuilder::new(app, l("视图", "View"))
        .item(&item(app, ID_TOGGLE_SIDEBAR, "隐藏 / 显示侧边栏", "Hide / Show Sidebar", "CmdOrCtrl+Alt+S")?)
        .separator()
        .fullscreen_with_text(l("进入全屏", "Enter Full Screen"))
        .build()?;

    // —— 窗口 ——
    let window_menu = SubmenuBuilder::new(app, l("窗口", "Window"))
        .minimize_with_text(l("最小化", "Minimize"))
        .maximize_with_text(l("缩放", "Zoom"))
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&format_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
