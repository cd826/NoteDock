import { useEffect } from "react";
import { FilePlus2, FolderOpen, PanelLeftClose, type LucideIcon } from "lucide-react";
import { t } from "../../i18n";
import { dispatchMenuAction, MenuIds, registerMenuAction } from "../../lib/menuActions";
import { useMetaStore } from "../../stores/metaStore";

/** 侧边栏底部操作按钮（需求 §4.1：打开文件 / 新建 Markdown / 隐藏侧边栏）。 */
function SidebarButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700/60 dark:hover:text-neutral-100"
    >
      <Icon size={15} strokeWidth={1.8} />
    </button>
  );
}

function FileSection({ title, empty }: { title: string; empty: string }) {
  return (
    <section className="mt-5">
      <h2 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500">
        {title}
      </h2>
      <p className="px-2 py-2 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">{empty}</p>
    </section>
  );
}

/**
 * 左侧导航栏：固定文件 + 最近编辑（Dock 式快速访问）。
 * 列表内容与固定/排序逻辑在 Phase 2 接入。
 */
export default function Sidebar({ width }: { width: number }) {
  // 菜单/快捷键：隐藏或恢复侧边栏（⌘⌥S）
  useEffect(
    () =>
      registerMenuAction(MenuIds.toggleSidebar, () => {
        const s = useMetaStore.getState();
        s.setPrefs({ sidebarHidden: !s.meta.prefs.sidebarHidden });
      }),
    [],
  );

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/80 dark:border-neutral-700/70 dark:bg-[#232326]"
    >
      {/* 红绿灯拖拽区（titleBarStyle: Overlay） */}
      <div data-tauri-drag-region className="h-12 shrink-0" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <FileSection title={t("pinnedFiles")} empty={t("emptyPinned")} />
        <FileSection title={t("recentFiles")} empty={t("emptyRecent")} />
      </div>

      <footer className="flex h-11 shrink-0 items-center gap-0.5 border-t border-neutral-200/80 px-2 dark:border-neutral-700/60">
        <SidebarButton icon={FolderOpen} label={t("openFile")} onClick={() => dispatchMenuAction(MenuIds.openFile)} />
        <SidebarButton icon={FilePlus2} label={t("newMarkdown")} onClick={() => dispatchMenuAction(MenuIds.newMd)} />
        <span className="flex-1" />
        <SidebarButton
          icon={PanelLeftClose}
          label={t("hideSidebar")}
          onClick={() => dispatchMenuAction(MenuIds.toggleSidebar)}
        />
      </footer>
    </aside>
  );
}
