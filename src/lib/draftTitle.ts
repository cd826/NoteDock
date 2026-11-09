import type { FileKind } from "../types/state";

/**
 * 草稿命名（用户需求 2026-11-10）：临时文件的名字从正文第一行抽取，
 * 而不是「未命名」。标签页标题、侧栏条目、保存面板默认文件名共用同一来源。
 */

/** 从草稿内容抽取标题：跳过空行/围栏/分隔线，剥掉标题/列表/引用标记，截断。 */
export function deriveDraftTitle(content: string, fallback: string, max = 24): string {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const text = line
      .replace(/^#{1,6}\s*/, "") // ATX 标题（容忍 ###标题 无空格写法）
      .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, "") // 无序/任务列表
      .replace(/^\d+[.)]\s+/, "") // 有序列表
      .replace(/^>\s*/, "") // 引用
      .replace(/^(?:-{3,}|\*{3,}|_{3,}|`{3,}).*$/, "") // 分隔线/围栏行
      .trim();
    if (!text) continue;
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
  return fallback;
}

/** 草稿保存面板默认文件名：标题清洗非法字符（/ \ :）并补扩展名。 */
export function draftFileName(title: string, kind: FileKind): string {
  const ext = kind === "sql" ? ".sql" : kind === "txt" ? ".txt" : ".md";
  const stem = title.replace(/[/\\:]/g, "-").replace(/\s+/g, " ").trim();
  if (!stem) return `untitled${ext}`;
  return (stem.toLowerCase().endsWith(ext) ? stem : stem + ext).slice(0, 100);
}
