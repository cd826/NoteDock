import { beforeEach, describe, expect, it, vi } from "vitest";

const readTextFileMock = vi.fn();
const writeTextFileMock = vi.fn();

vi.mock("../../lib/ipc", async () => {
  const state = await import("../../types/state");
  return {
    ipc: {
      loadAppState: vi.fn(async () => state.DEFAULT_META),
      saveAppState: vi.fn(async () => undefined),
      readTextFile: (...args: unknown[]) => readTextFileMock(...args),
      writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
      statPath: vi.fn(async () => ({ exists: true, isFile: true, mtime: 1, size: 0 })),
      createTextFile: vi.fn(),
      renameFile: vi.fn(),
      revealInFinder: vi.fn(),
      openExternal: vi.fn(),
      getDocumentsDir: vi.fn(async () => "/tmp/docs"),
    },
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../lib/watcher", () => ({ syncWatchedPaths: vi.fn() }));

import { DEFAULT_META } from "../../types/state";
import { flushAllDirty, useTabsStore } from "../tabsStore";
import { useMetaStore } from "../metaStore";

function fileInfo(_path: string, content: string, mtime = 1000) {
  return { content, encoding: "UTF-8", hasBom: false, mtime, size: content.length, kind: "md" as const };
}

function activeTab() {
  const s = useTabsStore.getState();
  return s.tabs.find((t) => t.id === s.activeId);
}

/**
 * 保存策略（用户决策 2026-11-08）：手动保存优先（⌘S 写盘），
 * 不做空闲自动保存、不做切标签页写盘；
 * 防丢失底线：关闭标签页 / 关闭窗口 / 退出应用前落盘。
 */
describe("保存策略：手动优先", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useMetaStore.setState({ hydrated: true, meta: structuredClone(DEFAULT_META) });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("输入后不自动写盘（等 ⌘S）", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old"));
    await useTabsStore.getState().openPath("/a.md");
    useTabsStore.getState().updateContent(activeTab()!.id, "typed content");

    await vi.advanceTimersByTimeAsync(5000);
    expect(writeTextFileMock).not.toHaveBeenCalled();
    expect(activeTab()?.dirty).toBe(true);
  });

  it("⌘S（saveActive）写盘并清除脏标记", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old"));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "manual content");
    writeTextFileMock.mockResolvedValue({ mtime: 2000 });

    await useTabsStore.getState().saveActive();
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(activeTab()?.dirty).toBe(false);
    expect(activeTab()?.mtime).toBe(2000);
  });

  it("切换标签页不写盘，未保存内容保留在内存", async () => {
    readTextFileMock
      .mockResolvedValueOnce(fileInfo("/a.md", "A"))
      .mockResolvedValueOnce(fileInfo("/b.md", "B"));
    const s = useTabsStore.getState();
    await s.openPath("/a.md");
    const aId = activeTab()!.id;
    s.updateContent(aId, "A2 unsaved");
    await s.openPath("/b.md");

    await vi.advanceTimersByTimeAsync(5000);
    expect(writeTextFileMock).not.toHaveBeenCalled();

    // 切回 a：未保存内容还在
    await s.setActive(useTabsStore.getState().tabs.find((t) => t.path === "/a.md")!.id);
    expect(activeTab()?.content).toBe("A2 unsaved");
    expect(activeTab()?.dirty).toBe(true);
  });

  it("关闭脏标签页前落盘（防丢失底线）", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "A"));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "closing content");
    writeTextFileMock.mockResolvedValue({ mtime: 4000 });

    await useTabsStore.getState().closeTab(id);
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("flushAllDirty（退出/关窗前）落盘全部脏标签页", async () => {
    readTextFileMock
      .mockResolvedValueOnce(fileInfo("/a.md", "A"))
      .mockResolvedValueOnce(fileInfo("/b.md", "B"));
    await useTabsStore.getState().openPath("/a.md");
    await useTabsStore.getState().openPath("/b.md");
    writeTextFileMock.mockResolvedValue({ mtime: 3000 });
    useTabsStore.getState().tabs.forEach((t) =>
      useTabsStore.getState().updateContent(t.id, `${t.title}!`),
    );

    await flushAllDirty();
    expect(writeTextFileMock).toHaveBeenCalledTimes(2);
    expect(useTabsStore.getState().tabs.every((t) => !t.dirty)).toBe(true);
  });
});
