import { PanelLeftOpen } from "lucide-react";
import { t } from "../../i18n";
import { dispatchMenuAction, MenuIds } from "../../lib/menuActions";
import { useMetaStore } from "../../stores/metaStore";
import EditorPane from "./EditorPane";

/**
 * 右侧编辑区外壳：标题栏拖拽区 + 编辑主面板（标签页/横幅/内容）。
 * 侧边栏隐藏时，底部提供恢复按钮（与侧边栏底部按钮位置对应）。
 */
export default function EditorArea() {
  const sidebarHidden = useMetaStore((s) => s.meta.prefs.sidebarHidden);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#1e1e1e]">
      {/* 标题栏拖拽区（Overlay 标题栏） */}
      <div data-tauri-drag-region className="h-12 shrink-0" />
      <EditorPane />
      {sidebarHidden && (
        <footer className="flex h-11 shrink-0 items-center border-t border-neutral-200/80 px-2 dark:border-neutral-700/60">
          <button
            type="button"
            title={t("showSidebar")}
            aria-label={t("showSidebar")}
            onClick={() => dispatchMenuAction(MenuIds.toggleSidebar)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-100"
          >
            <PanelLeftOpen size={15} strokeWidth={1.8} />
          </button>
        </footer>
      )}
    </main>
  );
}
