import { create } from "zustand";
import type { EditorState } from "@codemirror/state";
import { save as dialogSave } from "@tauri-apps/plugin-dialog";
import { ipc } from "../lib/ipc";
import { flushMeta } from "./metaStore";
import { parseFsError } from "../lib/fsError";
import { basename, defaultNameFor, kindForPath } from "../lib/path";
import { useUiStore } from "../lib/toast";
import { useMetaStore } from "./metaStore";
import { syncWatchedPaths } from "../lib/watcher";
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
  updateContent(id: string, content: string, cursor?: number): void;
  setTabConflict(id: string, conflict: ConflictKind | null): void;
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
  syncWatchedPaths();
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

/**
 * 同一路径的并发 openPath 去重：会话恢复（React StrictMode 下 effect 会并发触发）
 * 或用户快速双击侧栏条目时，避免同一文件被读取两次开出重复标签页。
 */
const inflightOpens = new Map<string, Promise<boolean>>();
let restoreStarted = false;

/**
 * 每标签页的编辑器状态快照（文档+撤销历史+选区）。
 * 模块级 Map 而非 React 状态：每次键入更新仅是引用赋值，不触发渲染。
 * 切换标签页时恢复 → undo 历史跨切换保留、各文件互相隔离；
 * 关闭标签页/磁盘重载时清除。
 */
const editorStates = new Map<string, EditorState>();

/** 编辑器每次文档/选区变更后调用，保存该标签页最新状态快照。 */
export function saveEditorState(id: string, state: EditorState): void {
  editorStates.set(id, state);
}

export function takeEditorState(id: string): EditorState | undefined {
  return editorStates.get(id);
}

function dropEditorState(id: string): void {
  editorStates.delete(id);
}

/**
 * 保存策略（按用户决策：手动保存优先，⌘S 写盘；不做空闲自动保存）。
 * 防丢失底线：关闭标签页 / 关闭窗口 / 退出应用前，把未保存内容写盘。
 */
export async function flushAllDirty(): Promise<void> {
  const s = useTabsStore.getState();
  for (const tab of s.tabs) {
    if (tab.dirty && !tab.conflict) await s.save(tab.id);
  }
  await flushMeta();
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

  openPath: (path, opts) => {
    const inflight = inflightOpens.get(path);
    if (inflight) return inflight;
    const task = doOpenPath(path, opts).finally(() => inflightOpens.delete(path));
    inflightOpens.set(path, task);
    return task;
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
    if (!tab) return;
    if (!tab.dirty) {
      // 内容未变化也视为已保存（用户确认性 ⌘S）
      useUiStore.getState().markSaved();
      return;
    }
    const ok = await get().save(tab.id);
    if (ok) useUiStore.getState().markSaved();
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
    dropEditorState(id);
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
    // 手动保存策略：切换不写盘，未保存内容保留在内存中（脏标记仍在）
    set({ activeId: id });
  },

  setActiveIndex: (index) => {
    const s = get();
    const tab = s.tabs[index];
    if (tab) void s.setActive(tab.id);
  },

  updateContent: (id, content, cursor) => {
    const tab = findTab(id);
    if (!tab) return;
    // 内容与磁盘基线一致时不置脏（外部重载回写等场景），避免虚假保存循环
    if (!tab.dirty && tab.content === content) {
      patchTab(id, { cursor: cursor ?? tab.cursor });
      return;
    }
    patchTab(id, { content, dirty: true, cursor: cursor ?? tab.cursor });
  },

  setTabConflict: (id, conflict) => {
    patchTab(id, { conflict });
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
    dropEditorState(id);
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
    // StrictMode 双挂载/快速触发下只允许执行一次
    if (restoreStarted) return;
    restoreStarted = true;
    const meta = useMetaStore.getState().meta;
    if (!meta.prefs.restoreSession || meta.session.tabs.length === 0) return;
    let missing = 0;
    const seen = new Set<string>();
    for (const entry of meta.session.tabs) {
      if (seen.has(entry.path)) continue; // 历史数据可能含重复项
      seen.add(entry.path);
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

/** openPath 的实际实现（经 inflightOpens 去重包装）。 */
async function doOpenPath(path: string, opts?: OpenOptions): Promise<boolean> {
  const get = () => useTabsStore.getState();
  const existing = get().tabs.find((t) => t.path === path);
  if (existing) {
    await get().setActive(existing.id);
    return true;
  }
  try {
    const info = await ipc.readTextFile(path);
    const tab = tabFromRead(path, info, opts);
    useTabsStore.setState((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
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
}
