/**
 * 菜单动作注册表：Rust 原生菜单（menu.rs）通过 `menu-action` 事件
 * 转发动作 id 到前端，由各功能模块注册实际处理器。
 *
 * 约定：id 与 src-tauri/src/menu.rs 中的常量一致。
 * 未注册的动作静默忽略（对应功能尚未进入当前开发阶段）。
 */

type Handler = () => void;

const handlers = new Map<string, Handler>();

/** 注册动作处理器；返回注销函数。 */
export function registerMenuAction(id: string, handler: Handler): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

export function dispatchMenuAction(id: string): void {
  handlers.get(id)?.();
}

/** 与 menu.rs 对齐的动作 id 常量，供组件注册使用。 */
export const MenuIds = {
  newMd: "new-md",
  newTxt: "new-txt",
  openFile: "open-file",
  save: "save",
  saveAs: "save-as",
  renameFile: "rename-file",
  revealFinder: "reveal-finder",
  togglePin: "toggle-pin",
  closeTab: "close-tab",
  undo: "undo",
  redo: "redo",
  find: "find",
  replace: "replace",
  toggleSourceMode: "toggle-source-mode",
  toggleSidebar: "toggle-sidebar",
} as const;
