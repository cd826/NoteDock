import { PanelLeftOpen } from "lucide-react";
import { t } from "../../i18n";
import { dispatchMenuAction, MenuIds } from "../../lib/menuActions";
import { useMetaStore } from "../../stores/metaStore";
import EditorPane from "./EditorPane";

/**
 * 右侧编辑区外壳：标题栏拖拽区 + 编辑主面板（标签页/横幅/内容）。
 */
export default function EditorArea() {
  const sidebarHidden = useMetaStore((s) => s.meta.prefs.sidebarHidden);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#1e1e1e]">
      {/* 标题栏拖拽区（Overlay 标题栏），侧边栏隐藏时提供恢复按钮 */}
      <div data-tauri-drag-region className="flex h-12 shrink-0 items-center">
        {sidebarHidden && (
          <button
            type="button"
            title={t("showSidebar")}
            aria-label={t("showSidebar")}
            onClick={() => dispatchMenuAction(MenuIds.toggleSidebar)}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-100"
          >
            <PanelLeftOpen size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <EditorPane />
    </main>
  );
}
