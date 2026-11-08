import { invoke } from "@tauri-apps/api/core";
import type { AppMeta, FileKind } from "../types/state";
import type { FsError } from "./fsError";

/** 类型化 Tauri IPC 封装。命令名与 Rust 侧 #[tauri::command] 一致。 */
export const ipc = {
  // —— 元数据（state.rs）——
  loadAppState: (): Promise<AppMeta> => invoke("load_app_state"),
  saveAppState: (state: AppMeta): Promise<void> =>
    invoke("save_app_state", { state }),

  // —— 文件（files.rs）——
  readTextFile: (path: string): Promise<TextFileInfo> =>
    invoke("read_text_file", { path }),
  writeTextFile: (req: WriteRequest): Promise<WriteResult> =>
    invoke("write_text_file", { req }),
  statPath: (path: string): Promise<PathInfo> => invoke("stat_path", { path }),
  createTextFile: (path: string): Promise<void> =>
    invoke("create_text_file", { path }),
  renameFile: (from: string, newName: string): Promise<string> =>
    invoke("rename_file", { from, newName }),
  revealInFinder: (path: string): Promise<void> =>
    invoke("reveal_in_finder", { path }),
  openExternal: (target: string): Promise<void> =>
    invoke("open_external", { target }),
  getDocumentsDir: (): Promise<string | null> => invoke("get_documents_dir"),
  searchInFiles: (paths: string[], query: string): Promise<FileSearchResult[]> =>
    invoke("search_in_files", { paths, query }),
};

// —— 全局搜索（files.rs）——

export interface SearchMatch {
  /** 1-based 行号 */
  line: number;
  /** 匹配起始偏移 */
  offset: number;
  /** 整行文本（截断 200 字符） */
  text: string;
}

export interface FileSearchResult {
  path: string;
  matches: SearchMatch[];
}

// —— 与 Rust files.rs 对应的结构体 ——

export interface TextFileInfo {
  content: string;
  encoding: string;
  hasBom: boolean;
  mtime: number | null;
  size: number;
  kind: FileKind;
  /** 超过 2MB（打开时提示编辑可能变慢） */
  large: boolean;
}

export interface WriteRequest {
  path: string;
  content: string;
  expectedMtime: number | null;
  force?: boolean;
  preserveBom?: boolean;
}

export interface WriteResult {
  mtime: number;
}

export interface PathInfo {
  exists: boolean;
  isFile: boolean;
  mtime: number | null;
  size: number;
}

export type { FsError };
