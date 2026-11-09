import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import "./styles/global.css";

// 【临时诊断】全局错误上报（排查后移除）
const reportErr = (m: string) => {
  void invoke("debug_log", { message: m }).catch(() => {});
};
window.addEventListener("error", (e) => reportErr(`[error] ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => reportErr(`[rejection] ${String(e.reason)}`));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
