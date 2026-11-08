import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { ipc } from "./ipc";
import { dispatchMenuAction, MenuIds, registerMenuAction } from "./menuActions";
import { useMetaStore } from "../stores/metaStore";
import { useTabsStore } from "../stores/tabsStore";
import { useUiStore } from "./toast";

async function openViaDialog(): Promise<void> {
  // 不传 filters：允许选择任意文件（不限扩展名），按文本尝试打开。
  // 二进制内容由 Rust 侧 NUL 守卫明确拒绝（需求 §1.3 支持打开普通文本文件）。
  const path = await dialogOpen({ multiple: false });
  if (typeof path === "string" && path) await useTabsStore.getState().openPath(path);
}

function activeTogglePin(): void {
  const tabs = useTabsStore.getState();
  const tab = tabs.tabs.find((t) => t.id === tabs.activeId);
  if (!tab) return;
  const meta = useMetaStore.getState();
  if (meta.meta.pinned.some((p) => p.path === tab.path)) {
    meta.unpinPath(tab.path);
  } else {
    meta.pinPath(tab.path);
  }
}

/**
 * 应用级动作接线：菜单/快捷键事件、Finder 打开事件、拖拽打开。
 * 各动作 handler 一律经 store.getState() 取最新状态，避免闭包过期。
 */
export function useFileActions(): void {
  useEffect(() => {
    const tabs = () => useTabsStore.getState();
    const ui = () => useUiStore.getState();

    const unsubs = [
      registerMenuAction(MenuIds.openFile, () => void openViaDialog()),
      registerMenuAction(MenuIds.quickOpen, () => ui().openPalette("quick")),
      registerMenuAction(MenuIds.globalSearch, () => ui().openPalette("global")),
      registerMenuAction(MenuIds.newMd, () => void tabs().newFile("md")),
      registerMenuAction(MenuIds.newTxt, () => void tabs().newFile("txt")),
      registerMenuAction(MenuIds.save, () => void tabs().saveActive()),
      registerMenuAction(MenuIds.saveAs, () => void tabs().saveAsActive()),
      registerMenuAction(MenuIds.renameFile, () => {
        const s = tabs();
        if (s.activeId) ui().openRenameDialog(s.activeId);
      }),
      registerMenuAction(MenuIds.revealFinder, () => {
        const s = tabs();
        const tab = s.tabs.find((t) => t.id === s.activeId);
        if (tab) void ipc.revealInFinder(tab.path);
      }),
      registerMenuAction(MenuIds.togglePin, activeTogglePin),
      registerMenuAction(MenuIds.closeTab, () => {
        const s = tabs();
        if (s.activeId) void s.closeTab(s.activeId);
      }),
    ];

    // 原生菜单/快捷键动作 → 注册表（menu.rs → on_menu_event → 此处分发）。
    // 注意：此监听是整条快捷键链路的入口，缺失会导致全部菜单快捷键失效。
    const unMenuPromise = listen<string>("menu-action", (e) =>
      dispatchMenuAction(e.payload),
    );

    // Finder 双击 / 拖到 Dock 图标（lib.rs RunEvent::Opened）
    const unlistenPromise = listen<string[]>("open-paths", (e) =>
      void tabs().openPaths(e.payload),
    );

    // 拖拽文件到窗口打开（需求 §6.2）：不限扩展名，二进制由读取守卫拒绝
    const unDragPromise = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") {
        if (event.payload.paths.length > 0) await tabs().openPaths(event.payload.paths);
      }
    });

    return () => {
      unsubs.forEach((un) => un());
      void unMenuPromise.then((un) => un());
      void unlistenPromise.then((un) => un());
      void unDragPromise.then((un) => un());
    };
  }, []);
}
