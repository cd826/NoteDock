import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * 编辑器主题：结构样式用 CSS 变量（颜色在 global.css 定义并支持深浅色），
 * 代码 token 高亮用 classHighlighter（.tok-* 类同样在 global.css 上色）。
 * 这样浅/深色切换不需要重新配置 Compartment。
 */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--ed-fg)",
    backgroundColor: "transparent",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
    lineHeight: "1.75",
  },
  ".cm-content": {
    caretColor: "var(--ed-caret)",
    // 滚动容器全宽（滚动条贴窗口右缘），内容居中限宽 800px（需求 §4.2）
    maxWidth: "800px",
    margin: "0 auto",
    padding: "12px 24px 40vh",
    boxSizing: "border-box",
    fontSize: "15px",
  },
  ".cm-line": {
    padding: "0 2px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ed-caret)",
    borderLeftWidth: "2px",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--ed-selection) !important",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--ed-search-match)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--ed-search-match-current)",
  },
  ".cm-panels": {
    backgroundColor: "var(--ed-panel-bg)",
    color: "var(--ed-fg)",
    borderBottom: "1px solid var(--ed-border)",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    fontFamily: "inherit",
    fontSize: "12px",
  },
  ".cm-panel.cm-search label": {
    fontSize: "12px",
    color: "var(--ed-fg-muted)",
  },
});

export const editorHighlight = syntaxHighlighting(classHighlighter);

export const editorThemeExtension: Extension = [editorTheme, editorHighlight];
