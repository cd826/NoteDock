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
  clearRecent: "清空",
  showMore: "显示更多",
  showLess: "收起",
  pinAction: "固定",
  unpinAction: "取消固定",
  removeRecentAction: "从最近列表移除",

  // 编辑区
  editorEmptyTitle: "NoteDock",
  editorEmptyHint: "从左侧打开文件，或拖入 .md / .txt / .sql 文件开始编辑",
  savedFlash: "已保存",

  // 文件状态
  conflictText: "文件已被其他应用修改",
  missingText: "文件已被移动或删除",
  encodingNotice: "文件编码为 {encoding}，保存后将转换为 UTF-8",
  reload: "重新加载",
  overwrite: "覆盖保存",
  relocate: "重新定位…",
  closeTabAction: "关闭标签页",
  missingOpenToast: "文件不存在或已被删除",
  sessionMissingToast: "{count} 个上次打开的文件已失效，已跳过",

  // 搜索面板
  quickOpenPlaceholder: "搜索文件名（固定 + 最近）…",
  globalSearchPlaceholder: "搜索文件名与内容（固定 + 最近）…",
  searchNoResults: "无匹配结果",
  searching: "搜索中…",
  largeFileNotice: "大文件（{size} MB），编辑可能变慢",

  // 重命名
  renameTitle: "重命名文件",
  renameConfirm: "重命名",
  renameCancel: "取消",

  // 新建草稿（先编辑，首次保存时才选位置）
  draftNotSavedToast: "草稿尚未保存到磁盘，请先 ⌘S 保存",
  discardDraftPrompt: "草稿「{title}」尚未保存，关闭后将丢失。",
  discardDraft: "丢弃草稿",
  quitDraftPrompt: "有 {count} 个未保存的草稿，退出后将丢失。",
  cancelLabel: "取消",
} as const;

export type I18nKey = keyof typeof zh;
export default zh;
