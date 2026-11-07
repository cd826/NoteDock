import { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { useTabsStore, type Tab } from "../../stores/tabsStore";
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
 * 右侧编辑区主面板。
 * Phase 2：textarea 直接编辑真实文件（Phase 3 换为 CodeMirror 6 即时渲染）。
 * 正文居中、最大宽度 800px（需求 §4.2）。
 */
export default function EditorPane() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const updateContent = useTabsStore((s) => s.updateContent);
  const setEditorState = useTabsStore((s) => s.setEditorState);
  const tab = tabs.find((x) => x.id === activeId);

  // 恢复会话时恢复滚动位置
  const taRef = useRef<HTMLTextAreaElement>(null);
  const restoredScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tab || !taRef.current) return;
    if (restoredScrollRef.current !== tab.id) {
      taRef.current.scrollTop = tab.scrollTop;
      restoredScrollRef.current = tab.id;
    }
  }, [tab]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabBar />
      {tab?.conflict && <Banner tab={tab} />}
      {tab && tab.encoding !== "UTF-8" && <EncodingNotice encoding={tab.encoding} />}
      {tab ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
          <div className="flex min-h-0 w-full max-w-[800px] flex-col px-6">
            <textarea
              key={tab.id}
              ref={taRef}
              value={tab.content}
              onChange={(e) => updateContent(tab.id, e.target.value)}
              onScroll={(e) => setEditorState(tab.id, { scrollTop: e.currentTarget.scrollTop })}
              spellCheck={false}
              className="mt-6 mb-8 min-h-0 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-neutral-800 outline-none dark:text-neutral-200"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="select-none text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-300 dark:text-neutral-600">
              {t("editorEmptyTitle")}
            </h1>
            <p className="mt-2 text-sm text-neutral-400 dark:text-neutral-500">{t("editorEmptyHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
