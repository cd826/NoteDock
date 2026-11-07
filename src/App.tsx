import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import AppShell from "./components/layout/AppShell";
import { dispatchMenuAction } from "./lib/menuActions";
import { useTheme } from "./lib/useTheme";
import { useMetaStore } from "./stores/metaStore";

export default function App() {
  // 深浅色跟随系统 + 偏好（需求 §8.2）
  useTheme();

  // 启动时加载本地元数据（固定/最近/偏好/会话）
  const hydrate = useMetaStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 原生菜单动作 → 前端注册表（menu.rs → menuActions）
  useEffect(() => {
    const unlisten = listen<string>("menu-action", (e) => dispatchMenuAction(e.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  return <AppShell />;
}
