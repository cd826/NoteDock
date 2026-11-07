import zh, { type I18nKey } from "./zh";
import en from "./en";

/**
 * 轻量 i18n：语言在启动时跟随系统确定（需求：无账号、轻量，不提供切换设置）。
 * 菜单栏语言在 Rust 侧按同样的规则独立检测（menu.rs::is_zh）。
 */
const dicts = { zh, en } as const;

const current: keyof typeof dicts = navigator.language.toLowerCase().startsWith("zh")
  ? "zh"
  : "en";

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  let text: string = dicts[current][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}
