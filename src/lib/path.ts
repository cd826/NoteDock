import type { FileKind } from "../types/state";

/** 路径工具：统一从字符串路径取信息（不经过文件系统）。 */

export function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return path;
  return path.slice(0, idx);
}

export function kindForPath(path: string): FileKind {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "sql") return "sql";
  return "txt";
}

/** 新建文件的默认名（保存面板用）。 */
export function defaultNameFor(kind: FileKind): string {
  const zh = navigator.language.toLowerCase().startsWith("zh");
  const stem = zh ? "未命名" : "Untitled";
  return kind === "sql" ? `${stem}.sql` : kind === "txt" ? `${stem}.txt` : `${stem}.md`;
}
