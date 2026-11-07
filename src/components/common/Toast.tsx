import { useUiStore } from "../../lib/toast";

/** 底部轻量提示条（保存失败/文件失效等，需求 §8.5）。 */
export default function Toast() {
  const toast = useUiStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="rounded-full border border-neutral-200/80 bg-white/95 px-4 py-1.5 text-[13px] text-neutral-700 shadow-md backdrop-blur dark:border-neutral-600/70 dark:bg-[#2a2a2d]/95 dark:text-neutral-200">
        {toast.message}
      </div>
    </div>
  );
}
