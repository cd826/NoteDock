/** 与 src-tauri/src/state.rs 的 AppMeta 对应（serde camelCase）。 */

export type FileKind = "md" | "txt" | "sql";

export type ThemeMode = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemeMode;
  /** 新建文件的默认保存目录，空串表示未设置（回退 ~/Documents）。 */
  defaultSaveDir: string;
  sidebarWidth: number;
  sidebarHidden: boolean;
  recentLimit: number;
  restoreSession: boolean;
}

export interface PinnedEntry {
  path: string;
  addedAt: number;
}

export interface RecentEntry {
  path: string;
  lastOpenedAt: number;
}

export interface TabSessionEntry {
  path: string;
  kind: FileKind;
  cursor: number;
  scrollTop: number;
  sourceMode: boolean;
}

export interface Session {
  tabs: TabSessionEntry[];
  /** 活动标签下标，-1 表示无。 */
  active: number;
}

export interface AppMeta {
  version: number;
  prefs: Prefs;
  pinned: PinnedEntry[];
  recents: RecentEntry[];
  session: Session;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "system",
  defaultSaveDir: "",
  sidebarWidth: 240,
  sidebarHidden: false,
  recentLimit: 15,
  restoreSession: true,
};

export const DEFAULT_META: AppMeta = {
  version: 1,
  prefs: DEFAULT_PREFS,
  pinned: [],
  recents: [],
  session: { tabs: [], active: -1 },
};
