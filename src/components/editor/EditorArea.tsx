import { PanelLeftOpen } from "lucide-react";
import { t } from "../../i18n";
import { dispatchMenuAction, MenuIds } from "../../lib/menuActions";
import { useMetaStore } from "../../stores/metaStore";

/**
 * 右侧编辑区外壳。
 * Phase 1：空态占位；Phase 2 接入标签页与文件内容；Phase 3 接入 CodeMirror。
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

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="select-none text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-300 dark:text-neutral-600">
            {t("editorEmptyTitle")}
          </h1>
          <p className="mt-2 text-sm text-neutral-400 dark:text-neutral-500">{t("editorEmptyHint")}</p>
        </div>
      </div>
    </main>
  );
}
