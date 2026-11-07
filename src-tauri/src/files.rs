//! 文件系统命令层（需求 §6：直接编辑原始文件，不复制、不导入、不改变路径）。
//!
//! 错误用结构化 FsError 返回（serde tag "kind"），前端按 kind 分支处理：
//! - external-change：保存时发现文件已被外部修改 → 冲突横幅，绝不静默覆盖
//! - not-found / already-exists / io：常规错误提示

use chardetng::EncodingDetector;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum FsError {
    NotFound { path: String },
    AlreadyExists { path: String },
    /// 保存前检测到磁盘 mtime 与本地快照不一致（或文件已消失）
    ExternalChange { current_mtime: Option<u128> },
    Io { message: String },
}

impl From<std::io::Error> for FsError {
    fn from(e: std::io::Error) -> Self {
        FsError::Io { message: e.to_string() }
    }
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FsError::NotFound { path } => write!(f, "文件不存在: {path}"),
            FsError::AlreadyExists { path } => write!(f, "文件已存在: {path}"),
            FsError::ExternalChange { .. } => write!(f, "文件已被外部修改"),
            FsError::Io { message } => write!(f, "文件操作失败: {message}"),
        }
    }
}

/// 按扩展名判定编辑器类型（需求 §6.2：md/markdown→Markdown，txt→纯文本，sql→SQL）。
pub fn kind_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("md") | Some("markdown") => "md".to_string(),
        Some("sql") => "sql".to_string(),
        _ => "txt".to_string(),
    }
}

/// 解码字节为文本：优先 UTF-8（含 BOM 识别），否则用 chardetng 猜测编码。
/// 返回 (内容, 编码名, 是否原本带 BOM)。非 UTF-8 文件保存时将转为 UTF-8（前端明确提示，不静默）。
fn decode_bytes(bytes: &[u8]) -> (String, String, bool) {
    if bytes.starts_with(UTF8_BOM) {
        let content = String::from_utf8_lossy(&bytes[3..]).into_owned();
        return (content, "UTF-8".into(), true);
    }
    if let Ok(content) = std::str::from_utf8(bytes) {
        return (content.to_owned(), "UTF-8".into(), false);
    }
    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let content = encoding.decode(bytes).0.into_owned();
    (content, encoding.name().to_string(), false)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileInfo {
    pub content: String,
    pub encoding: String,
    pub has_bom: bool,
    pub mtime: Option<u128>,
    pub size: u64,
    /// "md" | "txt" | "sql"
    pub kind: String,
}

/// 读取文本文件（md/txt/sql）。拒绝目录与二进制内容（含 NUL 字节）。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<TextFileInfo, FsError> {
    let p = Path::new(&path);
    let meta = fs::metadata(p).map_err(|_| FsError::NotFound { path: path.clone() })?;
    if meta.is_dir() {
        return Err(FsError::Io { message: "路径是一个目录".into() });
    }
    let bytes = fs::read(p)?;
    if bytes.contains(&0) {
        return Err(FsError::Io { message: "似乎不是文本文件（包含二进制内容），NoteDock 不支持打开".into() });
    }
    let (content, encoding, has_bom) = decode_bytes(&bytes);
    Ok(TextFileInfo {
        content,
        encoding,
        has_bom,
        mtime: crate::fsio::mtime_snapshot(p),
        size: meta.len(),
        kind: kind_for_path(p),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
    /// 上次读取/写入时记录的 mtime 快照；不一致即判定外部修改。
    pub expected_mtime: Option<u128>,
    /// 冲突横幅中用户选择"覆盖保存"时为 true。
    pub force: Option<bool>,
    /// 原文件是否带 UTF-8 BOM（保持原始格式，需求 §6.6）。
    pub preserve_bom: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub mtime: u128,
}

/// 写入原始文件：先做外部修改检测（mtime 快照比对），再原子写。
#[tauri::command]
pub fn write_text_file(req: WriteRequest) -> Result<WriteResult, FsError> {
    let p = Path::new(&req.path);
    let current = crate::fsio::mtime_snapshot(p);
    if !req.force.unwrap_or(false) {
        if let Some(expected) = req.expected_mtime {
            if current != Some(expected) {
                return Err(FsError::ExternalChange { current_mtime: current });
            }
        }
    }
    let mut payload = Vec::with_capacity(req.content.len() + 3);
    if req.preserve_bom.unwrap_or(false) {
        payload.extend_from_slice(UTF8_BOM);
    }
    payload.extend_from_slice(req.content.as_bytes());
    crate::fsio::atomic_write(p, &payload)?;
    Ok(WriteResult {
        mtime: crate::fsio::mtime_snapshot(p).unwrap_or(0),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    pub exists: bool,
    pub is_file: bool,
    pub mtime: Option<u128>,
    pub size: u64,
}

/// 路径探测（不抛错，缺失时 exists=false），供侧边栏失效态与冲突恢复使用。
#[tauri::command]
pub fn stat_path(path: String) -> Result<PathInfo, FsError> {
    let p = Path::new(&path);
    match fs::metadata(p) {
        Ok(meta) => Ok(PathInfo {
            exists: true,
            is_file: meta.is_file(),
            mtime: crate::fsio::mtime_snapshot(p),
            size: meta.len(),
        }),
        Err(_) => Ok(PathInfo { exists: false, is_file: false, mtime: None, size: 0 }),
    }
}

/// 新建空文本文件（新建文件流：保存面板确定路径后调用）。
#[tauri::command]
pub fn create_text_file(path: String) -> Result<(), FsError> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(FsError::AlreadyExists { path });
    }
    fs::write(p, b"")?;
    Ok(())
}

/// 重命名（同目录内改名，不改变用户原有组织方式，需求 §6.1.7）。
#[tauri::command]
pub fn rename_file(from: String, new_name: String) -> Result<String, FsError> {
    let src = PathBuf::from(&from);
    let file_name = src
        .file_name()
        .ok_or_else(|| FsError::Io { message: "路径缺少文件名".into() })?
        .to_string_lossy()
        .to_string();
    if new_name.trim() == file_name {
        return Ok(from);
    }
    let dir = src.parent().ok_or_else(|| FsError::Io { message: "路径缺少父目录".into() })?;
    let target = dir.join(&new_name);
    if target.exists() {
        return Err(FsError::AlreadyExists { path: target.to_string_lossy().into_owned() });
    }
    fs::rename(&src, &target)?;
    Ok(target.to_string_lossy().into_owned())
}

/// 在 Finder 中显示（需求 §4.4）。
#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// 用系统默认方式打开外部链接/文件（链接 ⌘点击等场景）。
#[tauri::command]
pub fn open_external(target: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(target, None::<&str>).map_err(|e| e.to_string())
}

/// 用户的文稿目录（新建文件保存面板的默认位置，需求 §6.5）。
#[tauri::command]
pub fn get_documents_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.path()
        .document_dir()
        .map(|d| Some(d.to_string_lossy().into_owned()))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_detects_utf8_bom_and_gbk() {
        // UTF-8 BOM
        let (content, enc, bom) = decode_bytes(&[0xEF, 0xBB, 0xBF, b'h', b'i']);
        assert_eq!(content, "hi");
        assert_eq!(enc, "UTF-8");
        assert!(bom);

        // 纯 UTF-8（含中文）
        let (content, enc, bom) = decode_bytes("你好，世界".as_bytes());
        assert_eq!(content, "你好，世界");
        assert_eq!(enc, "UTF-8");
        assert!(!bom);

        // GBK 编码的 "中文"
        let gbk_bytes = [0xD6, 0xD0, 0xCE, 0xC4];
        let (content, enc, _) = decode_bytes(&gbk_bytes);
        assert_eq!(content, "中文");
        assert_ne!(enc, "UTF-8");
    }

    #[test]
    fn kind_matches_extensions() {
        assert_eq!(kind_for_path(Path::new("/a/b.md")), "md");
        assert_eq!(kind_for_path(Path::new("/a/b.MARKDOWN")), "md");
        assert_eq!(kind_for_path(Path::new("/a/b.sql")), "sql");
        assert_eq!(kind_for_path(Path::new("/a/b.txt")), "txt");
        assert_eq!(kind_for_path(Path::new("/a/b.unknown")), "txt");
    }

    #[test]
    fn write_conflict_detection() {
        let dir = std::env::temp_dir().join(format!(
            "notedock-fs-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("conflict.md");
        std::fs::write(&path, b"v1").unwrap();
        let real_mtime = crate::fsio::mtime_snapshot(&path).unwrap();

        // 快照一致 → 保存成功
        let ok = write_text_file(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "v2".into(),
            expected_mtime: Some(real_mtime),
            force: None,
            preserve_bom: None,
        });
        assert!(ok.is_ok());

        // 快照过期 → external-change，不覆盖
        let err = write_text_file(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "clobber".into(),
            expected_mtime: Some(real_mtime), // 磁盘 mtime 已更新
            force: None,
            preserve_bom: None,
        });
        assert!(matches!(err, Err(FsError::ExternalChange { .. })));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2", "must not silently overwrite");

        // force=true → 覆盖成功
        let ok = write_text_file(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "v3".into(),
            expected_mtime: Some(real_mtime),
            force: Some(true),
            preserve_bom: None,
        });
        assert!(ok.is_ok());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v3");

        // BOM 保留
        std::fs::write(&path, &[0xEFu8, 0xBB, 0xBFu8]).unwrap();
        write_text_file(WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "bom-content".into(),
            expected_mtime: None,
            force: None,
            preserve_bom: Some(true),
        })
        .unwrap();
        assert!(std::fs::read(&path).unwrap().starts_with(UTF8_BOM));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
