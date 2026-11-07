/** 与 Rust files.rs::FsError 对应的结构化错误（serde tag "kind"，kebab-case）。 */
export type FsError =
  | { kind: "not-found"; path: string }
  | { kind: "already-exists"; path: string }
  | { kind: "external-change"; currentMtime: number | null }
  | { kind: "io"; message: string };

/** invoke 抛出的原始错误是字符串（Rust 序列化的 JSON），解析回 FsError。 */
export function parseFsError(raw: unknown): FsError {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as FsError;
      if (parsed && typeof parsed === "object" && "kind" in parsed) return parsed;
    } catch {
      // 非 JSON 字符串，按普通 io 错误处理
    }
    return { kind: "io", message: raw };
  }
  if (raw && typeof raw === "object" && "kind" in raw) {
    return raw as FsError;
  }
  return { kind: "io", message: String(raw) };
}
