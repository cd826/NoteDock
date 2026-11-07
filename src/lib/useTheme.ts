import { useEffect, useState } from "react";
import { useMetaStore } from "../stores/metaStore";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function useSystemDark(): boolean {
  const [dark, setDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/** 深浅色解析 + 应用：system/light/dark，切换 <html> 的 dark class。 */
export function useTheme(): void {
  const theme = useMetaStore((s) => s.meta.prefs.theme);
  const systemDark = useSystemDark();
  const dark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
}
