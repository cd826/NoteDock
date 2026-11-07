import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { keymap } from "@codemirror/view";

/**
 * Markdown 编辑快捷键（需求 §7.2）：⌘B 粗体、⌘I 斜体、⌘K 链接、
 * Enter 列表续行。⌘F/⌘⌥F（查找替换）与 ⌘/（源码模式）由原生菜单加速键
 * 分发（menu.rs），不在此重复绑定。
 */

/** 为选区包裹/解除包裹定界符（多选区安全）。 */
function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view;
    const m = marker.length;
    const changes = state.changeByRange((range) => {
      const beforeOK = range.from >= m && state.sliceDoc(range.from - m, range.from) === marker;
      const afterOK = state.sliceDoc(range.to, range.to + m) === marker;
      if (beforeOK && afterOK) {
        // 已包裹 → 解除
        return {
          changes: [
            { from: range.from - m, to: range.from, insert: "" },
            { from: range.to, to: range.to + m, insert: "" },
          ],
          range: EditorSelection.range(range.from - m, range.to - m),
        };
      }
      // 包裹
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + m, range.to + m),
      };
    });
    view.dispatch(state.update(changes));
    return true;
  };
}

/** ⌘K：把选区变为 [文本](url) 并选中 url；无选区时插入 [](url)。 */
const insertLink: Command = (view) => {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3; // [ + ] + (
    return {
      changes: [{ from: range.from, to: range.to, insert }],
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  view.dispatch(state.update(changes));
  return true;
};

export const mdKeymapExtension: Extension = keymap.of([
  { key: "Mod-b", run: toggleWrap("**") },
  { key: "Mod-i", run: toggleWrap("*") },
  { key: "Mod-k", run: insertLink },
  { key: "Enter", run: insertNewlineContinueMarkup },
]);
