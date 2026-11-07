import { beforeEach, describe, expect, it, vi } from "vitest";

// mock ipc：loadAppState 返回默认值；saveAppState 记录调用
vi.mock("../../lib/ipc", async () => {
  const state = await import("../../types/state");
  return {
    ipc: {
      loadAppState: vi.fn(async () => state.DEFAULT_META),
      saveAppState: vi.fn(async () => undefined),
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      statPath: vi.fn(async () => ({ exists: true, isFile: true, mtime: 1, size: 0 })),
      createTextFile: vi.fn(),
      renameFile: vi.fn(),
      revealInFinder: vi.fn(),
      openExternal: vi.fn(),
      getDocumentsDir: vi.fn(async () => "/tmp/docs"),
    },
  };
});

import { ipc } from "../../lib/ipc";
import { DEFAULT_META } from "../../types/state";
import { useMetaStore } from "../metaStore";

describe("metaStore pinned/recents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMetaStore.setState({ hydrated: true, meta: structuredClone(DEFAULT_META) });
  });

  it("recordOpened 置顶、去重、上限 50", () => {
    const s = useMetaStore.getState();
    s.recordOpened("/a.md");
    s.recordOpened("/b.md");
    s.recordOpened("/a.md");
    const recents = useMetaStore.getState().meta.recents;
    expect(recents.map((r) => r.path)).toEqual(["/a.md", "/b.md"]);

    for (let i = 0; i < 60; i++) s.recordOpened(`/f${i}.md`);
    const capped = useMetaStore.getState().meta.recents;
    expect(capped.length).toBe(50);
    expect(capped[0].path).toBe("/f59.md");
  });

  it("固定文件不进入最近列表（§4.1 固定优先）", () => {
    const s = useMetaStore.getState();
    s.pinPath("/p.md");
    s.recordOpened("/p.md");
    const meta = useMetaStore.getState().meta;
    expect(meta.pinned.map((p) => p.path)).toEqual(["/p.md"]);
    expect(meta.recents.map((r) => r.path)).not.toContain("/p.md");
  });

  it("pinPath 从最近列表移除；unpinPath 回到最近列表", () => {
    const s = useMetaStore.getState();
    s.recordOpened("/x.md");
    s.pinPath("/x.md");
    expect(useMetaStore.getState().meta.recents).toHaveLength(0);
    s.unpinPath("/x.md");
    const meta = useMetaStore.getState().meta;
    expect(meta.pinned).toHaveLength(0);
    expect(meta.recents.map((r) => r.path)).toEqual(["/x.md"]);
  });

  it("reorderPinned 拖拽排序", () => {
    const s = useMetaStore.getState();
    s.pinPath("/1.md");
    s.pinPath("/2.md");
    s.pinPath("/3.md");
    s.reorderPinned(0, 2); // 1.md 拖到最后
    expect(useMetaStore.getState().meta.pinned.map((p) => p.path)).toEqual(["/2.md", "/3.md", "/1.md"]);
  });

  it("clearRecents / removeRecent", () => {
    const s = useMetaStore.getState();
    s.recordOpened("/a.md");
    s.recordOpened("/b.md");
    s.removeRecent("/a.md");
    expect(useMetaStore.getState().meta.recents.map((r) => r.path)).toEqual(["/b.md"]);
    s.clearRecents();
    expect(useMetaStore.getState().meta.recents).toHaveLength(0);
  });

  it("变更经 debounce 落盘", async () => {
    vi.useFakeTimers();
    const s = useMetaStore.getState();
    s.recordOpened("/a.md");
    expect(ipc.saveAppState).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(ipc.saveAppState).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
