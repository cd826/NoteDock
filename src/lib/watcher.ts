import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ipc } from "./ipc";
import { useTabsStore } from "../stores/tabsStore";
import { useUiStore } from "./toast";

/**
 * 文件监听桥（需求 §6.4）：Rust watcher（watch.rs）→ fs-event → 前端处置。
 *
 * 处置规则：
 * - 文件被移动/删除 → 标签页 conflict="missing"（横幅：重新定位/关闭）+ 侧栏灰显；
 * - 外部修改 + 无未保存编辑 → 静默重载（VSCode 行为，所见即磁盘）；
 * - 外部修改 + 有未保存编辑 → conflict="external-change"（横幅：重新加载/覆盖/另存为），
 *   绝不静默覆盖。
 *
 * 自身保存触发的事件由 mtime 快照比对天然忽略（写入后快照已更新）。
 */

let currentKey = "";

/** 打开/关闭标签页后同步监听目标（keys 去重，避免重复 IPC；草稿无路径不监听）。 */
export function syncWatchedPaths(): void {
  const paths = useTabsStore
    .getState()
    .tabs.map((t) => t.path)
    .filter((p): p is string => p !== null);
  const key = [...paths].sort().join("\n");
  if (key === currentKey) return;
  currentKey = key;
  void invoke("set_watched_paths", { paths }).catch((err) =>
    console.error("[watcher] 同步监听目标失败", err),
  );
}

export function initFsWatcher(): () => void {
  const unlisten = listen<{ path: string }>("fs-event", (e) => {
    void handleFsEvent(e.payload.path).catch((err) =>
      console.error("[watcher] 处理文件事件失败", err),
    );
  });
  return () => {
    void unlisten.then((f) => f());
  };
}

async function handleFsEvent(path: string): Promise<void> {
  const store = useTabsStore.getState();
  const tab = store.tabs.find((t) => t.path === path);
  const info = await ipc.statPath(path);
  const ui = useUiStore.getState();

  if (!info.exists) {
    // 移动/删除
    if (tab && tab.conflict !== "missing") {
      store.setTabConflict(tab.id, "missing");
    }
    if (!ui.missingPaths[path]) {
      ui.setMissing([...Object.keys(ui.missingPaths), path]);
    }
    return;
  }

  // 文件仍存在：清理侧栏灰显
  if (ui.missingPaths[path]) {
    ui.setMissing(Object.keys(ui.missingPaths).filter((p) => p !== path));
  }
  if (!tab) return;

  if (!tab.dirty) {
    // 无未保存编辑 → 静默重载，保持所见即磁盘
    if (info.mtime !== null && tab.mtime !== null && info.mtime !== tab.mtime) {
      await store.reloadFromDisk(tab.id);
    }
  } else if (info.mtime !== null && tab.mtime !== null && info.mtime !== tab.mtime) {
    // 有未保存编辑 → 冲突横幅（不覆盖）
    store.setTabConflict(tab.id, "external-change");
  }
}
