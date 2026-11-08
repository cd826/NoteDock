import { create } from "zustand";
import type { EditorState } from "@codemirror/state";
import { ask, save as dialogSave } from "@tauri-apps/plugin-dialog";
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
  /** 磁盘路径；null = 新建草稿（未落盘，首次 ⌘S 时才选择保存位置）。 */
  path: string | null;
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

/** 当前会话快照 → metaStore（防抖落盘）。草稿（未落盘）不进会话：正文不入元数据。 */
function persistSession(): void {
  syncWatchedPaths();
  const s = useTabsStore.getState();
  const saved = s.tabs.filter((t) => t.path !== null);
  const active = saved.findIndex((t) => t.id === s.activeId);
  useMetaStore.getState().setSession({
    tabs: saved.map((t) => ({
      path: t.path as string,
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
 * 草稿（未选位置的新建文件）无法静默写盘，由关闭/退出流程单独确认丢弃。
 */
export async function flushAllDirty(): Promise<void> {
  const s = useTabsStore.getState();
  for (const tab of s.tabs) {
    if (tab.dirty && tab.path !== null && !tab.conflict) await s.save(tab.id);
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

/** 草稿标题：未命名.md / 未命名 2.md（同屏多个草稿时编号，跟随系统语言）。 */
function nextDraftTitle(kind: FileKind): string {
  const base = defaultNameFor(kind);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  const taken = new Set(
    useTabsStore.getState()
      .tabs.filter((t) => t.path === null)
      .map((t) => t.title),
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${stem} ${n}${ext}`)) n += 1;
  return `${stem} ${n}${ext}`;
}

/** 新建草稿确认丢弃（关闭脏草稿/退出时防误丢，一次点击即放弃）。 */
async function confirmDiscardDraft(message: string): Promise<boolean> {
  return ask(message, {
    title: "NoteDock",
    okLabel: t("discardDraft"),
    cancelLabel: t("cancelLabel"),
  });
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
    // 新建流程（按用户决策 2026-11-08）：先开草稿直接编辑，首次 ⌘S 时才选择保存位置。
    // 临时记录无需落盘，关闭时确认丢弃即可。
    const tab: Tab = {
      id: crypto.randomUUID(),
      path: null,
      title: nextDraftTitle(kind),
      kind,
      content: "",
      dirty: false,
      mtime: null,
      encoding: "UTF-8",
      hasBom: false,
      conflict: null,
      cursor: 0,
      scrollTop: 0,
      sourceMode: false,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },

  save: async (id, opts) => {
    const tab = findTab(id);
    if (!tab) return false;
    if (tab.path === null) {
      // 草稿首次保存 → 先选择保存位置，再写盘
      return performSaveAs(id);
    }
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
    if (tab.path === null) {
      // 草稿：⌘S = 选择保存位置并落盘（即使尚未编辑，也允许显式保存空文件）
      const ok = await get().save(tab.id);
      if (ok) useUiStore.getState().markSaved();
      return;
    }
    if (!tab.dirty) {
      // 内容未变化也视为已保存（用户确认性 ⌘S）
      useUiStore.getState().markSaved();
      return;
    }
    const ok = await get().save(tab.id);
    if (ok) useUiStore.getState().markSaved();
  },

  saveAs: async (id) => {
    await performSaveAs(id);
  },

  saveAsActive: async () => {
    const tab = activeTab();
    if (tab) await get().saveAs(tab.id);
  },

  closeTab: async (id) => {
    const tab = findTab(id);
    if (!tab) return;
    if (tab.dirty && tab.path === null) {
      // 草稿：不强制保存（临时记录可随手丢弃），但空内容外的丢弃需一次确认
      if (tab.content.trim() !== "") {
        const discard = await confirmDiscardDraft(t("discardDraftPrompt", { title: tab.title }));
        if (!discard) return;
      }
    } else if (tab.dirty) {
      if (tab.conflict === "missing") {
        // 需求 §6.4.8：文件失效时保留未保存内容，引导另存为
        showToast("原文件已不存在，请选择「另存为」保留内容");
        return;
      }
      const ok = await get().save(id);
      if (!ok) return; // 冲突未解决，保留标签页
    }
    dropEditorState(id);
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
    if (!tab || tab.path === null) return;
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
    if (!tab || tab.path === null || tab.path === newPath) return;
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

/**
 * 另存为 / 草稿首次保存：选择位置 → 改路径 → 写盘 → 记入最近列表。
 * 返回是否成功落盘（取消对话框视为失败，调用方据此决定是否保留标签页）。
 */
async function performSaveAs(id: string): Promise<boolean> {
  const tab = findTab(id);
  if (!tab) return false;
  const dir = tab.path === null ? await defaultSaveDir() : undefined;
  const defaultPath = tab.path ?? (dir ? `${dir.replace(/\/$/, "")}/${tab.title}` : tab.title);
  const path = await dialogSave({ defaultPath, filters: FILE_FILTERS });
  if (!path || (tab.path !== null && path === tab.path)) return false;
  // 新路径无冲突基线（expectedMtime 传 null 跳过检测）
  patchTab(id, { path, title: basename(path), kind: kindForPath(path), mtime: null, conflict: null });
  const ok = await useTabsStore.getState().save(id);
  if (ok) {
    useMetaStore.getState().recordOpened(path);
    persistSession();
  }
  return ok;
}

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
