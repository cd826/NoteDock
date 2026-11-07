/** 中文文案（跟随系统语言的默认语言）。 */
const zh = {
  // 侧边栏
  pinnedFiles: "固定文件",
  recentFiles: "最近编辑",
  emptyPinned: "将常用文件固定在这里，随时访问",
  emptyRecent: "打开过的文件会出现在这里",
  openFile: "打开文件",
  newMarkdown: "新建 Markdown 文件",
  newTxt: "新建 TXT 文件",
  hideSidebar: "隐藏侧边栏",
  showSidebar: "显示侧边栏",

  // 编辑区空态
  editorEmptyTitle: "NoteDock",
  editorEmptyHint: "从左侧打开文件，或拖入 .md / .txt / .sql 文件开始编辑",

  // 文件状态
  missingFile: "文件已被移动或删除",
  externalChange: "文件已被外部修改",
} as const;

export type I18nKey = keyof typeof zh;
export default zh;
