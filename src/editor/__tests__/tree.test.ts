import { describe, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";

const parser = markdownLanguage.parser;

function dump(node: SyntaxNode, doc: string, depth: number, lines: string[]): void {
  const preview = doc.slice(node.from, Math.min(node.to, node.from + 36)).replace(/\n/g, "\\n");
  lines.push(`${"  ".repeat(depth)}${node.name} [${node.from},${node.to}) "${preview}"`);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    dump(child, doc, depth + 1, lines);
  }
}

describe("lezer markdown 语法树结构探查", () => {
  it("打印各语法结构的节点名与范围", () => {
    const doc = [
      "# 标题一",
      "## 标题二",
      "",
      "段落 **粗体** *斜体* ~~删除线~~ `行内代码` [链接](https://x.com) ![图片](img.png)",
      "",
      "- 项目一",
      "- 项目二",
      "  - 嵌套",
      "",
      "1. 有序一",
      "2. 有序二",
      "",
      "- [ ] 待办",
      "- [x] 已完成",
      "",
      "> 引用行1",
      "> 引用行2",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "| 表头A | 表头B |",
      "| --- | --- |",
      "| a1 | b1 |",
      "",
      "---",
    ].join("\n");

    const tree = parser.parse(doc);
    const lines: string[] = [];
    for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
      dump(child, doc, 0, lines);
    }
    lines.forEach((l) => console.log(l));
  });
});
