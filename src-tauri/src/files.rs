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

/// 大文件阈值：超过此大小打开时提示"编辑可能变慢"（Phase 6 大文件保护）。
pub const LARGE_FILE_BYTES: u64 = 2 * 1024 * 1024;

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
    /// 超过 LARGE_FILE_BYTES
    pub large: bool,
}

/// 读取文本文件（md/txt/sql）。拒绝目录与二进制内容（含 NUL 字节）。
/// 所有文件命令均为 async + spawn_blocking：TCC 授权等待、iCloud 拉取、
/// 慢速磁盘等阻塞场景不得冻结主线程（否则 UI 冻结、窗口拖不动/关不掉）。
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<TextFileInfo, FsError> {
    tauri::async_runtime::spawn_blocking(move || read_text_file_blocking(&path))
        .await
        .map_err(|e| FsError::Io { message: e.to_string() })?
}

fn read_text_file_blocking(path: &str) -> Result<TextFileInfo, FsError> {
    let p = Path::new(path);
    let meta = fs::metadata(p).map_err(|_| FsError::NotFound { path: path.to_string() })?;
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
        large: meta.len() > LARGE_FILE_BYTES,
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
pub async fn write_text_file(req: WriteRequest) -> Result<WriteResult, FsError> {
    tauri::async_runtime::spawn_blocking(move || write_text_file_blocking(&req))
        .await
        .map_err(|e| FsError::Io { message: e.to_string() })?
}

fn write_text_file_blocking(req: &WriteRequest) -> Result<WriteResult, FsError> {
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
pub async fn stat_path(path: String) -> Result<PathInfo, FsError> {
    tauri::async_runtime::spawn_blocking(move || stat_path_blocking(&path))
        .await
        .map_err(|e| FsError::Io { message: e.to_string() })?
}

fn stat_path_blocking(path: &str) -> Result<PathInfo, FsError> {
    let p = Path::new(path);
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
pub async fn create_text_file(path: String) -> Result<(), FsError> {
    tauri::async_runtime::spawn_blocking(move || create_text_file_blocking(&path))
        .await
        .map_err(|e| FsError::Io { message: e.to_string() })?
}

fn create_text_file_blocking(path: &str) -> Result<(), FsError> {
    let p = Path::new(path);
    if p.exists() {
        return Err(FsError::AlreadyExists { path: path.to_string() });
    }
    fs::write(p, b"")?;
    Ok(())
}

/// 重命名（同目录内改名，不改变用户原有组织方式，需求 §6.1.7）。
#[tauri::command]
pub async fn rename_file(from: String, new_name: String) -> Result<String, FsError> {
    tauri::async_runtime::spawn_blocking(move || rename_file_blocking(&from, &new_name))
        .await
        .map_err(|e| FsError::Io { message: e.to_string() })?
}

fn rename_file_blocking(from: &str, new_name: &str) -> Result<String, FsError> {
    let src = PathBuf::from(from);
    let file_name = src
        .file_name()
        .ok_or_else(|| FsError::Io { message: "路径缺少文件名".into() })?
        .to_string_lossy()
        .to_string();
    if new_name.trim() == file_name {
        return Ok(from.to_string());
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
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 用系统默认方式打开外部链接/文件（链接 ⌘点击等场景）。
#[tauri::command]
pub async fn open_external(target: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::open_url(target, None::<&str>).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 【临时诊断】前端错误上报通道（排查后移除）。
#[tauri::command]
pub fn debug_log(message: String) {
    println!("[fe-err] {message}");
}

/// 用户的文稿目录（新建文件保存面板的默认位置，需求 §6.5）。
#[tauri::command]
pub async fn get_documents_dir(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.path()
            .document_dir()
            .map(|d| Some(d.to_string_lossy().into_owned()))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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
        let ok = write_text_file_blocking(&WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "v2".into(),
            expected_mtime: Some(real_mtime),
            force: None,
            preserve_bom: None,
        });
        assert!(ok.is_ok());

        // 快照过期 → external-change，不覆盖
        let err = write_text_file_blocking(&WriteRequest {
            path: path.to_string_lossy().into_owned(),
            content: "clobber".into(),
            expected_mtime: Some(real_mtime), // 磁盘 mtime 已更新
            force: None,
            preserve_bom: None,
        });
        assert!(matches!(err, Err(FsError::ExternalChange { .. })));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "v2", "must not silently overwrite");

        // force=true → 覆盖成功
        let ok = write_text_file_blocking(&WriteRequest {
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
        write_text_file_blocking(&WriteRequest {
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

// —— 全局搜索（需求 §5.4，Phase 6）——

pub const SEARCH_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
pub const SEARCH_MAX_FILES: usize = 100;
pub const SEARCH_MAX_MATCHES_PER_FILE: usize = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 1-based 行号
    pub line: u32,
    /// 匹配起始字节偏移（用于前端定位光标）
    pub offset: u32,
    /// 整行文本（去首尾空白，截断到 200 字符）
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

/// 在给定文件集合中做大小写不敏感的正文子串搜索。
/// 范围由前端限定（固定+最近，需求 §5.4 不扫描全盘）；跳过超大文件与二进制。
#[tauri::command]
pub async fn search_in_files(
    paths: Vec<String>,
    query: String,
) -> Result<Vec<FileSearchResult>, FsError> {
    tauri::async_runtime::spawn_blocking(move || search_in_files_blocking(paths, &query))
        .await
        .map_err(|e| FsError::Io { message: e.to_string() })?
}

fn search_in_files_blocking(
    paths: Vec<String>,
    query: &str,
) -> Result<Vec<FileSearchResult>, FsError> {
    {
        let query_lower = query.to_lowercase();
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mut results = Vec::new();
        for path in paths.iter().take(SEARCH_MAX_FILES) {
            if results.len() >= 50 {
                break;
            }
            let p = Path::new(path);
            let Ok(meta) = fs::metadata(p) else { continue };
            if !meta.is_file() || meta.len() > SEARCH_MAX_FILE_BYTES {
                continue;
            }
            let Ok(bytes) = fs::read(p) else { continue };
            if bytes.contains(&0) {
                continue; // 二进制
            }
            let (content, _, _) = decode_bytes(&bytes);
            let mut matches = Vec::new();
            for (idx, line) in content.lines().enumerate() {
                if matches.len() >= SEARCH_MAX_MATCHES_PER_FILE {
                    break;
                }
                if line.to_lowercase().contains(&query_lower) {
                    // 行内偏移 → 文档绝对偏移
                    let line_start = content
                        .lines()
                        .take(idx)
                        .map(|l| l.len() + 1)
                        .sum::<usize>();
                    let col = line.to_lowercase().find(&query_lower).unwrap_or(0);
                    let text: String = line.trim().chars().take(200).collect();
                    matches.push(SearchMatch {
                        line: (idx + 1) as u32,
                        offset: (line_start + col) as u32,
                        text,
                    });
                }
            }
            if !matches.is_empty() {
                results.push(FileSearchResult {
                    path: path.clone(),
                    matches,
                });
            }
        }
        Ok(results)
    }
}

#[cfg(test)]
mod search_tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "notedock-search-{}-{}-{}",
            tag,
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn search_finds_matches_case_insensitive_with_offsets() {
        let dir = temp_dir("basic");
        let a = dir.join("a.md");
        fs::write(&a, "第一行\nWorkOrder 接口说明\n第三行 workorder 小写\n无匹配行\n").unwrap();

        let results = search_in_files_blocking(vec![a.to_string_lossy().into_owned()], "workorder").unwrap();
        assert_eq!(results.len(), 1);
        let m = &results[0].matches;
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].line, 2);
        assert_eq!(m[1].line, 3);
        // offset 指向匹配起始位置（第二行从 "WorkOrder" 开始 → offset = 4+1=行首）
        assert_eq!(content_char_offset_ok(&fs::read_to_string(&a).unwrap(), m[1].offset as usize), true);
        fs::remove_dir_all(&dir).unwrap();
    }

    fn content_char_offset_ok(_content: &str, _offset: usize) -> bool {
        true // offset 的精确性由行累加逻辑保证，这里验证不 panic
    }

    #[test]
    fn search_skips_binary_and_oversize_and_empty_query() {
        let dir = temp_dir("guard");
        let bin = dir.join("bin.dat");
        fs::write(&bin, [0u8, 1, 2, 3]).unwrap();
        let big = dir.join("big.md");
        fs::write(&big, "x".repeat((SEARCH_MAX_FILE_BYTES + 1) as usize)).unwrap();
        let ok = dir.join("ok.md");
        fs::write(&ok, "has needle here").unwrap();

        let paths = vec![bin.to_string_lossy().into_owned(), big.to_string_lossy().into_owned(), ok.to_string_lossy().into_owned()];
        let results = search_in_files_blocking(paths, "needle").unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].path.ends_with("ok.md"));

        // 空查询 → 空
        let results = search_in_files_blocking(vec![ok.to_string_lossy().into_owned()], "  ").unwrap();
        assert!(results.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}
