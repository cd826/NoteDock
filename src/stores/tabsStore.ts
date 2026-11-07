import { create } from "zustand";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { ipc } from "../lib/ipc";
import { parseFsError } from "../lib/fsError";
import { basename, defaultNameFor, kindForPath } from "../lib/path";
import { useUiStore } from "../lib/toast";
import { useMetaStore } from "./metaStore";
import type { FileKind } from "../types/state";
import { t } from "../i18n";

/**
 * 标签页运行态（会话快照经 metaStore.setSession 持久化）。
 * 保存可靠性规则（需求 §5.3、§6.4）：
 * - 切换/关闭标签页时确保已保存；保存失败不得静默丢内容；
 * - 保存前以 mtime 快照做外部修改检测，冲突时给出横幅而非覆盖。
 */

export type ConflictKind = "external-change" | "missing";

export interface Tab {
  id: string;
  path: string;
  title: string;
  kind: FileKind;
  content: string;
  dirty: boolean;
  /** 上次读取/写入磁盘时的 mtime 快照（毫秒），null = 尚无基线。 */
  mtime: number | null;
  encoding: string;
  hasBom: boolean;
  conflict: ConflictKind | null;
  cursor: number;
  scrollTop: number;
  sourceMode: boolean;
}

interface OpenOptions {
  /** 恢复会话时不逐个弹缺失提示。 */
  silent?: boolean;
  cursor?: number;
  scrollTop?: number;
  sourceMode?: boolean;
}

interface TabsStore {
  tabs: Tab[];
  activeId: string | null;
  openPath(path: string, opts?: OpenOptions): Promise<boolean>;
  openPaths(paths: string[]): Promise<void>;
  newFile(kind: FileKind): Promise<void>;
  save(id: string, opts?: { force?: boolean }): Promise<boolean>;
  saveActive(): Promise<void>;
  saveAs(id: string): Promise<void>;
  saveAsActive(): Promise<void>;
  closeTab(id: string): Promise<void>;
  setActive(id: string): Promise<void>;
  setActiveIndex(index: number): void;
  updateContent(id: string, content: string): void;
  setEditorState(id: string, patch: Partial<Pick<Tab, "cursor" | "scrollTop">>): void;
  toggleSourceMode(id: string): void;
  reloadFromDisk(id: string): Promise<void>;
  finishRename(id: string, newPath: string): void;
  restoreSession(): Promise<void>;
}

const FILE_FILTERS = [
  { name: "Markdown / TXT / SQL", extensions: ["md", "markdown", "txt", "sql"] },
];

function tabFromRead(
  path: string,
  info: Awaited<ReturnType<typeof ipc.readTextFile>>,
  opts?: OpenOptions,
): Tab {
  return {
    id: crypto.randomUUID(),
    path,
    title: basename(path),
    kind: info.kind,
    content: info.content,
    dirty: false,
    mtime: info.mtime,
    encoding: info.encoding,
    hasBom: info.hasBom,
    conflict: null,
    cursor: opts?.cursor ?? 0,
    scrollTop: opts?.scrollTop ?? 0,
    sourceMode: opts?.sourceMode ?? false,
  };
}

function patchTab(id: string, patch: Partial<Tab>): void {
  useTabsStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

function findTab(id: string): Tab | undefined {
  return useTabsStore.getState().tabs.find((t) => t.id === id);
}

function activeTab(): Tab | undefined {
  const s = useTabsStore.getState();
  return s.tabs.find((t) => t.id === s.activeId);
}

/** 当前会话快照 → metaStore（防抖落盘）。 */
function persistSession(): void {
  const s = useTabsStore.getState();
  const active = s.tabs.findIndex((t) => t.id === s.activeId);
  useMetaStore.getState().setSession({
    tabs: s.tabs.map((t) => ({
      path: t.path,
      kind: t.kind,
      cursor: t.cursor,
      scrollTop: t.scrollTop,
      sourceMode: t.sourceMode,
    })),
    active,
  });
}

function showToast(message: string): void {
  useUiStore.getState().showToast(message);
}

/** 新建文件的默认目录：偏好目录 → 文稿目录（缓存）。 */
let cachedDocsDir: string | null | undefined;
async function defaultSaveDir(): Promise<string | undefined> {
  const pref = useMetaStore.getState().meta.prefs.defaultSaveDir;
  if (pref) return pref;
  if (cachedDocsDir === undefined) {
    cachedDocsDir = await ipc.getDocumentsDir().catch(() => null);
  }
  return cachedDocsDir ?? undefined;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeId: null,

  openPath: async (path, opts) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      await get().setActive(existing.id);
      return true;
    }
    // 焦点即将转移到新标签页：先保存当前脏标签页（需求 §4.3 切换时自动保存）
    const prev = get().tabs.find((t) => t.id === get().activeId);
    if (prev?.dirty && prev.conflict !== "missing") {
      await get().save(prev.id);
    }
    try {
      const info = await ipc.readTextFile(path);
      const tab = tabFromRead(path, info, opts);
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      useMetaStore.getState().recordOpened(path);
      persistSession();
      return true;
    } catch (raw) {
      const err = parseFsError(raw);
      if (!opts?.silent) {
        if (err.kind === "not-found") showToast(t("missingOpenToast"));
        else if (err.kind === "io") showToast(err.message);
      }
      return false;
    }
  },

  openPaths: async (paths) => {
    for (const p of paths) await get().openPath(p);
  },

  newFile: async (kind) => {
    // 需求 §6.5：先确定保存位置，再建立文件并进入编辑
    const dir = await defaultSaveDir();
    const name = defaultNameFor(kind);
    const defaultPath = dir ? `${dir.replace(/\/$/, "")}/${name}` : name;
    const path = await dialogSave({ defaultPath, filters: FILE_FILTERS });
    if (!path) return;
    try {
      await ipc.createTextFile(path);
    } catch (raw) {
      const err = parseFsError(raw);
      showToast(err.kind === "already-exists" ? "文件已存在" : err.kind === "io" ? err.message : "创建文件失败");
      return;
    }
    await get().openPath(path);
  },

  save: async (id, opts) => {
    const tab = findTab(id);
    if (!tab) return false;
    try {
      const result = await ipc.writeTextFile({
        path: tab.path,
        content: tab.content,
        expectedMtime: tab.mtime,
        force: opts?.force,
        // 非 UTF-8 文件首次保存即转为 UTF-8（前端已明确提示，需求 §6.6.8）
        preserveBom: tab.encoding === "UTF-8" && tab.hasBom ? true : undefined,
      });
      patchTab(id, { dirty: false, mtime: result.mtime, conflict: null, encoding: "UTF-8" });
      return true;
    } catch (raw) {
      const err = parseFsError(raw);
      if (err.kind === "external-change") {
        patchTab(id, { conflict: "external-change" });
      } else if (err.kind === "not-found") {
        patchTab(id, { conflict: "missing" });
      } else {
        showToast(err.kind === "io" ? err.message : "保存失败");
      }
      return false;
    }
  },

  saveActive: async () => {
    const tab = activeTab();
    if (tab?.dirty) await get().save(tab.id);
  },

  saveAs: async (id) => {
    const tab = findTab(id);
    if (!tab) return;
    const path = await dialogSave({
      defaultPath: tab.path,
      filters: FILE_FILTERS,
    });
    if (!path || path === tab.path) return;
    // 新路径无冲突基线（expectedMtime 传 null 跳过检测）
    patchTab(id, { path, title: basename(path), kind: kindForPath(path), mtime: null, conflict: null });
    const ok = await get().save(id);
    if (ok) {
      useMetaStore.getState().recordOpened(path);
      persistSession();
    }
  },

  saveAsActive: async () => {
    const tab = activeTab();
    if (tab) await get().saveAs(tab.id);
  },

  closeTab: async (id) => {
    const tab = findTab(id);
    if (!tab) return;
    if (tab.dirty) {
      if (tab.conflict === "missing") {
        // 需求 §6.4.8：文件失效时保留未保存内容，引导另存为
        showToast("原文件已不存在，请选择「另存为」保留内容");
        return;
      }
      const ok = await get().save(id);
      if (!ok) return; // 冲突未解决，保留标签页
    }
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const rest = s.tabs.filter((t) => t.id !== id);
      let nextActive = s.activeId;
      if (s.activeId === id) {
        const neighbor = rest[Math.min(idx, rest.length - 1)];
        nextActive = neighbor ? neighbor.id : null;
      }
      return { tabs: rest, activeId: nextActive };
    });
    persistSession();
  },

  setActive: async (id) => {
    const prev = activeTab();
    if (prev && prev.id !== id && prev.dirty && prev.conflict !== "missing") {
      // 切换前自动保存（失败不阻断切换，返回时仍显示横幅/脏标记）
      await get().save(prev.id);
    }
    set({ activeId: id });
  },

  setActiveIndex: (index) => {
    const s = get();
    const tab = s.tabs[index];
    if (tab) void s.setActive(tab.id);
  },

  updateContent: (id, content) => {
    patchTab(id, { content, dirty: true });
  },

  setEditorState: (id, patch) => {
    patchTab(id, patch);
    persistSession();
  },

  toggleSourceMode: (id) => {
    const tab = findTab(id);
    if (tab) {
      patchTab(id, { sourceMode: !tab.sourceMode });
      persistSession();
    }
  },

  reloadFromDisk: async (id) => {
    const tab = findTab(id);
    if (!tab) return;
    try {
      const info = await ipc.readTextFile(tab.path);
      patchTab(id, {
        content: info.content,
        mtime: info.mtime,
        dirty: false,
        conflict: null,
        encoding: info.encoding,
        hasBom: info.hasBom,
      });
    } catch (raw) {
      const err = parseFsError(raw);
      if (err.kind === "not-found") patchTab(id, { conflict: "missing" });
      else showToast(err.kind === "io" ? err.message : "重新加载失败");
    }
  },

  finishRename: (id, newPath) => {
    const tab = findTab(id);
    if (!tab || tab.path === newPath) return;
    useMetaStore.getState().removeRecent(tab.path);
    patchTab(id, { path: newPath, title: basename(newPath), kind: kindForPath(newPath) });
    useMetaStore.getState().recordOpened(newPath);
    persistSession();
  },

  restoreSession: async () => {
    const meta = useMetaStore.getState().meta;
    if (!meta.prefs.restoreSession || meta.session.tabs.length === 0) return;
    let missing = 0;
    for (const entry of meta.session.tabs) {
      const ok = await get().openPath(entry.path, {
        silent: true,
        cursor: entry.cursor,
        scrollTop: entry.scrollTop,
        sourceMode: entry.sourceMode,
      });
      if (!ok) missing += 1;
    }
    if (missing > 0) showToast(t("sessionMissingToast", { count: missing }));
    // 恢复活动标签
    const activeEntry = meta.session.active;
    if (activeEntry >= 0) {
      get().setActiveIndex(activeEntry);
    }
  },
}));
