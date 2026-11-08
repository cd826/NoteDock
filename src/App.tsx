import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppShell from "./components/layout/AppShell";
import RenameDialog from "./components/common/RenameDialog";
import Toast from "./components/common/Toast";
import { initFsWatcher } from "./lib/watcher";
import { useFileActions } from "./lib/useFileActions";
import { useTheme } from "./lib/useTheme";
import { flushAllDirty } from "./stores/tabsStore";
import { flushMeta, useMetaStore } from "./stores/metaStore";
import { useTabsStore } from "./stores/tabsStore";

export default function App() {
  // 深浅色跟随系统 + 偏好（需求 §8.2）
  useTheme();

  // 应用级动作接线（菜单/快捷键/Finder/拖拽）
  useFileActions();

  // 启动时加载元数据并恢复上次会话（标签页/光标/滚动）
  const hydrate = useMetaStore((s) => s.hydrate);
  useEffect(() => {
    void (async () => {
      await hydrate();
      await useTabsStore.getState().restoreSession();
    })();
  }, [hydrate]);

  // ⌘1-9 切换标签页（需求 §7.3）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        const digit = /^Digit([1-9])$/.exec(e.code);
        if (digit) {
          e.preventDefault();
          useTabsStore.getState().setActiveIndex(Number(digit[1]) - 1);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // —— 可靠性（§6.4）：文件监听 + 退出前落盘（手动保存策略：不自动写盘，仅防丢失）——
  useEffect(() => {
    const unwatch = initFsWatcher();

    // 窗口关闭/退出：先拦截 → 未保存内容与元数据落盘 → 再真正关闭。
    // 注意 Tauri 的 onCloseRequested 不会等待异步 handler，必须 preventDefault
    // 后自行 destroy，否则落盘会被中途销毁（退出后标签页/内容丢失的根因）。
    // 3 秒兜底：落盘意外挂起时也保证应用能退出。
    const unClose = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      try {
        await Promise.race([
          Promise.all([flushAllDirty(), flushMeta()]),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } finally {
        void getCurrentWindow().destroy();
      }
    });

    return () => {
      unwatch();
      void unClose.then((f) => f());
    };
  }, []);

  return (
    <>
      <AppShell />
      <RenameDialog />
      <Toast />
    </>
  );
}
