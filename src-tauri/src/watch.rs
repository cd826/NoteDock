//! 文件监听（需求 §6.3、§6.4）：外部修改/移动/删除的实时感知。
//!
//! 设计：
//! - 单例 RecommendedWatcher（macOS FSEvents）+ 常驻事件转发线程；
//! - `set_watched_paths` 增量调整监听的父目录集合与关心的文件集合；
//! - 事件仅转发"关心的文件"路径（修改/删除语义由前端 stat 判定）；
//! - 自身保存也会触发事件：前端以 mtime 快照比对，天然忽略自身写入。

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const FS_EVENT: &str = "fs-event";

/// 路径匹配键：(规范化父目录, 文件名)。
/// FSEvents 上报真实路径（如 /private/var/...），而前端给的是用户路径
/// （可能含符号链接，如 /tmp → /private/tmp），必须规范化后再比对。
/// 文件被删除时父目录仍存在，故对父目录 canonicalize。
fn path_key(p: &Path) -> Option<(PathBuf, String)> {
    let file_name = p.file_name()?.to_string_lossy().into_owned();
    let parent = p.parent()?.canonicalize().ok()?;
    Some((parent, file_name))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsEvent {
    path: String,
}

struct WatchResources {
    /// watch/unwatch 需要 &mut，用 Mutex 包裹。
    watcher: Mutex<RecommendedWatcher>,
    /// 关心文件的匹配键集合（规范化父目录 + 文件名）。
    interested: Mutex<HashSet<(PathBuf, String)>>,
    /// 当前已监听的父目录集合（增量 watch/unwatch）。
    watched_dirs: Mutex<HashSet<PathBuf>>,
}

/// 调整监听目标（打开/关闭标签页后由前端调用）。
#[tauri::command]
pub fn set_watched_paths(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let res = app
        .try_state::<WatchResources>()
        .ok_or_else(|| "watcher 未初始化".to_string())?;

    let new_dirs: HashSet<PathBuf> = paths
        .iter()
        .filter_map(|p| Path::new(p).parent().and_then(|d| d.canonicalize().ok()))
        .collect();

    {
        let mut interested = res.interested.lock().map_err(|e| e.to_string())?;
        *interested = paths.iter().filter_map(|p| path_key(Path::new(p))).collect();
    }

    let mut watched = res.watched_dirs.lock().map_err(|e| e.to_string())?;
    let mut watcher = res.watcher.lock().map_err(|e| e.to_string())?;
    for dir in watched.difference(&new_dirs).collect::<Vec<_>>() {
        let _ = watcher.unwatch(dir);
    }
    for dir in new_dirs.difference(&watched) {
        let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
    }
    *watched = new_dirs;
    Ok(())
}

/// 应用启动时初始化：创建 watcher 与事件转发线程。
pub fn init(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let watcher = RecommendedWatcher::new(tx, notify::Config::default())?;

    let handle = app.handle().clone();
    std::thread::spawn(move || {
        while let Ok(res) = rx.recv() {
            let Ok(event) = res else { continue };
            let Some(state) = handle.try_state::<WatchResources>() else { continue };
            let Ok(interested) = state.interested.lock() else { continue };
            let mut hits: Vec<String> = Vec::new();
            for path in &event.paths {
                if let Some(key) = path_key(path) {
                    if interested.contains(&key) {
                        let s = path.to_string_lossy().into_owned();
                        if !hits.contains(&s) {
                            hits.push(s);
                        }
                    }
                }
            }
            drop(interested);
            for path in hits {
                let _ = handle.emit(FS_EVENT, FsEvent { path });
            }
        }
    });

    app.manage(WatchResources {
        watcher: Mutex::new(watcher),
        interested: Mutex::new(HashSet::new()),
        watched_dirs: Mutex::new(HashSet::new()),
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 集成测试：监听临时目录，修改文件应产生事件（宽松时限，避免抖动）。
    #[test]
    fn watcher_reports_changes() {
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = RecommendedWatcher::new(tx, notify::Config::default()).unwrap();

        let dir = std::env::temp_dir().join(format!(
            "notedock-watch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        std::fs::write(&file, "v1").unwrap();

        watcher.watch(&dir, RecursiveMode::NonRecursive).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));

        std::fs::write(&file, "v2").unwrap();

        let key = path_key(&file);
        let mut got = false;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(Ok(event)) = rx.recv_timeout(std::time::Duration::from_millis(300)) {
                if event.paths.iter().any(|p| path_key(p) == key) {
                    got = true;
                    break;
                }
            }
        }
        assert!(got, "应在时限内收到目标文件的事件");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
