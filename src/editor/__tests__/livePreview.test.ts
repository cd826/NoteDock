import { describe, expect, it } from "vitest";
import { type DecorationSet } from "@codemirror/view";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { computeDecorations } from "../livePreview";
import {
  CopyButtonWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  TaskCheckboxWidget,
} from "../widgets";

const parser = markdownLanguage.parser;

interface DecoInfo {
  from: number;
  to: number;
  lineClass?: string;
  markClass?: string;
  widget?: unknown;
  replaces?: boolean;
  block?: boolean;
}

function collect(set: DecorationSet): DecoInfo[] {
  const out: DecoInfo[] = [];
  const iter = set.iter();
  while (iter.value) {
    const v = iter.value;
    const spec = v.spec as { class?: string; widget?: unknown; block?: boolean };
    // CM6 内部常量：行装饰的 startSide 为 -2e8
    const isLine = v.startSide === -200000000;
    out.push({
      from: iter.from,
      to: iter.to,
      lineClass: isLine ? spec.class : undefined,
      markClass: !isLine && !v.point && iter.from < iter.to ? spec.class : undefined,
      widget: spec.widget,
      replaces: v.point && !isLine,
      block: spec.block,
    });
    iter.next();
  }
  return out;
}

function build(doc: string, cursorLine?: number, enabled = true): DecorationSet {
  const cursorLines = new Set<number>();
  if (cursorLine !== undefined) cursorLines.add(cursorLine);
  return computeDecorations({
    doc,
    tree: parser.parse(doc),
    cursorLines,
    lineCount: doc.split("\n").length,
    enabled,
  });
}

describe("livePreview 装饰层", () => {
  it("标题：非光标行隐藏 # 并加行级标题样式", () => {
    const doc = "# 标题一\n\n正文";
    const decos = collect(build(doc));
    // 行样式
    expect(decos.some((d) => d.lineClass === "cm-md-h1" && d.from === 0)).toBe(true);
    // "# "（含空格）被隐藏
    expect(decos.some((d) => d.replaces && d.from === 0 && d.to === 2)).toBe(true);
    // 光标在标题行：不隐藏
    const decos2 = collect(build(doc, 1));
    expect(decos2.some((d) => d.replaces && d.from === 0 && d.to === 2)).toBe(false);
    // 行样式仍保留（标题字号不变）
    expect(decos2.some((d) => d.lineClass === "cm-md-h1")).toBe(true);
  });

  it("粗体：非光标行隐藏星号，光标行显示源码", () => {
    const doc = "hello **world** end";
    const decos = collect(build(doc));
    const hidden = decos.filter((d) => d.replaces);
    expect(hidden).toHaveLength(2); // 两个 ** 
    // 光标行 → 不隐藏
    expect(collect(build(doc, 1)).filter((d) => d.replaces)).toHaveLength(0);
    // 粗体样式标记存在
    expect(decos.some((d) => d.markClass === "cm-md-strong")).toBe(true);
  });

  it("任务列表：TaskMarker 替换为 checkbox（含勾选状态）", () => {
    const doc = "- [ ] 待办\n- [x] 完成";
    const decos = collect(build(doc));
    const boxes = decos.filter((d) => d.widget instanceof TaskCheckboxWidget) as Array<DecoInfo & { widget: TaskCheckboxWidget }>;
    expect(boxes).toHaveLength(2);
    expect(boxes[0].widget.checked).toBe(false);
    expect(boxes[1].widget.checked).toBe(true);
  });

  it("代码块：行样式 + 复制按钮 widget", () => {
    const doc = "```ts\nconst a = 1;\n```";
    const decos = collect(build(doc));
    expect(decos.some((d) => d.lineClass?.includes("cm-code-first"))).toBe(true);
    expect(decos.some((d) => d.lineClass?.includes("cm-code-last"))).toBe(true);
    const copy = decos.find((d) => d.widget instanceof CopyButtonWidget);
    expect(copy).toBeTruthy();
    expect((copy!.widget as CopyButtonWidget).code).toBe("const a = 1;");
  });

  it("行内数学：$...$ 替换为 KaTeX widget，行内代码内不误判", () => {
    const doc = "能量 $E=mc^2$ 与 `代码 $x$` 结尾";
    const decos = collect(build(doc));
    const maths = decos.filter((d) => d.widget instanceof MathWidget) as Array<DecoInfo & { widget: MathWidget }>;
    expect(maths).toHaveLength(1);
    expect(maths[0].widget.latex).toBe("E=mc^2");
  });

  it("$$ 多行块：整块替换为 display 模式", () => {
    const doc = "前文\n$$\ny = x^2\n$$\n后文";
    const decos = collect(build(doc));
    const block = decos.find((d) => d.block && d.widget instanceof MathWidget) as DecoInfo & { widget: MathWidget };
    expect(block).toBeTruthy();
    expect(block.widget.display).toBe(true);
    expect(block.widget.latex).toBe("y = x^2\n");
    // 光标进入块内 → 显示源码
    expect(collect(build(doc, 3)).find((d) => d.block)).toBeUndefined();
  });

  it("图片：非光标行替换为图片 widget", () => {
    const doc = "看图 ![截图](shot.png) 结束";
    const decos = collect(build(doc));
    const img = decos.find((d) => d.widget instanceof ImageWidget) as DecoInfo & { widget: ImageWidget };
    expect(img?.widget.url).toBe("shot.png");
    expect(img?.widget.alt).toBe("截图");
  });

  it("分割线：--- 替换为 hr widget", () => {
    const decos = collect(build("上\n\n---\n\n下"));
    expect(decos.some((d) => d.widget instanceof HrWidget)).toBe(true);
  });

  it("源码模式：enabled=false 返回空装饰", () => {
    expect(collect(build("# 标题\n**粗**", undefined, false))).toHaveLength(0);
  });

  it("sanity：装饰集可被 CM6 排序校验（无异常抛出）", () => {
    const doc = [
      "# A",
      "- [ ] t",
      "> q",
      "```js",
      "var x=1;",
      "```",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "$m$",
    ].join("\n");
    const set = build(doc);
    // RangeSet 迭代一次确保有序性合法（CM 内部会检查乱序并抛错）
    let count = 0;
    const iter = set.iter();
    while (iter.value) {
      count++;
      iter.next();
    }
    expect(count).toBeGreaterThan(5);
  });
});
