//! 本地元数据（应用辅助状态）的持久化。
//!
//! 原则（需求 §6.3）：
//! - 只保存固定列表、最近列表、编辑器状态、偏好设置等辅助信息；
//! - 不保存任何文件正文；
//! - 元数据丢失不应影响用户文件本身。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "notedock-state.json";
const CURRENT_VERSION: u32 = 1;

fn default_sidebar_width() -> f64 {
    240.0
}
fn default_recent_limit() -> u32 {
    15
}
fn default_restore_session() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// "system" | "light" | "dark"
    pub theme: String,
    pub default_save_dir: String,
    pub sidebar_width: f64,
    pub sidebar_hidden: bool,
    pub recent_limit: u32,
    pub restore_session: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            default_save_dir: String::new(),
            sidebar_width: default_sidebar_width(),
            sidebar_hidden: false,
            recent_limit: default_recent_limit(),
            restore_session: default_restore_session(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedEntry {
    pub path: String,
    pub added_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub last_opened_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabSessionEntry {
    pub path: String,
    /// "md" | "txt" | "sql"
    pub kind: String,
    pub cursor: u32,
    pub scroll_top: f64,
    pub source_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub tabs: Vec<TabSessionEntry>,
    pub active: i32,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active: -1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppMeta {
    pub version: u32,
    pub prefs: Prefs,
    pub pinned: Vec<PinnedEntry>,
    pub recents: Vec<RecentEntry>,
    pub session: Session,
}

impl Default for AppMeta {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            prefs: Prefs::default(),
            pinned: Vec::new(),
            recents: Vec::new(),
            session: Session::default(),
        }
    }
}

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(STATE_FILE))
}

/// 读取元数据。文件不存在视为首次启动，返回默认值；
/// JSON 损坏时同样返回默认值（元数据丢失不影响用户文件，符合需求 §6.3.5）。
#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<AppMeta, String> {
    let file = state_file(&app)?;
    match std::fs::read(&file) {
        Ok(bytes) => match serde_json::from_slice::<AppMeta>(&bytes) {
            Ok(meta) => Ok(meta),
            Err(_) => Ok(AppMeta::default()),
        },
        Err(_) => Ok(AppMeta::default()),
    }
}

/// 保存元数据（原子写）。由前端防抖调用。
#[tauri::command]
pub fn save_app_state(app: AppHandle, state: AppMeta) -> Result<(), String> {
    let file = state_file(&app)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    crate::fsio::atomic_write(&file, &json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meta_serialization_roundtrip_and_camel_case() {
        let meta = AppMeta {
            pinned: vec![PinnedEntry {
                path: "/tmp/a.md".into(),
                added_at: 123,
            }],
            recents: vec![RecentEntry {
                path: "/tmp/b.txt".into(),
                last_opened_at: 456,
            }],
            session: Session {
                tabs: vec![TabSessionEntry {
                    path: "/tmp/b.txt".into(),
                    kind: "txt".into(),
                    cursor: 3,
                    scroll_top: 12.5,
                    source_mode: false,
                }],
                active: 0,
            },
            ..Default::default()
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"addedAt\":123"), "camelCase keys: {json}");
        assert!(json.contains("\"defaultSaveDir\""), "prefs camelCase: {json}");
        let back: AppMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(back, meta);
    }

    #[test]
    fn partial_json_uses_defaults() {
        // 旧版本/缺字段时的向后兼容：缺省字段用 Default 填充
        let meta: AppMeta = serde_json::from_str(r#"{"pinned":[{"path":"/x.md","addedAt":1}]}"#).unwrap();
        assert_eq!(meta.prefs.theme, "system");
        assert_eq!(meta.prefs.sidebar_width, 240.0);
        assert_eq!(meta.version, CURRENT_VERSION);
        assert_eq!(meta.pinned.len(), 1);
    }
}
