import { invoke } from "@tauri-apps/api/core";
import type { AppMeta } from "../types/state";

/** 类型化 Tauri IPC 封装。命令名与 Rust 侧 #[tauri::command] 一致。 */
export const ipc = {
  loadAppState: (): Promise<AppMeta> => invoke("load_app_state"),
  saveAppState: (state: AppMeta): Promise<void> =>
    invoke("save_app_state", { state }),
};
