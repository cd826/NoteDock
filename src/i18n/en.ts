import type zh from "./zh";

/** 英文文案；类型约束与 zh 键完全一致。 */
const en: Record<keyof typeof zh, string> = {
  pinnedFiles: "Pinned Files",
  recentFiles: "Recent Files",
  emptyPinned: "Pin frequently used files for quick access",
  emptyRecent: "Files you open will appear here",
  openFile: "Open File",
  newMarkdown: "New Markdown File",
  newTxt: "New TXT File",
  hideSidebar: "Hide Sidebar",
  showSidebar: "Show Sidebar",

  editorEmptyTitle: "NoteDock",
  editorEmptyHint: "Open a file from the sidebar, or drop .md / .txt / .sql files to edit",

  missingFile: "File has been moved or deleted",
  externalChange: "File was modified externally",
};

export default en;
