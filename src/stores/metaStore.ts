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
 * 任何变更经 debounce 后原子写回 JSON。
 * 只存辅助信息，绝不保存文件正文（需求 §6.3）。
 */

/** 需求 §4.1：最近列表默认展示 10–15 条；存储层保留更多以支持"展开查看更多"。 */
const MAX_RECENTS = 50;

interface MetaStore {
  /** 首次启动从磁盘加载完成。 */
  hydrated: boolean;
  meta: AppMeta;
  hydrate(): Promise<void>;
  setPrefs(patch: Partial<Prefs>): void;
  setSession(session: Session): void;
  // —— 固定 / 最近（需求 §4.1、§5.2）——
  /** 文件被打开时记录进最近列表（无需修改内容）；去重、置顶、上限。 */
  recordOpened(path: string): void;
  pinPath(path: string): void;
  unpinPath(path: string): void;
  /** 拖拽排序：from 移动到 to 位置。 */
  reorderPinned(from: number, to: number): void;
  removeRecent(path: string): void;
  clearRecents(): void;
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
  recordOpened: (path) => {
    set((s) => {
      // 固定文件不进入最近列表（需求 §4.1：同一文件只存在于一个区域，固定优先）
      if (s.meta.pinned.some((p) => p.path === path)) return s;
      const now = Date.now();
      const rest = s.meta.recents.filter((r) => r.path !== path);
      const recents = [{ path, lastOpenedAt: now }, ...rest].slice(0, MAX_RECENTS);
      return { meta: { ...s.meta, recents } };
    });
    schedulePersist();
  },
  pinPath: (path) => {
    set((s) => {
      if (s.meta.pinned.some((p) => p.path === path)) return s;
      const pinned = [...s.meta.pinned, { path, addedAt: Date.now() }];
      // 固定后从最近列表移除
      const recents = s.meta.recents.filter((r) => r.path !== path);
      return { meta: { ...s.meta, pinned, recents } };
    });
    schedulePersist();
  },
  unpinPath: (path) => {
    set((s) => {
      const pinned = s.meta.pinned.filter((p) => p.path !== path);
      // 取消固定后回到最近列表
      const recents = s.meta.recents.some((r) => r.path === path)
        ? s.meta.recents
        : [{ path, lastOpenedAt: Date.now() }, ...s.meta.recents];
      return { meta: { ...s.meta, pinned, recents } };
    });
    schedulePersist();
  },
  reorderPinned: (from, to) => {
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.meta.pinned.length) return s;
      const pinned = [...s.meta.pinned];
      const [moved] = pinned.splice(from, 1);
      pinned.splice(Math.min(to, pinned.length), 0, moved);
      return { meta: { ...s.meta, pinned } };
    });
    schedulePersist();
  },
  removeRecent: (path) => {
    set((s) => ({
      meta: { ...s.meta, recents: s.meta.recents.filter((r) => r.path !== path) },
    }));
    schedulePersist();
  },
  clearRecents: () => {
    set((s) => ({ meta: { ...s.meta, recents: [] } }));
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
