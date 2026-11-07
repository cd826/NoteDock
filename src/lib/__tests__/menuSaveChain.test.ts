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

import { dispatchMenuAction, MenuIds, registerMenuAction } from "../menuActions";
import { useUiStore } from "../toast";
import { DEFAULT_META } from "../../types/state";
import { useMetaStore } from "../../stores/metaStore";
import { useTabsStore } from "../../stores/tabsStore";

/** 复刻 useFileActions 中 save 动作的注册方式，验证完整链路。 */
describe("菜单 → 保存全链路（问题1回归测试）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMetaStore.setState({ hydrated: true, meta: structuredClone(DEFAULT_META) });
    useTabsStore.setState({ tabs: [], activeId: null });
    useUiStore.setState({ savedAt: 0 });
  });

  it("⌘S（menu-action save）→ saveActive → 脏标记清除 + 已保存反馈", async () => {
    readTextFileMock.mockResolvedValue({
      content: "A",
      encoding: "UTF-8",
      hasBom: false,
      mtime: 1000,
      size: 1,
      kind: "md",
    });
    await useTabsStore.getState().openPath("/a.md");
    const s = useTabsStore.getState();
    const tab = s.tabs.find((t) => t.id === s.activeId)!;
    s.updateContent(tab.id, "A2");
    expect(useTabsStore.getState().tabs[0]?.dirty).toBe(true);

    writeTextFileMock.mockResolvedValue({ mtime: 2000 });
    const unregister = registerMenuAction(MenuIds.save, () => {
      void useTabsStore.getState().saveActive();
    });

    dispatchMenuAction("save");

    await vi.waitFor(
      () => {
        expect(useTabsStore.getState().tabs[0]?.dirty).toBe(false);
      },
      { timeout: 2000 },
    );
    unregister();

    expect(writeTextFileMock).toHaveBeenCalledTimes(1);
    expect(useTabsStore.getState().tabs[0]?.mtime).toBe(2000);
    // 已保存反馈被触发
    expect(useUiStore.getState().savedAt).toBeGreaterThan(0);
  });

  it("无脏内容时 ⌘S 也给出已保存反馈", async () => {
    readTextFileMock.mockResolvedValue({
      content: "A",
      encoding: "UTF-8",
      hasBom: false,
      mtime: 1000,
      size: 1,
      kind: "md",
    });
    await useTabsStore.getState().openPath("/a.md");
    registerMenuAction(MenuIds.save, () => void useTabsStore.getState().saveActive());
    dispatchMenuAction("save");
    await vi.waitFor(() => {
      expect(useUiStore.getState().savedAt).toBeGreaterThan(0);
    });
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });
});
