import { useEffect, useRef } from "react";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { t } from "../../i18n";
import { MenuIds, registerMenuAction } from "../../lib/menuActions";
import { useTabsStore, type Tab } from "../../stores/tabsStore";
import { createEditor, type EditorHandles } from "../../editor/createEditor";
import { insertLink, toggleWrap } from "../../editor/mdKeymap";
import { saveEditorState, takeEditorState } from "../../stores/tabsStore";
import TabBar from "./TabBar";

/** 冲突/缺失横幅（需求 §6.4：不静默覆盖，明确提示并提供恢复路径）。 */
function Banner({ tab }: { tab: Tab }) {
  const reloadFromDisk = useTabsStore((s) => s.reloadFromDisk);
  const save = useTabsStore((s) => s.save);
  const saveAs = useTabsStore((s) => s.saveAs);
  const closeTab = useTabsStore((s) => s.closeTab);

  const isConflict = tab.conflict === "external-change";
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="min-w-0 flex-1 truncate">{isConflict ? t("conflictText") : t("missingText")}</span>
      {isConflict ? (
        <>
          <BannerButton onClick={() => void reloadFromDisk(tab.id)} label={t("reload")} />
          <BannerButton onClick={() => void save(tab.id, { force: true })} label={t("overwrite")} />
        </>
      ) : (
        <>
          <BannerButton onClick={() => void saveAs(tab.id)} label={t("relocate")} />
          <BannerButton onClick={() => void closeTab(tab.id)} label={t("closeTabAction")} />
        </>
      )}
    </div>
  );
}

function BannerButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md border border-amber-400/50 px-2.5 py-0.5 text-[12px] font-medium transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-900/40"
    >
      {label}
    </button>
  );
}

/** 编码提示（非 UTF-8 文件，需求 §6.6.8：不静默转换）。 */
function EncodingNotice({ encoding }: { encoding: string }) {
  return (
    <div className="shrink-0 border-b border-blue-300/50 bg-blue-50 px-4 py-1.5 text-[12px] text-blue-900 dark:border-blue-500/30 dark:bg-blue-950/40 dark:text-blue-200">
      {t("encodingNotice", { encoding })}
    </div>
  );
}

/**
 * 右侧编辑区主面板（需求 §5.1：Typora 风格即时渲染，CodeMirror 6）。
 * 单一 EditorView 实例跨标签页复用；文档/光标/滚动按标签页同步。
 * 正文居中、最大宽度 800px（需求 §4.2）。
 */
export default function EditorPane() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const tab = tabs.find((x) => x.id === activeId);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<EditorHandles | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  /** 编辑器视图当前持有的文档内容（区分编辑器输入 vs 外部重载）。 */
  const lastEditorDocRef = useRef<string>("");
  /** takeEditorState 的稳定引用（避免 effect 依赖抖动）。 */
  const takeEditorStateRef = useRef(takeEditorState);

  activeTabIdRef.current = activeId;

  // —— 创建 EditorView（仅一次，随后由同步 effect 驱动）——
  useEffect(() => {
    if (!hostRef.current) return;
    const handles = createEditor({
      parent: hostRef.current,
      kind: "md",
      doc: "",
      onUpdate: ({ docChanged, doc, cursor, view }) => {
        const id = activeTabIdRef.current;
        if (!id) return;
        // 保存状态快照（含撤销历史）：切换标签页时恢复，undo 跨切换保留
        saveEditorState(id, view.state);
        if (docChanged) {
          lastEditorDocRef.current = doc;
          useTabsStore.getState().updateContent(id, doc, cursor);
        } else {
          useTabsStore.getState().setEditorState(id, { cursor });
        }
      },
    });
    handlesRef.current = handles;

    // 滚动位置记录（持久层自带防抖）
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        const id = activeTabIdRef.current;
        if (id) {
          useTabsStore.getState().setEditorState(id, { scrollTop: handles.view.scrollDOM.scrollTop });
        }
      }, 150);
    };
    handles.view.scrollDOM.addEventListener("scroll", onScroll);

    // 编辑器相关菜单动作：查找替换 / 撤销重做 / 源码模式
    const unsubs = [
      registerMenuAction(MenuIds.find, () => {
        handles.view.focus();
        openSearchPanel(handles.view);
      }),
      registerMenuAction(MenuIds.replace, () => {
        handles.view.focus();
        openSearchPanel(handles.view);
      }),
      registerMenuAction(MenuIds.undo, () => void undo(handles.view)),
      registerMenuAction(MenuIds.redo, () => void redo(handles.view)),
      registerMenuAction(MenuIds.toggleSourceMode, () => {
        const id = activeTabIdRef.current;
        if (id) useTabsStore.getState().toggleSourceMode(id);
      }),
      // 格式菜单（⌘B/⌘I/⌘K 由菜单加速键分发，此处执行编辑器命令）
      registerMenuAction(MenuIds.bold, () => {
        if (toggleWrap("**")(handles.view)) handles.view.focus();
      }),
      registerMenuAction(MenuIds.italic, () => {
        if (toggleWrap("*")(handles.view)) handles.view.focus();
      }),
      registerMenuAction(MenuIds.link, () => {
        if (insertLink(handles.view)) handles.view.focus();
      }),
    ];

    return () => {
      unsubs.forEach((un) => un());
      handles.view.scrollDOM.removeEventListener("scroll", onScroll);
      handles.view.destroy();
      handlesRef.current = null;
    };
  }, []);

  // —— 标签页切换 / 类型 / 源码模式 / 外部重载 → 同步视图 ——
  const tabId = tab?.id;
  const tabKind = tab?.kind;
  const tabSourceMode = tab?.sourceMode;
  const tabConflict = tab?.conflict;
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !tabId) return;
    const currentTab = useTabsStore.getState().tabs.find((x) => x.id === tabId);
    if (!currentTab) return;
    // 优先恢复该标签页的状态快照：undo 历史跨切换保留、各文件隔离；
    // 无快照（首次打开/磁盘重载后）才全新构建
    const saved = useTabsStore.getState().tabs.find((x) => x.id === tabId)
      ? takeEditorStateRef.current(tabId)
      : undefined;
    const savedUsable =
      saved && saved.doc.toString() === currentTab.content;
    handles.view.setState(
      savedUsable && saved
        ? saved
        : handles.makeState(
            currentTab.content,
            currentTab.kind,
            currentTab.sourceMode,
            currentTab.cursor,
          ),
    );
    lastEditorDocRef.current = currentTab.content;
    const raf = requestAnimationFrame(() => {
      handles.view.scrollDOM.scrollTop = currentTab.scrollTop;
    });
    return () => cancelAnimationFrame(raf);
  }, [tabId, tabKind, tabSourceMode, tabConflict]);

  // —— 外部内容变更（磁盘重载/冲突重新加载）→ 同步进视图 ——
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !tab) return;
    const view = handles.view;
    if (
      view.state.doc.toString() !== tab.content &&
      lastEditorDocRef.current !== tab.content
    ) {
      const len = tab.content.length;
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: tab.content },
        selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) },
      });
      lastEditorDocRef.current = tab.content;
    }
  }, [tab?.content, tab?.id]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabBar />
      {tab?.conflict && <Banner tab={tab} />}
      {tab && tab.encoding !== "UTF-8" && <EncodingNotice encoding={tab.encoding} />}
      <div className="relative flex min-h-0 flex-1 justify-center overflow-hidden">
        {/* 宿主容器始终挂载：EditorView 必须在首次渲染时就创建，
            否则打开首个文件时 handles 为空、内容无法加载 */}
        <div className={tab ? "flex min-h-0 w-full max-w-[800px] flex-col px-6" : "hidden"}>
          <div ref={hostRef} className="min-h-0 flex-1" />
        </div>
        {!tab && (
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="select-none text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-300 dark:text-neutral-600">
                {t("editorEmptyTitle")}
              </h1>
              <p className="mt-2 text-sm text-neutral-400 dark:text-neutral-500">{t("editorEmptyHint")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
