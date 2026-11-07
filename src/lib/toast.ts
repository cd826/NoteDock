import { create } from "zustand";

/** 轻量提示（保存失败、文件缺失等，需求 §8.5：轻量、明确的反馈）。 */

interface UiStore {
  toast: { message: string; id: number } | null;
  /** 最近一次显式保存成功的时间戳（0 = 无），用于标签栏"已保存"闪烁提示。 */
  savedAt: number;
  /** 重命名对话框打开时的目标标签页 id。 */
  renameTargetTabId: string | null;
  /** 已确认失效（移动/删除）的路径集合。 */
  missingPaths: Record<string, true>;
  showToast(message: string): void;
  clearToast(): void;
  markSaved(): void;
  openRenameDialog(tabId: string): void;
  closeRenameDialog(): void;
  setMissing(paths: string[]): void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

export const useUiStore = create<UiStore>((set) => ({
  toast: null,
  savedAt: 0,
  renameTargetTabId: null,
  missingPaths: {},
  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    const id = ++toastSeq;
    set({ toast: { message, id } });
    toastTimer = setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : s));
    }, 4000);
  },
  clearToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: null });
  },
  markSaved: () => set({ savedAt: Date.now() }),
  openRenameDialog: (tabId) => set({ renameTargetTabId: tabId }),
  closeRenameDialog: () => set({ renameTargetTabId: null }),
  setMissing: (paths) =>
    set(() => ({ missingPaths: Object.fromEntries(paths.map((p) => [p, true])) })),
}));
