import React from "react";
import { invoke } from "@tauri-apps/api/core";

interface State {
  error: Error | null;
}

/**
 * 渲染层兜底（2026-11-10 黑屏事故）：任何组件崩溃时显示可操作的错误页，
 * 而不是整窗黑屏。捕获渲染期异常（含 zustand 选择器不稳定引用导致的
 * 无限重渲染）。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    void invoke("debug_log", { message: `[boundary] ${error.stack ?? error.message}` }).catch(() => {});
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-white px-8 text-center dark:bg-[#1e1e1e]">
          <p className="text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            界面出现错误 / UI error: {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-600"
          >
            重新加载界面 / Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
