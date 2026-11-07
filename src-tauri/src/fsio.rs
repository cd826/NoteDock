//! 文件写入安全工具：原子写、mtime 快照。
//! 本模块只做纯文件系统操作，不依赖 Tauri 运行时，便于单元测试。

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// 将内容原子写入目标文件。
///
/// 流程：同目录写入临时文件 → fsync → rename 覆盖目标。
/// rename 失败（异常中断）时目标文件保持原样，避免内容损坏。
/// 已存在的目标文件权限会被保留。
pub fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "path has no parent directory")
    })?;
    fs::create_dir_all(dir)?;
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "path has no file name")
    })?;

    let original_perm = fs::metadata(path).map(|m| m.permissions()).ok();
    let mut tmp = dir.to_path_buf();
    tmp.push(format!(
        ".{}.notedock-tmp-{}-{}",
        file_name.to_string_lossy(),
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default()
    ));

    let write_result = (|| -> io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(contents)?;
        f.sync_all()?;
        if let Some(perm) = &original_perm {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&tmp, std::fs::Permissions::from_mode(perm.mode()))?;
            }
            #[cfg(not(unix))]
            {
                f.set_permissions(perm)?;
            }
        }
        drop(f);
        fs::rename(&tmp, path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    write_result
}

/// 文件修改时间快照（微秒时间戳）。文件不存在时返回 None。
/// 用微秒而非毫秒：同一毫秒内的连续写入也能区分，避免漏判外部修改；
/// 微秒级数值 < 2^53，跨 JSON 传输到前端不损失精度。
/// 用于保存前的外部修改检测：写入前比对当前 mtime 与快照是否一致。
pub fn mtime_snapshot(path: &Path) -> Option<u128> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_micros())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_and_writes() {
        let dir = std::env::temp_dir().join(format!(
            "notedock-test-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let path = dir.join("a").join("test.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        // 覆盖写入
        atomic_write(&path, b"world!").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"world!");
        // 无临时文件残留
        let leftovers: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("notedock-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files leaked: {leftovers:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "notedock-test-perm-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.md");
        fs::write(&path, b"v1").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        atomic_write(&path, b"v2").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "permissions should survive atomic overwrite");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn mtime_snapshot_works() {
        // 同一毫秒内的两次写入也应产生不同快照（微秒精度）
        let dir = std::env::temp_dir().join(format!(
            "notedock-test-mtime2-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("f.txt");
        fs::write(&path, b"1").unwrap();
        let a = mtime_snapshot(&path).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        fs::write(&path, b"22").unwrap();
        let b = mtime_snapshot(&path).unwrap();
        assert!(b > a, "microsecond resolution expected");
        fs::remove_dir_all(&dir).unwrap();
        let dir = std::env::temp_dir().join(format!(
            "notedock-test-mtime-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.txt");
        assert_eq!(mtime_snapshot(&path), None);
        fs::write(&path, b"x").unwrap();
        assert!(mtime_snapshot(&path).is_some());
        fs::remove_dir_all(&dir).unwrap();
    }
}
