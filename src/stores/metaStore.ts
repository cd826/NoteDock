import { create } from "zustand";
import {
  DEFAULT_META,
  type AppMeta,
  type Prefs,
  type Session,
} from "../types/state";
import { ipc } from "../lib/ipc";

/**
 * 本地元数据唯一持有者（对应 Rust state.rs 的 AppMeta）。
 * 覆盖：偏好设置、固定文件、最近文件、会话（标签页/光标/滚动）。
 * 任何变更经 debounce 后原子写回 JSON（Phase 2 起供 pinned/recents/session 使用）。
 * 只存辅助信息，绝不保存文件正文（需求 §6.3）。
 */

interface MetaStore {
  /** 首次启动从磁盘加载完成。 */
  hydrated: boolean;
  meta: AppMeta;
  hydrate(): Promise<void>;
  setPrefs(patch: Partial<Prefs>): void;
  setSession(session: Session): void;
}

const SAVE_DEBOUNCE_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void ipc
      .saveAppState(useMetaStore.getState().meta)
      .catch((err) => console.error("[meta] 保存元数据失败", err));
  }, SAVE_DEBOUNCE_MS);
}

export const useMetaStore = create<MetaStore>((set, get) => ({
  hydrated: false,
  meta: DEFAULT_META,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const loaded = await ipc.loadAppState();
      // 与默认值合并：兼容旧版本/缺字段（Rust 侧 serde default 同样兜底）
      set({ meta: { ...DEFAULT_META, ...loaded }, hydrated: true });
    } catch (err) {
      // 元数据读取失败不应阻断应用启动（用户文件不受影响）
      console.error("[meta] 加载元数据失败", err);
      set({ hydrated: true });
    }
  },
  setPrefs: (patch) => {
    set((s) => ({ meta: { ...s.meta, prefs: { ...s.meta.prefs, ...patch } } }));
    schedulePersist();
  },
  setSession: (session) => {
    set((s) => ({ meta: { ...s.meta, session } }));
    schedulePersist();
  },
}));

/** 立即持久化（退出/关闭窗口前 flush，Phase 4 接入）。 */
export function flushMeta(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return ipc
    .saveAppState(useMetaStore.getState().meta)
    .catch((err) => console.error("[meta] 保存元数据失败", err));
}
