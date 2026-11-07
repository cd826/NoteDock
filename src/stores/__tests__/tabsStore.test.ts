import { beforeEach, describe, expect, it, vi } from "vitest";

// —— mock IPC / dialog ——
const readTextFileMock = vi.fn();
const writeTextFileMock = vi.fn();
const saveDialogMock = vi.fn();

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
}));

import { DEFAULT_META, type FileKind } from "../../types/state";
import { useMetaStore } from "../metaStore";
import { useTabsStore, type Tab } from "../tabsStore";

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

  it("切换标签页时自动保存上一个", async () => {
    readTextFileMock
      .mockResolvedValueOnce(fileInfo("/a.md", "A", 1000))
      .mockResolvedValueOnce(fileInfo("/b.md", "B", 1000));
    const s = useTabsStore.getState();
    await s.openPath("/a.md");
    const aId = activeTab()!.id;
    s.updateContent(aId, "A2");
    await s.openPath("/b.md");
    expect(writeTextFileMock).toHaveBeenCalled();
    expect(activeTab()?.path).toBe("/b.md");
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
