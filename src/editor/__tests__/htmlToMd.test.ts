import { describe, expect, it } from "vitest";
import { htmlToMarkdown, looksLikeMarkdown } from "../htmlToMd";

/**
 * 富文本粘贴转换口径（用户验收 2026-11-08）：
 * 以"纯文本粘贴"效果为基准（AI 对话 → Sublime → 粘贴 的 zSnap.md），
 * 即：无 `-   ` 三空格列表、无段后空行、无 `1\.` 转义、分隔线为 `---`。
 */
describe("htmlToMarkdown", () => {
  it("AI 对话样例：数字标题不转义、松散列表压平、hr 用 ---", () => {
    const html = `
<h2>1. 项目概述</h2>
<ul>
<li><p>快速截图</p></li>
<li><p>截图标注</p></li>
</ul>
<hr>
<ol>
<li><p>简洁优先，不设计复杂的主界面。</p></li>
<li><p>原生体验优先，充分利用 macOS 系统能力。</p></li>
</ol>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("## 1. 项目概述");
    expect(md).not.toContain("1\\.");
    expect(md).toContain("- 快速截图");
    expect(md).not.toContain("-   ");
    expect(md).toContain("1. 简洁优先");
    expect(md).toContain("---");
    expect(md).not.toContain("* * *");
    // 无段后 4 空格噪声行、无行尾空白
    expect(md).not.toMatch(/\n +\n/);
    for (const line of md.split("\n")) expect(line).not.toMatch(/[ \t]$/);
  });

  it("嵌套列表：保持层级缩进", () => {
    const html = `<ul><li><p>外层</p><ul><li><p>内层</p></li></ul></li></ul>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("- 外层");
    expect(md).toMatch(/\n\s+- 内层/);
  });

  it("GFM 表格与删除线", () => {
    const html = `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><p><del>删除</del></p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| 1 | 2 |");
    expect(md).toContain("~~删除~~");
  });

  it("围栏代码块保留语言标注，块内行尾空白不动", () => {
    const html = `<pre><code class="language-js">const a = 1;  </code></pre>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("```js\nconst a = 1;  \n```");
  });

  it("加粗/斜体/链接", () => {
    const html = `<p><strong>粗</strong>与<em>斜</em>，见<a href="https://example.com">链接</a></p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("**粗**");
    expect(md).toContain("*斜*");
    expect(md).toContain("[链接](https://example.com)");
  });
});

describe("looksLikeMarkdown（粘贴取源判定）", () => {
  it("AI 对话的纯文本（md 源）→ true", () => {
    expect(looksLikeMarkdown("# macOS 截图工具\n\n- 快速截图\n- 截图标注")).toBe(true);
    expect(looksLikeMarkdown("说明：\n\n```sql\nSELECT 1;\n```")).toBe(true);
    expect(looksLikeMarkdown("前文 **加粗** 后文")).toBe(true);
  });

  it("普通文本（Word/Notes）→ false，走 HTML 转换", () => {
    expect(looksLikeMarkdown("这是第一段文字。\n这是第二段文字，没有 Markdown 特征。")).toBe(false);
    expect(looksLikeMarkdown("Meeting notes:\nreviewed the plan with the team.")).toBe(false);
  });

  it("空文本 → false", () => {
    expect(looksLikeMarkdown("")).toBe(false);
  });
});
