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
  clearRecent: "Clear",
  showMore: "Show More",
  showLess: "Collapse",
  pinAction: "Pin",
  unpinAction: "Unpin",
  removeRecentAction: "Remove from Recent",

  editorEmptyTitle: "NoteDock",
  editorEmptyHint: "Open a file from the sidebar, or drop .md / .txt / .sql files to edit",
  savedFlash: "Saved",

  conflictText: "File was modified by another app",
  missingText: "File has been moved or deleted",
  encodingNotice: "File encoding is {encoding}; it will be saved as UTF-8",
  reload: "Reload",
  overwrite: "Overwrite",
  relocate: "Relocate…",
  closeTabAction: "Close Tab",
  missingOpenToast: "File does not exist or was deleted",
  sessionMissingToast: "{count} previously opened files are missing and were skipped",

  quickOpenPlaceholder: "Search file names (pinned + recent)…",
  globalSearchPlaceholder: "Search file names & contents (pinned + recent)…",
  searchNoResults: "No matches",
  searching: "Searching…",
  largeFileNotice: "Large file ({size} MB), editing may be slow",

  renameTitle: "Rename File",
  renameConfirm: "Rename",
  renameCancel: "Cancel",

  draftNotSavedToast: "Draft not on disk yet — press ⌘S to save first",
  discardDraftPrompt: "The draft “{title}” isn't saved and will be lost if closed.",
  discardDraft: "Discard Draft",
  quitDraftPrompt: "{count} unsaved draft(s) will be lost if you quit.",
  cancelLabel: "Cancel",
};

export default en;
