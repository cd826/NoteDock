import { beforeEach, describe, expect, it, vi } from "vitest";

// —— mock IPC / dialog ——
const readTextFileMock = vi.fn();
const writeTextFileMock = vi.fn();
const saveDialogMock = vi.fn();
const askDialogMock = vi.fn((..._args: unknown[]) => Promise.resolve(false));

vi.mock("../../lib/ipc", async () => {
  const state = await import("../../types/state");
  return {
    ipc: {
      loadAppState: vi.fn(async () => state.DEFAULT_META),
      saveAppState: vi.fn(async () => undefined),
      readTextFile: (...args: unknown[]) => readTextFileMock(...args),
      writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
      statPath: vi.fn(async () => ({ exists: true, isFile: true, mtime: 1, size: 0 })),
      createTextFile: vi.fn(async () => undefined),
      renameFile: vi.fn(),
      revealInFinder: vi.fn(),
      openExternal: vi.fn(),
      getDocumentsDir: vi.fn(async () => "/tmp/docs"),
    },
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: (...args: unknown[]) => saveDialogMock(...args),
  ask: (...args: unknown[]) => askDialogMock(...args),
}));

import { DEFAULT_META, type FileKind } from "../../types/state";
import { defaultNameFor } from "../../lib/path";
import { useMetaStore } from "../metaStore";
import { flushAllDirty, useTabsStore, type Tab } from "../tabsStore";

function fileInfo(path: string, content: string, mtime = 1000) {
  const kind: FileKind = path.endsWith(".sql") ? "sql" : path.endsWith(".txt") ? "txt" : "md";
  return { content, encoding: "UTF-8", hasBom: false, mtime, size: content.length, kind };
}

function activeTab(): Tab | undefined {
  const s = useTabsStore.getState();
  return s.tabs.find((t) => t.id === s.activeId);
}

describe("tabsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMetaStore.setState({ hydrated: true, meta: structuredClone(DEFAULT_META) });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("openPath 读取真实文件并进入最近列表", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "# hello"));
    const ok = await useTabsStore.getState().openPath("/a.md");
    expect(ok).toBe(true);
    const tab = activeTab();
    expect(tab?.title).toBe("a.md");
    expect(tab?.kind).toBe("md");
    expect(tab?.dirty).toBe(false);
    expect(useMetaStore.getState().meta.recents[0]?.path).toBe("/a.md");
  });

  it("重复打开同一文件只激活已有标签页", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "# hello"));
    await useTabsStore.getState().openPath("/a.md");
    await useTabsStore.getState().openPath("/a.md");
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("updateContent 置脏", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old"));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "new");
    expect(activeTab()?.dirty).toBe(true);
    expect(activeTab()?.content).toBe("new");
  });

  it("保存成功清除脏标记并更新 mtime", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old", 1000));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "saved content");
    writeTextFileMock.mockResolvedValue({ mtime: 2000 });
    const ok = await useTabsStore.getState().save(id);
    expect(ok).toBe(true);
    const tab = activeTab()!;
    expect(tab.dirty).toBe(false);
    expect(tab.mtime).toBe(2000);
    expect(tab.conflict).toBeNull();
    // 传入 mtime 快照做冲突检测
    expect(writeTextFileMock.mock.calls[0][0]).toMatchObject({
      path: "/a.md",
      content: "saved content",
      expectedMtime: 1000,
    });
  });

  it("外部修改冲突：置 conflict 且不清脏，不静默覆盖", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "local edit", 1000));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "local edit v2");
    writeTextFileMock.mockRejectedValue(JSON.stringify({ kind: "external-change", currentMtime: 9999 }));
    const ok = await useTabsStore.getState().save(id);
    expect(ok).toBe(false);
    const tab = activeTab()!;
    expect(tab.conflict).toBe("external-change");
    expect(tab.dirty).toBe(true);
  });

  it("切换标签页不写盘（手动保存策略），内容保留在内存", async () => {
    readTextFileMock
      .mockResolvedValueOnce(fileInfo("/a.md", "A", 1000))
      .mockResolvedValueOnce(fileInfo("/b.md", "B", 1000));
    const s = useTabsStore.getState();
    await s.openPath("/a.md");
    const aId = activeTab()!.id;
    s.updateContent(aId, "A2");
    await s.openPath("/b.md");
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(activeTab()?.path).toBe("/b.md");
    // 切回 a：未保存内容仍在
    await s.setActive(useTabsStore.getState().tabs.find((t) => t.path === "/a.md")!.id);
    expect(activeTab()?.content).toBe("A2");
  });

  it("关闭脏标签页先保存；保存失败保留标签页", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "A", 1000));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "A2");
    writeTextFileMock.mockRejectedValue(JSON.stringify({ kind: "external-change", currentMtime: 5 }));
    await useTabsStore.getState().closeTab(id);
    // 冲突未解决：标签页仍在
    expect(useTabsStore.getState().tabs).toHaveLength(1);

    writeTextFileMock.mockResolvedValue({ mtime: 3000 });
    await useTabsStore.getState().closeTab(id);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("saveAs 换路径保存（expectedMtime 为 null，不触发冲突）", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "content", 1000));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    saveDialogMock.mockResolvedValue("/new/b.md");
    writeTextFileMock.mockResolvedValue({ mtime: 4000 });
    await useTabsStore.getState().saveAs(id);
    expect(writeTextFileMock.mock.calls[0][0]).toMatchObject({ path: "/new/b.md", expectedMtime: null });
    const tab = activeTab()!;
    expect(tab.path).toBe("/new/b.md");
    expect(tab.title).toBe("b.md");
    expect(useMetaStore.getState().meta.recents[0]?.path).toBe("/new/b.md");
  });

  it("restoreSession 恢复标签页并跳过失效文件", async () => {
    useMetaStore.setState({
      hydrated: true,
      meta: {
        ...structuredClone(DEFAULT_META),
        prefs: { ...DEFAULT_META.prefs, restoreSession: true },
        session: {
          tabs: [
            { path: "/live.md", kind: "md", cursor: 3, scrollTop: 40, sourceMode: false },
            { path: "/gone.md", kind: "md", cursor: 0, scrollTop: 0, sourceMode: false },
          ],
          active: 0,
        },
      },
    });
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path === "/gone.md") throw JSON.stringify({ kind: "not-found", path });
      return fileInfo(path, "content", 1000);
    });
    await useTabsStore.getState().restoreSession();
    const s = useTabsStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["/live.md"]);
    expect(s.activeId).toBe(s.tabs[0]?.id ?? null);
    expect(s.tabs[0]?.scrollTop).toBe(40);
  });
});

/**
 * 新建文件流程（用户决策 2026-11-08）：⌘N 直接开未命名草稿，
 * 首次 ⌘S 才选择保存位置；临时记录可随手丢弃（关闭时一次确认）。
 */
describe("新建草稿流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askDialogMock.mockResolvedValue(false);
    useMetaStore.setState({ hydrated: true, meta: structuredClone(DEFAULT_META) });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("newFile 直接开草稿：不弹保存对话框、不落盘、不进最近列表", async () => {
    await useTabsStore.getState().newFile("md");
    const tab = activeTab();
    expect(tab?.path).toBeNull();
    expect(tab?.title).toBe(defaultNameFor("md"));
    expect(tab?.dirty).toBe(false);
    expect(saveDialogMock).not.toHaveBeenCalled();
    expect(useMetaStore.getState().meta.recents).toHaveLength(0);
  });

  it("同屏多个草稿自动编号（Untitled.md / Untitled 2.md）", async () => {
    await useTabsStore.getState().newFile("md");
    await useTabsStore.getState().newFile("md");
    expect(useTabsStore.getState().tabs.map((t) => t.title)).toEqual([
      defaultNameFor("md"),
      defaultNameFor("md").replace(".md", " 2.md"),
    ]);
  });

  it("草稿首次 ⌘S：选择位置 → 写盘 → 变普通文件并记入最近", async () => {
    await useTabsStore.getState().newFile("md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "# draft");
    saveDialogMock.mockResolvedValue("/saved/draft1.md");
    writeTextFileMock.mockResolvedValue({ mtime: 5000 });

    const ok = await useTabsStore.getState().save(id);
    expect(ok).toBe(true);
    expect(saveDialogMock).toHaveBeenCalledTimes(1);
    // 默认保存位置：文稿目录 + 当前草稿名
    expect(saveDialogMock.mock.calls[0][0]).toMatchObject({
      defaultPath: `/tmp/docs/${defaultNameFor("md")}`,
    });
    expect(writeTextFileMock.mock.calls[0][0]).toMatchObject({
      path: "/saved/draft1.md",
      content: "# draft",
    });
    const tab = activeTab()!;
    expect(tab.path).toBe("/saved/draft1.md");
    expect(tab.title).toBe("draft1.md");
    expect(tab.dirty).toBe(false);
    expect(useMetaStore.getState().meta.recents[0]?.path).toBe("/saved/draft1.md");
  });

  it("草稿 ⌘S 取消对话框：仍是草稿，内容与脏标记保留", async () => {
    await useTabsStore.getState().newFile("md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "keep me");
    saveDialogMock.mockResolvedValue(null);

    const ok = await useTabsStore.getState().save(id);
    expect(ok).toBe(false);
    const tab = activeTab()!;
    expect(tab.path).toBeNull();
    expect(tab.dirty).toBe(true);
    expect(tab.content).toBe("keep me");
  });

  it("关闭脏草稿：确认丢弃后关闭；取消则保留（不写盘）", async () => {
    await useTabsStore.getState().newFile("md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "temp note");

    // 取消丢弃 → 标签页保留
    await useTabsStore.getState().closeTab(id);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(writeTextFileMock).not.toHaveBeenCalled();

    // 确认丢弃 → 关闭且不落盘
    askDialogMock.mockResolvedValue(true);
    await useTabsStore.getState().closeTab(id);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it("空白草稿关闭无需确认（随手丢弃临时记录）", async () => {
    await useTabsStore.getState().newFile("md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "   ");
    await useTabsStore.getState().closeTab(id);
    expect(askDialogMock).not.toHaveBeenCalled();
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("flushAllDirty 跳过草稿（退出不弹对话框、不写盘）", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "A"));
    await useTabsStore.getState().openPath("/a.md");
    await useTabsStore.getState().newFile("md");
    const draftId = activeTab()!.id;
    useTabsStore.getState().updateContent(draftId, "draft!");
    const savedId = useTabsStore.getState().tabs.find((t) => t.path === "/a.md")!.id;
    useTabsStore.getState().updateContent(savedId, "saved file!");
    writeTextFileMock.mockResolvedValue({ mtime: 6000 });

    await flushAllDirty();
    // 只有普通文件写盘；草稿保持脏状态由退出确认流程处置
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock.mock.calls[0][0].path).toBe("/a.md");
    expect(useTabsStore.getState().tabs.find((t) => t.id === draftId)?.dirty).toBe(true);
  });

  it("会话持久化排除草稿（正文不入元数据）", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "A"));
    await useTabsStore.getState().openPath("/a.md");
    await useTabsStore.getState().newFile("md");
    expect(useMetaStore.getState().meta.session.tabs.map((x) => x.path)).toEqual(["/a.md"]);
  });
});
