import { useCallback, useEffect, useRef } from "react";
import { MenuIds, registerMenuAction } from "../../lib/menuActions";
import { useMetaStore } from "../../stores/metaStore";
import Sidebar from "../Sidebar/Sidebar";
import EditorArea from "../editor/EditorArea";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;

/** 双栏布局外壳：左侧文件快速访问侧边栏 + 右侧编辑区（需求 §4）。 */
export default function AppShell() {
  const sidebarHidden = useMetaStore((s) => s.meta.prefs.sidebarHidden);
  const sidebarWidth = useMetaStore((s) => s.meta.prefs.sidebarWidth);
  const shellRef = useRef<HTMLDivElement>(null);

  // 切换侧边栏的处理器必须注册在永不离场的组件上：
  // 若注册在 Sidebar 内部，侧边栏隐藏（组件卸载）后 ⌘⌥S 与恢复按钮都会失效。
  useEffect(
    () =>
      registerMenuAction(MenuIds.toggleSidebar, () => {
        const s = useMetaStore.getState();
        s.setPrefs({ sidebarHidden: !s.meta.prefs.sidebarHidden });
      }),
    [],
  );

  // 侧边栏拖拽调宽（需求 §8.3 支持调整侧边栏宽度）
  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = useMetaStore.getState().meta.prefs.sidebarWidth;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX));
        useMetaStore.getState().setPrefs({ sidebarWidth: width });
      };
      const onUp = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
    },
    [],
  );

  return (
    <div ref={shellRef} className="flex h-full w-full overflow-hidden bg-white text-neutral-900 dark:bg-[#1e1e1e] dark:text-neutral-200">
      {!sidebarHidden && (
        <>
          <Sidebar width={sidebarWidth} />
          {/* 分隔与拖拽把手 */}
          <div
            onPointerDown={startResize}
            className="w-px shrink-0 cursor-col-resize bg-neutral-200 transition-colors hover:bg-blue-400 dark:bg-neutral-700"
          />
        </>
      )}
      <EditorArea />
    </div>
  );
}
