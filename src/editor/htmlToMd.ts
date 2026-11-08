import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * 富文本（HTML）→ Markdown（粘贴转换，需求 §5.1 粘贴）。
 *
 * 输出口径以"纯文本粘贴"为基准（用户验收 2026-11-08：AI 对话复制 → Sublime
 * 纯文本 → 粘贴的 zSnap.md 为预期效果）：
 * - 松散列表（<li> 内 <p>，AI 对话/网页常见）压平为紧凑列表：`- 条目`，
 *   不产生 3 空格前缀与段后空行（turndown 默认 `-   x\n    \n`）；
 * - 行首「数字+点」不转义（默认会把 `## 1. 概述` 变成 `## 1\. 概述`）；
 * - 分隔线用 `---`（默认 `* * *`）；
 * - 表格/删除线/任务列表走 GFM 插件；
 * - 围栏代码块外的行尾空白剔除。
 */

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  hr: "---",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});
turndown.use(gfm);
// gfm 插件删除线默认单波浪线（~x~），统一为通用写法 ~~x~~
turndown.addRule("doubleTildeStrikethrough", {
  filter: ["del", "s"] as Array<keyof HTMLElementTagNameMap>,
  replacement: (content) => `~~${content}~~`,
});

// 行首「数字+点」不转义（zSnap 预期）：其余转义规则与 turndown 默认一致
const markdownEscapes: Array<[RegExp, string]> = [
  [/\\/g, "\\\\"],
  [/\*/g, "\\*"],
  [/^-/g, "\\-"],
  [/^\+ /g, "\\+ "],
  [/^(=+)/g, "\\$1"],
  [/^(#{1,6}) /g, "\\$1 "],
  [/`/g, "\\`"],
  [/^~~~/g, "\\~~~"],
  [/\[/g, "\\["],
  [/\]/g, "\\]"],
  [/^>/g, "\\>"],
  [/_/g, "\\_"],
];
turndown.escape = (str) => markdownEscapes.reduce((acc, [re, rep]) => acc.replace(re, rep), str);

// 松散列表压平：<li> 内的 <p> 不再产生段落空行（配合下方 listItem 重写）
turndown.addRule("tightListItem", {
  filter: "li",
  replacement(content, node, options) {
    const parent = node.parentElement;
    let prefix = `${options.bulletListMarker ?? "-"} `;
    if (parent?.nodeName === "OL") {
      const start = parent.getAttribute("start");
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = `${start ? Number(start) + index : index + 1}. `;
    }
    // 压平段落空行（松散→紧凑），多行内容悬挂缩进对齐首行文本
    content = content
      .replace(/^\s*\n+/, "")
      .replace(/\n+\s*$/, "")
      .replace(/\n{2,}/g, "\n");
    content = content.replace(/\n/g, "\n" + " ".repeat(prefix.length));
    return prefix + content + (node.nextSibling ? "\n" : "");
  },
});

/** 围栏代码块外剔除行尾空白（代码块内容保持原样）。 */
function stripTrailingWhitespace(md: string): string {
  let inFence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      return inFence ? line : line.replace(/[ \t]+$/, "");
    })
    .join("\n");
}

/** HTML → Markdown（含输出清洗）。转换失败时返回原文降级为纯文本插入。 */
export function htmlToMarkdown(html: string): string {
  try {
    return stripTrailingWhitespace(turndown.turndown(html));
  } catch {
    return html;
  }
}

/**
 * 剪贴板纯文本本身是否已是 Markdown 源（AI 对话复制的 plain 版即源文本）。
 * 仅用于决定粘贴取哪个剪贴板版本：命中 → 原样插入（零失真）；
 * 未命中（Word/Notes 等富文本）→ 走 HTML 转换。
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 4000);
  return (
    /^#{1,6} \S/m.test(sample) ||
    /^```/m.test(sample) ||
    /^[ \t]*[-*+] \S/m.test(sample) ||
    /^[ \t]*\d+\. \S/m.test(sample) ||
    /\*\*[^*\n]+\*\*/.test(sample) ||
    /^ {0,3}\|.+\|/m.test(sample) ||
    /\[[^\]\n]+\]\([^)\n]+\)/.test(sample)
  );
}
