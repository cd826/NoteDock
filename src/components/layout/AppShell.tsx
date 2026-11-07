import { useCallback, useRef } from "react";
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
