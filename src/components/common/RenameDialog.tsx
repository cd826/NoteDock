import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { ipc } from "../../lib/ipc";
import { parseFsError } from "../../lib/fsError";
import { useUiStore } from "../../lib/toast";
import { useTabsStore } from "../../stores/tabsStore";

/** 重命名对话框（应用内轻量输入框，符合 §8.5 克制提示原则）。 */
export default function RenameDialog() {
  const tabId = useUiStore((s) => s.renameTargetTabId);
  const close = useUiStore((s) => s.closeRenameDialog);
  const finishRename = useTabsStore((s) => s.finishRename);
  const tab = useTabsStore((s) => s.tabs.find((x) => x.id === s.activeId));
  const target = tabId ? useTabsStore.getState().tabs.find((x) => x.id === tabId) : undefined;
  const current = target ?? tab;
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (current && tabId) {
      setName(current.title);
      // 聚焦并全选主名（不含扩展名）
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const dot = current.title.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : current.title.length);
      });
    }
  }, [tabId, current?.id]);

  if (!tabId || !current) return null;

  const confirm = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === current.title) {
      close();
      return;
    }
    try {
      const newPath = await ipc.renameFile(current.path, trimmed);
      finishRename(current.id, newPath);
      close();
    } catch (raw) {
      const err = parseFsError(raw);
      useUiStore
        .getState()
        .showToast(err.kind === "already-exists" ? "同名文件已存在" : err.kind === "io" ? err.message : "重命名失败");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[20vh]" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[320px] rounded-xl border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-700 dark:bg-[#2a2a2d]"
      >
        <h3 className="mb-3 text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">{t("renameTitle")}</h3>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirm();
            if (e.key === "Escape") close();
          }}
          className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px] text-neutral-800 outline-none focus:border-blue-400 dark:border-neutral-600 dark:bg-[#1e1e1e] dark:text-neutral-100"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-md px-3 py-1.5 text-[12px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700/50"
          >
            {t("renameCancel")}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-600"
          >
            {t("renameConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
