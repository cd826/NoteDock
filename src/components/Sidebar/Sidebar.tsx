import { useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  File as FileIcon,
  FilePlus2,
  FileText,
  FolderOpen,
  PanelLeftClose,
  Pin,
  PinOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { dispatchMenuAction, MenuIds } from "../../lib/menuActions";
import { basename } from "../../lib/path";
import { useMetaStore } from "../../stores/metaStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useUiStore } from "../../lib/toast";

function kindIcon(kind: string): LucideIcon {
  if (kind === "md") return FileText;
  if (kind === "sql") return Database;
  return FileIcon;
}

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

interface FileItemProps {
  /** 显示名：文件为 basename，草稿为抽取的标题。 */
  name: string;
  icon: LucideIcon;
  missing?: boolean;
  /** 是否为当前打开的文件（选中态与条目标识绑定，不依赖列表索引）。 */
  active: boolean;
  onOpen: () => void;
  /** 固定文件的操作：取消固定；最近文件的操作：固定 + 移除。 */
  actions?: React.ReactNode;
  draggableIndex?: number;
  onDragStartIndex?: (index: number) => void;
  onDropAtIndex?: (index: number) => void;
}

function FileItem({ name, icon: Icon, missing = false, active, onOpen, actions, draggableIndex, onDragStartIndex, onDropAtIndex }: FileItemProps) {
  const [dragOver, setDragOver] = useState(false);
  const selected = active && !missing;
  return (
    <div
      title={missing ? `${name}\n${t("missingText")}` : name}
      draggable={draggableIndex !== undefined}
      onDragStart={(e) => {
        if (draggableIndex !== undefined && onDragStartIndex !== undefined) {
          e.dataTransfer.effectAllowed = "move";
          onDragStartIndex(draggableIndex);
        }
      }}
      onDragOver={(e) => {
        if (draggableIndex === undefined) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDropAtIndex?.(draggableIndex ?? 0);
      }}
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={[
        "group flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 text-[13px] leading-none transition-colors",
        missing
          ? "text-neutral-300 dark:text-neutral-600"
          : selected
            ? // macOS 风格选中态：轻量中性底色，编辑器获得焦点后仍保持提示
              "bg-neutral-200/90 text-neutral-900 dark:bg-neutral-700/60 dark:text-neutral-100"
            : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-700/50",
        dragOver ? "bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400" : "",
      ].join(" ")}
    >
      <Icon
        size={13}
        strokeWidth={1.6}
        className="shrink-0 text-neutral-400 dark:text-neutral-500"
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {actions}
      </span>
    </div>
  );
}

function ItemActionButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-700 dark:hover:bg-neutral-600/60 dark:hover:text-neutral-200"
    >
      <Icon size={11} strokeWidth={2} />
    </button>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}

function Section({ title, children, headerAction }: SectionProps) {
  return (
    <section className="mt-5">
      <div className="flex items-center justify-between pr-1">
        <h2 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-neutral-400 dark:text-neutral-500">
          {title}
        </h2>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-2 py-2 text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">{text}</p>;
}

/**
 * 左侧导航栏：固定文件（可拖拽排序）+ 最近编辑（固定优先、去重、上限）。
 * 需求 §4.1 / §5.2。侧边栏切换处理器在 AppShell 注册（本组件隐藏时会被卸载）。
 */
export default function Sidebar({ width }: { width: number }) {
  const pinned = useMetaStore((s) => s.meta.pinned);
  const recents = useMetaStore((s) => s.meta.recents);
  const recentLimit = useMetaStore((s) => s.meta.prefs.recentLimit);
  const missingPaths = useUiStore((s) => s.missingPaths);
  const openPath = useTabsStore((s) => s.openPath);
  const setActive = useTabsStore((s) => s.setActive);
  // 选择器必须返回稳定引用：数组过滤放 useMemo（不稳定引用会触发
  // useSyncExternalStore 无限重渲染 → 黑屏，zustand v5 硬约束）
  const tabs = useTabsStore((s) => s.tabs);
  const drafts = useMemo(() => tabs.filter((t) => t.path === null), [tabs]);
  // 当前打开文件的路径与活动标签（派生原始值：仅变化时触发重渲染）
  const activeTabPath = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return tab?.path ?? null;
  });
  const activeTabId = useTabsStore((s) => s.activeId);
  const [expanded, setExpanded] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const focusTickRef = useRef(0);
  const [focusTick, setFocusTick] = useState(0);

  // 窗口获得焦点时刷新失效状态（文件可能在外部被移动/删除）
  useEffect(() => {
    const onFocus = () => setFocusTick(++focusTickRef.current);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // 探测固定/最近文件是否仍存在 → 失效态（需求 §5.2.7）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all = [...pinned.map((p) => p.path), ...recents.map((r) => r.path)];
      const missing: string[] = [];
      for (const p of all) {
        const info = await ipc.statPath(p);
        if (!info.exists) missing.push(p);
      }
      if (!cancelled) useUiStore.getState().setMissing(missing);
    })();
    return () => {
      cancelled = true;
    };
  }, [pinned, recents, focusTick]);

  const visibleRecents = expanded ? recents : recents.slice(0, recentLimit);

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/80 dark:border-neutral-700/70 dark:bg-[#232326]"
    >
      {/* 红绿灯拖拽区（titleBarStyle: Overlay） */}
      <div data-tauri-drag-region className="h-12 shrink-0" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <Section title={t("pinnedFiles")}>
          {pinned.length === 0 ? (
            <EmptyHint text={t("emptyPinned")} />
          ) : (
            <div className="flex flex-col gap-0.5">
              {pinned.map((entry, index) => (
                <FileItem
                  key={entry.path}
                  name={basename(entry.path)}
                  icon={kindIcon(entry.path.split(".").pop()?.toLowerCase() ?? "")}
                  missing={!!missingPaths[entry.path]}
                  active={activeTabPath === entry.path}
                  onOpen={() => void openPath(entry.path)}
                  draggableIndex={index}
                  onDragStartIndex={setDragIndex}
                  onDropAtIndex={(target) => {
                    if (dragIndex !== null) {
                      useMetaStore.getState().reorderPinned(dragIndex, target);
                      setDragIndex(null);
                    }
                  }}
                  actions={
                    <ItemActionButton
                      icon={PinOff}
                      label={t("unpinAction")}
                      onClick={() => useMetaStore.getState().unpinPath(entry.path)}
                    />
                  }
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title={t("recentFiles")}
          headerAction={
            recents.length > 0 ? (
              <button
                type="button"
                title={t("clearRecent")}
                onClick={() => useMetaStore.getState().clearRecents()}
                className="pb-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                {t("clearRecent")}
              </button>
            ) : null
          }
        >
          {/* 未落盘草稿：显示首行抽取的标题，点击切回标签页（会话态，不入持久化列表） */}
          {drafts.length > 0 && (
            <div className={recents.length > 0 ? "mb-1.5 flex flex-col gap-0.5" : "flex flex-col gap-0.5"}>
              {drafts.map((draft) => (
                <FileItem
                  key={draft.id}
                  name={draft.title}
                  icon={kindIcon(draft.kind)}
                  active={activeTabId === draft.id}
                  onOpen={() => void setActive(draft.id)}
                />
              ))}
            </div>
          )}
          {recents.length === 0 && drafts.length === 0 ? (
            <EmptyHint text={t("emptyRecent")} />
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                {visibleRecents.map((entry) => (
                  <FileItem
                    key={entry.path}
                    name={basename(entry.path)}
                    icon={kindIcon(entry.path.split(".").pop()?.toLowerCase() ?? "")}
                    missing={!!missingPaths[entry.path]}
                    active={activeTabPath === entry.path}
                    onOpen={() => void openPath(entry.path)}
                    actions={
                      <>
                        <ItemActionButton
                          icon={Pin}
                          label={t("pinAction")}
                          onClick={() => useMetaStore.getState().pinPath(entry.path)}
                        />
                        <ItemActionButton
                          icon={X}
                          label={t("removeRecentAction")}
                          onClick={() => useMetaStore.getState().removeRecent(entry.path)}
                        />
                      </>
                    }
                  />
                ))}
              </div>
              {recents.length > recentLimit && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 px-2 py-1 text-[11px] text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  {expanded ? t("showLess") : t("showMore")}
                </button>
              )}
            </>
          )}
        </Section>
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
