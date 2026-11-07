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

describe("自动保存（需求 §5.3）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useMetaStore.setState({ hydrated: true, meta: structuredClone(DEFAULT_META) });
    useTabsStore.setState({ tabs: [], activeId: null });
  });

  it("内容变更后 ~800ms 自动写盘", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old"));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "new content");
    writeTextFileMock.mockResolvedValue({ mtime: 2000 });

    expect(writeTextFileMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock.mock.calls[0][0]).toMatchObject({ content: "new content" });
    expect(activeTab()?.dirty).toBe(false);
  });

  it("连续输入只触发一次保存（防抖）", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old"));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    writeTextFileMock.mockResolvedValue({ mtime: 2000 });

    useTabsStore.getState().updateContent(id, "v1");
    await vi.advanceTimersByTimeAsync(300);
    useTabsStore.getState().updateContent(id, "v2");
    await vi.advanceTimersByTimeAsync(300);
    useTabsStore.getState().updateContent(id, "v3");
    await vi.advanceTimersByTimeAsync(900);
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(writeTextFileMock.mock.calls[0][0].content).toBe("v3");
  });

  it("冲突未解决时自动保存不重试", async () => {
    readTextFileMock.mockResolvedValue(fileInfo("/a.md", "old", 1000));
    await useTabsStore.getState().openPath("/a.md");
    const id = activeTab()!.id;
    useTabsStore.getState().updateContent(id, "local edit");
    writeTextFileMock.mockRejectedValue(JSON.stringify({ kind: "external-change", currentMtime: 9999 }));

    await vi.advanceTimersByTimeAsync(900);
    expect(activeTab()?.conflict).toBe("external-change");

    useTabsStore.getState().updateContent(id, "more edits");
    await vi.advanceTimersByTimeAsync(900);
    // 冲突期间不再尝试写盘
    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
  });

  it("flushAllDirty 立即保存全部脏标签页", async () => {
    readTextFileMock
      .mockResolvedValueOnce(fileInfo("/a.md", "A"))
      .mockResolvedValueOnce(fileInfo("/b.md", "B"));
    const s = useTabsStore.getState();
    await s.openPath("/a.md");
    await s.openPath("/b.md");
    writeTextFileMock.mockResolvedValue({ mtime: 3000 });
    useTabsStore.getState().tabs.forEach((t) =>
      useTabsStore.getState().updateContent(t.id, `${t.title}!`),
    );

    await flushAllDirty();
    expect(writeTextFileMock).toHaveBeenCalledTimes(2);
    expect(useTabsStore.getState().tabs.every((t) => !t.dirty)).toBe(true);
  });
});
