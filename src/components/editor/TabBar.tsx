import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { t } from "../../i18n";
import { useUiStore } from "../../lib/toast";
import { useMetaStore } from "../../stores/metaStore";
import { useTabsStore } from "../../stores/tabsStore";

/** ⌘S 保存成功后短暂显示"已保存"（需求 §8.5：保存状态的轻量明确反馈）。 */
function SavedFlash() {
  const savedAt = useUiStore((s) => s.savedAt);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (savedAt === 0) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  if (!visible) return null;
  return (
    <span className="pointer-events-none ml-auto flex shrink-0 items-center gap-1 pr-2 text-[11px] text-emerald-500">
      <Check size={12} strokeWidth={2.5} />
      {t("savedFlash")}
    </span>
  );
}

/**
 * 多文件标签页（需求 §4.3：点击切换、关闭、脏状态标识）。
 * 兼作 Overlay 标题栏的窗口拖拽区（标签栏空白间隙拖动窗口，原 h-12 拖拽条已并入本行）；
 * 侧边栏隐藏时左侧留出红绿灯位置。无标签页时渲染为纯拖拽条。
 */
export default function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const sidebarHidden = useMetaStore((s) => s.meta.prefs.sidebarHidden);

  return (
    <div
      data-tauri-drag-region
      className={[
        "flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-neutral-200/80 bg-neutral-50/60 dark:border-neutral-700/60 dark:bg-[#232326]",
        sidebarHidden ? "pl-20" : "px-1",
      ].join(" ")}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => void setActive(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) void closeTab(tab.id);
            }}
            className={[
              "group flex min-w-0 max-w-[180px] cursor-default items-center gap-1.5 rounded-t-md px-3",
              active
                ? "bg-white text-neutral-900 shadow-[0_-1px_0_0_inset] shadow-neutral-200 dark:bg-[#1e1e1e] dark:text-neutral-100 dark:shadow-neutral-700"
                : "text-neutral-500 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/40",
            ].join(" ")}
          >
            <span className="truncate text-[12px] leading-none">{tab.title}</span>
            {tab.dirty && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-label="未保存" />
            )}
            <button
              type="button"
              aria-label="关闭标签页"
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(tab.id);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-300/60 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-600/60 dark:hover:text-neutral-200"
            >
              <X size={11} strokeWidth={2} />
            </button>
          </div>
        );
      })}
      <SavedFlash />
    </div>
  );
}
