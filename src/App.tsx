import { useEffect } from "react";
import AppShell from "./components/layout/AppShell";
import RenameDialog from "./components/common/RenameDialog";
import Toast from "./components/common/Toast";
import { useFileActions } from "./lib/useFileActions";
import { useTheme } from "./lib/useTheme";
import { useMetaStore } from "./stores/metaStore";
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

  return (
    <>
      <AppShell />
      <RenameDialog />
      <Toast />
    </>
  );
}
