import { syntaxTree } from "@codemirror/language";
import { Facet, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";
import {
  CopyButtonWidget,
  HrWidget,
  ImageWidget,
  MathWidget,
  MermaidWidget,
  TaskCheckboxWidget,
} from "./widgets";

/**
 * Typora 式即时渲染装饰层。
 *
 * 核心规则（光标稳定性 + 中文 IME 安全）：
 * - 光标/选区所在行永远显示原始 Markdown 源码；
 * - 隐藏标记、widget 替换只作用于光标不在的行；
 * - 行级样式 class 可作用于任意行（不改变文本结构，不影响输入）。
 *
 * 数学（$...$ 与 $$ 块）不走 lezer 语法树（lang-markdown 无此语法），
 * 在装饰层做受保护扫描：跳过代码块/行内代码/图片范围。
 */

export const livePreviewFacet: Facet<boolean, boolean> = Facet.define({
  combine: (values) => (values.length ? values[values.length - 1] : true),
});

const hide = Decoration.replace({});
const headingLine = (level: number) => Decoration.line({ class: `cm-md-h${level}` });
const mdLine = (cls: string) => Decoration.line({ class: cls });
const mdMark = (spec: { class: string }) => Decoration.mark(spec);

export interface LineInfo {
  /** 1-based 行号 */
  n: number;
  from: number;
  to: number;
}

export interface DecorationInput {
  doc: string;
  /** lezer 语法树（需以 GFM 扩展解析）。 */
  tree: Tree;
  /** 含光标/选区的行号集合（1-based）。 */
  cursorLines: Set<number>;
  lineCount: number;
  /** false = 源码模式，返回空装饰。 */
  enabled: boolean;
}

/** 纯函数：由语法树与光标行集合构建装饰（可脱离 EditorView 单测）。 */
export function computeDecorations(input: DecorationInput): DecorationSet {
  const { doc, tree, cursorLines, lineCount, enabled } = input;
  if (!enabled) return Decoration.none;

  // 逐行行起止（O(n)，供二分定位）
  const lines: LineInfo[] = [];
  {
    let n = 1;
    let from = 0;
    for (let i = 0; i <= doc.length; i++) {
      if (i === doc.length || doc.charCodeAt(i) === 10) {
        lines.push({ n, from, to: i });
        n++;
        from = i + 1;
      }
    }
  }
  const lineCountActual = Math.min(lineCount, lines.length);

  const lineOfPos = (pos: number): LineInfo => {
    let lo = 0;
    let hi = lineCountActual - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].from <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lines[lo];
  };
  const touchedByCursor = (from: number, to: number): boolean => {
    const first = lineOfPos(from).n;
    const last = lineOfPos(Math.max(from, to - 1)).n;
    for (let n = first; n <= last; n++) if (cursorLines.has(n)) return true;
    return false;
  };

  const decos: Range<Decoration>[] = [];
  const add = (from: number, to: number, d: Decoration) => decos.push(d.range(from, to));
  const lineDeco = (line: LineInfo, d: Decoration) => decos.push(d.range(line.from, line.from));
  const hideChildMarks = (parent: SyntaxNode, markName: string) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.name === markName) add(child.from, child.to, hide);
    }
  };

  // 受保护范围（其中的文本不做数学扫描）
  const protectedRanges: Array<{ from: number; to: number }> = [];

  tree.iterate({
    enter: (ref) => {
      const node = ref.node;
      const { name, from, to } = node;
      const offCursor = !touchedByCursor(from, to);

      if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
        const level = Number(name.slice(name.indexOf("Heading") + "Heading".length));
        if (level >= 1 && level <= 6) lineDeco(lineOfPos(from), headingLine(level));
        if (offCursor) {
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.name === "HeaderMark") {
              // ATX：连同后面的空格一起隐藏；Setext：隐藏下划线行
              if (name.startsWith("SetextHeading")) {
                const markLine = lineOfPos(child.from);
                add(markLine.from, markLine.to, hide);
              } else {
                add(child.from, doc[child.to] === " " ? child.to + 1 : child.to, hide);
              }
            }
          }
        }
        return true;
      }

      switch (name) {
        case "Emphasis":
        case "StrongEmphasis": {
          add(from, to, mdMark({ class: name === "Emphasis" ? "cm-md-em" : "cm-md-strong" }));
          if (offCursor) hideChildMarks(node, "EmphasisMark");
          return true; // 嵌套（***粗斜体*** 等）
        }
        case "Strikethrough": {
          add(from, to, mdMark({ class: "cm-md-strike" }));
          if (offCursor) hideChildMarks(node, "StrikethroughMark");
          return false;
        }
        case "InlineCode": {
          add(from, to, mdMark({ class: "cm-md-inlinecode" }));
          protectedRanges.push({ from, to });
          if (offCursor) hideChildMarks(node, "CodeMark");
          return false;
        }
        case "Link": {
          add(from, to, mdMark({ class: "cm-md-link" }));
          if (offCursor) {
            for (let child = node.firstChild; child; child = child.nextSibling) {
              if (child.name === "LinkMark" || child.name === "URL") add(child.from, child.to, hide);
            }
          }
          return false;
        }
        case "Image": {
          protectedRanges.push({ from, to });
          if (offCursor) {
            const info = parseImage(doc.slice(from, to));
            if (info) add(from, to, Decoration.replace({ widget: new ImageWidget(info.url, info.alt) }));
          }
          return false;
        }
        case "ListMark":
          add(from, to, mdMark({ class: "cm-md-listmark" }));
          return false;

        case "TaskMarker": {
          if (offCursor) {
            const checked = /\[[xX]\]/.test(doc.slice(from, to));
            add(from, to, Decoration.replace({ widget: new TaskCheckboxWidget(checked, from) }));
          }
          return false;
        }
        case "Blockquote": {
          // 引用块的每一行加左边框样式；非光标行隐藏 > 标记
          const firstLine = lineOfPos(from).n;
          const lastLine = lineOfPos(Math.max(from, to - 1)).n;
          for (let n = firstLine; n <= lastLine; n++) {
            lineDeco(lines[n - 1], mdLine("cm-md-quote"));
            if (!cursorLines.has(n)) {
              for (let child = node.firstChild; child; child = child.nextSibling) {
                if (child.name === "QuoteMark" && lineOfPos(child.from).n === n) {
                  add(child.from, child.to, hide);
                }
              }
            }
          }
          return true; // 引用内可能嵌套列表/代码块
        }
        case "FencedCode": {
          protectedRanges.push({ from, to });
          const first = lineOfPos(from);
          const last = lineOfPos(Math.max(from, to - 1));
          for (let n = first.n; n <= last.n; n++) {
            const cls = n === first.n ? "cm-code-line cm-code-first" : n === last.n ? "cm-code-line cm-code-last" : "cm-code-line";
            lineDeco(lines[n - 1], mdLine(cls));
          }
          // 语言
          let lang = "";
          for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.name === "CodeInfo") lang = doc.slice(child.from, child.to).trim();
          }
          const contentFrom = first.to + 1;
          const contentTo = last.from - 1;
          const code = contentTo > contentFrom ? doc.slice(contentFrom, contentTo) : "";
          // 复制按钮（首行行尾，CSS hover 显示）
          add(first.to, first.to, Decoration.widget({ widget: new CopyButtonWidget(code), side: 10 }));
          if (lang === "mermaid") {
            add(to, to, Decoration.widget({ widget: new MermaidWidget(code), side: 10 }));
          }
          return false;
        }
        case "TableHeader": {
          lineDeco(lineOfPos(from), mdLine("cm-md-table-head"));
          dimPipes(node, add);
          return false;
        }
        case "TableRow": {
          lineDeco(lineOfPos(from), mdLine("cm-md-table-row"));
          dimPipes(node, add);
          return false;
        }
        case "TableDelimiter": {
          // 顶层出现的即分隔行（| --- |），整行置灰
          lineDeco(lineOfPos(from), mdLine("cm-md-table-sep"));
          return false;
        }
        case "HorizontalRule": {
          const line = lineOfPos(from);
          if (!cursorLines.has(line.n)) {
            add(line.from, line.to, Decoration.replace({ widget: new HrWidget() }));
          }
          return false;
        }
        default:
          // 容器节点需继续深入子节点
          return (
            name === "Document" ||
            name === "Paragraph" ||
            name === "Table" ||
            name === "Task" ||
            name === "ListItem" ||
            name.endsWith("List")
          );
      }
    },
  });

  // —— 数学：$$ 多行块（光标触及任何一行则整块显示源码）——
  {
    let open = -1;
    for (let i = 0; i < lineCountActual; i++) {
      const line = lines[i];
      const isFence = /^\s*\$\$\s*$/.test(doc.slice(line.from, line.to));
      if (!isFence) continue;
      if (open === -1) {
        open = i;
      } else {
        let touched = false;
        for (let k = open; k <= i && !touched; k++) if (cursorLines.has(lines[k].n)) touched = true;
        if (!touched) {
          const contentFrom = lines[open].to + 1;
          const contentTo = lines[i].from;
          const content = contentTo > contentFrom ? doc.slice(contentFrom, contentTo) : "";
          add(
            lines[open].from,
            lines[i].to,
            Decoration.replace({ block: true, widget: new MathWidget(content, true) }),
          );
          protectedRanges.push({ from: lines[open].from, to: lines[i].to });
        }
        open = -1;
      }
    }
  }

  // —— 数学：行内 $...$（跳过光标行与受保护范围）——
  for (let i = 0; i < lineCountActual; i++) {
    const line = lines[i];
    if (cursorLines.has(line.n)) continue;
    scanInlineMath(doc, line, protectedRanges, add);
  }

  return Decoration.set(decos, true);
}

function dimPipes(node: SyntaxNode, add: (from: number, to: number, d: Decoration) => void): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableDelimiter") {
      add(child.from, child.to, mdMark({ class: "cm-md-table-pipe" }));
    }
  }
}

function parseImage(text: string): { url: string; alt: string } | null {
  const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(text);
  if (!m) return null;
  return { alt: m[1], url: m[2] };
}

const INLINE_MATH_RE = /\$([^$\n]+?)\$/g;

function scanInlineMath(
  doc: string,
  line: LineInfo,
  protectedRanges: Array<{ from: number; to: number }>,
  add: (from: number, to: number, d: Decoration) => void,
): void {
  const text = doc.slice(line.from, line.to);
  if (!text.includes("$")) return;
  INLINE_MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_MATH_RE.exec(text))) {
    const latex = m[1];
    if (!latex.trim()) continue;
    // 定界规则：$ 后与闭合 $ 前不能是空白；非转义 \$
    if (/^\s/.test(latex) || /\s$/.test(latex)) continue;
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (start > 0 && doc.charCodeAt(start - 1) === 92 /* \ */) continue;
    if (protectedRanges.some((r) => start < r.to && end > r.from)) continue;
    add(start, end, Decoration.replace({ widget: new MathWidget(latex, false) }));
  }
}

/** livePreview ViewPlugin：文档/选区/视口变化或源码模式开关（facet）时重建装饰。 */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFor(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.state.facet(livePreviewFacet) !== update.startState.facet(livePreviewFacet)
      ) {
        this.decorations = buildFor(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function buildFor(view: EditorView): DecorationSet {
  const state = view.state;
  const cursorLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let n = fromLine; n <= toLine; n++) cursorLines.add(n);
  }
  return computeDecorations({
    doc: state.doc.toString(),
    tree: syntaxTree(state),
    cursorLines,
    lineCount: state.doc.lines,
    enabled: state.facet(livePreviewFacet),
  });
}

export function livePreviewExtension(): Extension {
  return livePreviewPlugin;
}
