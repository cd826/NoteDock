import { useEffect, useMemo, useRef, useState } from "react";
import { FileCode, FileText, Search } from "lucide-react";
import { t } from "../../i18n";
import { fuzzyMatch } from "../../lib/fuzzy";
import { ipc, type SearchMatch } from "../../lib/ipc";
import { basename, dirname } from "../../lib/path";
import { useUiStore } from "../../lib/toast";
import { useMetaStore } from "../../stores/metaStore";
import { useTabsStore } from "../../stores/tabsStore";

/** 候选条目（文件 / 内容匹配），统一键盘导航。 */
interface PaletteEntry {
  key: string;
  path: string;
  /** 内容匹配时的高亮行 */
  match?: SearchMatch;
}

function kindIconCls(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "sql") return "text-sky-400";
  if (ext === "md" || ext === "markdown") return "text-neutral-300";
  return "text-neutral-400";
}

function FileGlyph({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase();
  const Icon = ext === "sql" ? FileCode : FileText;
  return <Icon size={14} strokeWidth={1.6} className={`mt-0.5 shrink-0 ${kindIconCls(path)}`} />;
}

function highlight(text: string, query: string) {
  const idx = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-amber-200/70 text-neutral-900 dark:bg-amber-400/40 dark:text-amber-100">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

/**
 * 搜索面板（需求 §5.4，Phase 6）：
 * - ⌘P 快速打开：固定 + 最近文件名模糊匹配；
 * - ⌘⇧F 全局搜索：文件名/路径 + 正文内容（Rust 搜索，范围仅固定+最近）；
 * 键盘：↑↓ 选择、Enter 打开（内容匹配定位到行）、Esc 关闭。
 */
export default function SearchPalette() {
  const mode = useUiStore((s) => s.palette);
  const closePalette = useUiStore((s) => s.closePalette);
  const missingPaths = useUiStore((s) => s.missingPaths);
  const pinned = useMetaStore((s) => s.meta.pinned);
  const recents = useMetaStore((s) => s.meta.recents);
  const openPath = useTabsStore((s) => s.openPath);

  const [query, setQuery] = useState("");
  const [contentResults, setContentResults] = useState<import("../../lib/ipc").FileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isGlobal = mode === "global";

  useEffect(() => {
    if (mode) {
      setQuery("");
      setContentResults([]);
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [mode]);

  // 候选：固定 ∪ 最近（去重、剔除失效）
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return [...pinned.map((p) => p.path), ...recents.map((r) => r.path)].filter((p) => {
      if (seen.has(p) || missingPaths[p]) return false;
      seen.add(p);
      return true;
    });
  }, [pinned, recents, missingPaths]);

  // 快速打开：文件名模糊排序
  const quickEntries = useMemo<PaletteEntry[]>(() => {
    if (isGlobal) return [];
    const q = query.trim();
    const scored = candidates.map((path) => {
      const r = q ? fuzzyMatch(basename(path), q) ?? fuzzyMatch(path, q) : { score: 0 };
      return { path, score: r?.score ?? Infinity };
    });
    return scored
      .filter((x) => x.score !== Infinity)
      .sort((a, b) => a.score - b.score)
      .map((x) => ({ key: x.path, path: x.path }));
  }, [isGlobal, candidates, query]);

  // 全局搜索：文件名匹配 + 内容搜索（防抖 250ms）
  const nameMatches = useMemo<PaletteEntry[]>(() => {
    if (!isGlobal) return [];
    const q = query.trim();
    if (!q) return [];
    return candidates
      .filter((p) => fuzzyMatch(basename(p), q) !== null || fuzzyMatch(p, q) !== null)
      .slice(0, 8)
      .map((path) => ({ key: `n:${path}`, path }));
  }, [isGlobal, candidates, query]);

  useEffect(() => {
    if (!isGlobal) return;
    const q = query.trim();
    if (!q) {
      setContentResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void ipc
        .searchInFiles(candidates, q)
        .then((res) => {
          setContentResults(res);
          setSearching(false);
        })
        .catch(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [isGlobal, candidates, query]);

  const entries = useMemo<PaletteEntry[]>(() => {
    if (!isGlobal) return quickEntries;
    const content: PaletteEntry[] = [];
    for (const file of contentResults) {
      for (const m of file.matches) {
        content.push({ key: `c:${file.path}:${m.line}:${m.offset}`, path: file.path, match: m });
      }
    }
    const nameKeys = new Set(nameMatches.map((e) => e.key));
    return [...nameMatches, ...content.filter((e) => !nameKeys.has(`n:${e.path}`))];
  }, [isGlobal, quickEntries, nameMatches, contentResults]);

  useEffect(() => {
    setActive(0);
  }, [query, mode]);

  const open = (entry: PaletteEntry) => {
    closePalette();
    void openPath(entry.path, entry.match ? { cursor: entry.match.offset } : undefined);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[active];
      if (entry) open(entry);
    }
  };

  // 活动项滚动到可见（hooks 必须在早退之前调用）
  useEffect(() => {
    if (!mode) return;
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, mode]);

  if (!mode) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/20"
      onClick={closePalette}
      onKeyDown={onKeyDown}
    >
      <div
        className="mx-auto mt-[12vh] w-[600px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-[#252528]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-200/80 px-3.5 py-2.5 dark:border-neutral-700/70">
          <Search size={15} className="shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isGlobal ? t("globalSearchPlaceholder") : t("quickOpenPlaceholder")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100"
          />
          {isGlobal && searching && (
            <span className="shrink-0 text-[11px] text-neutral-400">{t("searching")}</span>
          )}
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-neutral-400">
              {isGlobal && searching ? t("searching") : t("searchNoResults")}
            </div>
          ) : (
            entries.map((entry, idx) => {
              const name = basename(entry.path);
              const dir = dirname(entry.path);
              return (
                <div
                  key={entry.key}
                  data-idx={idx}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => open(entry)}
                  className={[
                    "flex cursor-default items-start gap-2.5 px-3.5 py-1.5",
                    idx === active ? "bg-blue-500/90 text-white" : "text-neutral-700 dark:text-neutral-300",
                  ].join(" ")}
                >
                  <FileGlyph path={entry.path} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium">{name}</span>
                      <span className={["truncate text-[11px]", idx === active ? "text-blue-100" : "text-neutral-400 dark:text-neutral-500"].join(" ")}>
                        {dir}
                      </span>
                    </div>
                    {entry.match && (
                      <div className={["mt-0.5 truncate font-mono text-[12px]", idx === active ? "text-blue-50" : "text-neutral-500 dark:text-neutral-400"].join(" ")}>
                        {highlight(entry.match.text, query.trim())}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-neutral-200/80 px-3.5 py-1.5 text-[11px] text-neutral-400 dark:border-neutral-700/70">
          <span>↑↓ 选择</span>
          <span>↩ 打开</span>
          <span>Esc 关闭</span>
          <span className="flex-1" />
          <span>{isGlobal ? "⌘⇧F 全局搜索" : "⌘P 快速打开"}</span>
        </div>
      </div>
    </div>
  );
}
