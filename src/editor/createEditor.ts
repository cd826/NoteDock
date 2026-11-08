import { sql } from "@codemirror/lang-sql";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Compartment, type Extension, EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import TurndownService from "turndown";
import { editorThemeExtension } from "./theme";
import { livePreviewExtension, livePreviewFacet } from "./livePreview";
import { mdKeymapExtension } from "./mdKeymap";
import { ipc } from "../lib/ipc";

/**
 * 按文件类型组装 CodeMirror 扩展（需求 §6.2）：
 * - md：GFM + livePreview 装饰层 + Markdown 快捷键
 * - sql：SQL 语法高亮
 * - txt：纯文本
 * 公共基础：自动换行、历史、查找替换面板、富文本粘贴、⌘点击开链接。
 */

/** 代码块常用语言懒加载注册表（@codemirror/language-data）。 */
const mdExtension = markdown({
  codeLanguages: languages,
  extensions: [GFM],
});

export function kindExtensions(kind: "md" | "txt" | "sql"): Extension {
  switch (kind) {
    case "md":
      return [mdExtension, livePreviewExtension(), mdKeymapExtension];
    case "sql":
      return sql();
    default:
      return [];
  }
}

/** 粘贴富文本 → Markdown（turndown 转换；纯文本粘贴走 CM 默认行为）。 */
function richPasteExtension(): Extension {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return EditorView.domEventHandlers({
    paste(event, view) {
      const html = event.clipboardData?.getData("text/html");
      if (!html) return false;
      const md = turndown.turndown(html);
      if (!md.trim()) return false;
      event.preventDefault();
      view.dispatch(view.state.replaceSelection(md), { scrollIntoView: true });
      return true;
    },
  });
}

/** 链接 ⌘+点击：经 Rust open_external 打开外链（配合 .cm-md-link 装饰）。 */
function linkClickExtension(): Extension {
  return EditorView.domEventHandlers({
    click(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false;
      const target = event.target as HTMLElement | null;
      const linkEl = target?.closest?.(".cm-md-link") as HTMLElement | null;
      if (!linkEl) return false;
      const pos = view.posAtDOM(linkEl);
      let node: import("@lezer/common").SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, -1);
      while (node && node.name !== "Link") node = node.parent;
      if (!node) return false;
      const m = /\]\(([^)\s]+)\)/.exec(view.state.doc.toString().slice(node.from, node.to));
      if (m && /^https?:\/\//.test(m[1])) {
        event.preventDefault();
        void ipc.openExternal(m[1]).catch(() => {});
        return true;
      }
      return false;
    },
  });
}

export function baseExtensions(): Extension[] {
  return [
    EditorView.lineWrapping,
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    editorThemeExtension,
    richPasteExtension(),
    linkClickExtension(),
    livePreviewFacet.of(true),
  ];
}

export interface CreateEditorOptions {
  parent: HTMLElement;
  kind: "md" | "txt" | "sql";
  doc: string;
  /** 光标偏移（恢复会话用）。 */
  cursor?: number;
  onUpdate: (update: { docChanged: boolean; selectionChanged: boolean; doc: string; cursor: number; view: EditorView }) => void;
}

export interface EditorHandles {
  view: EditorView;
  /** 文件类型切换（md/txt/sql）。 */
  kindComp: Compartment;
  /** 源码模式开关（livePreviewFacet）。 */
  srcComp: Compartment;
  /**
   * 构建全新 EditorState。切换标签页必须用它整体重建状态：
   * 撤销历史随标签页隔离——若用 dispatch 换文档，"换文档"本身会进入
   * 撤销栈，⌘Z 会把别的文件内容撤回来（跨文件串内容 bug）。
   */
  makeState(doc: string, kind: "md" | "txt" | "sql", sourceMode: boolean, cursor?: number): EditorState;
}

/** 创建 EditorView 实例（文档内容经 tabsStore 双向同步）。 */
export function createEditor(options: CreateEditorOptions): EditorHandles {
  const { parent, kind, doc, cursor = 0, onUpdate } = options;
  const kindComp = new Compartment();
  const srcComp = new Compartment();
  const updateExt = EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
      onUpdate({
        docChanged: update.docChanged,
        selectionChanged: update.selectionSet,
        doc: update.state.doc.toString(),
        cursor: update.state.selection.main.head,
        view: update.view,
      });
    }
  });
  const makeState = (
    stateDoc: string,
    stateKind: "md" | "txt" | "sql",
    sourceMode: boolean,
    stateCursor = 0,
  ): EditorState =>
    EditorState.create({
      doc: stateDoc,
      selection: { anchor: Math.min(stateCursor, stateDoc.length) },
      extensions: [
        ...baseExtensions(),
        kindComp.of(kindExtensions(stateKind)),
        srcComp.of(livePreviewFacet.of(!sourceMode)),
        updateExt,
      ],
    });
  const view = new EditorView({
    state: makeState(doc, kind, false, cursor),
    parent,
  });
  return { view, kindComp, srcComp, makeState };
}
