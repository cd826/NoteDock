import { WidgetType } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import "katex/dist/katex.min.css";

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const COPY_OK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/** 任务列表交互式 checkbox：点击写回源文本（[ ] ↔ [x]）。 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("button");
    box.type = "button";
    box.className = "cm-task-checkbox" + (this.checked ? " checked" : "");
    box.setAttribute("aria-checked", String(this.checked));
    box.setAttribute("role", "checkbox");
    if (this.checked) box.innerHTML = CHECK_ICON;
    box.addEventListener("mousedown", (e) => e.preventDefault()); // 防止编辑器失焦/光标移动
    box.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 点击时以当前文档为准重新定位 [ ] / [x]（装饰构建后文档可能已变化）
      const line = view.state.doc.lineAt(this.pos);
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text);
      if (!m) return;
      const markPos = line.from + m[1].length;
      if (view.state.sliceDoc(markPos, markPos + 1) !== m[2]) return;
      view.dispatch({
        changes: { from: markPos, to: markPos + 1, insert: m[2] === " " ? "x" : " " },
      });
    });
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** 水平分割线（隐藏 `---` 源码后展示）。 */
export class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-hr";
    return hr;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** 本地图片经 asset 协议加载；远程图片直连。 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-image-wrap";
    const img = document.createElement("img");
    img.className = "cm-image";
    img.alt = this.alt;
    img.onload = () => wrap.classList.add("loaded");
    img.onerror = () => {
      // 加载失败回退为链接样式的占位文本，不阻塞编辑
      wrap.classList.add("failed");
      wrap.textContent = `🖼 ${this.alt || this.url}`;
    };
    if (/^https?:\/\//.test(this.url)) {
      img.src = this.url;
    } else {
      void (async () => {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        img.src = convertFileSrc(this.url);
      })();
    }
    wrap.appendChild(img);
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** 代码块右上角复制按钮。 */
export class CopyButtonWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  override eq(other: CopyButtonWidget): boolean {
    return other.code === this.code;
  }

  override toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-code-copy";
    btn.title = "复制代码";
    btn.innerHTML = COPY_ICON;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard
        .writeText(this.code)
        .then(() => {
          btn.innerHTML = COPY_OK;
          btn.classList.add("done");
          setTimeout(() => {
            btn.innerHTML = COPY_ICON;
            btn.classList.remove("done");
          }, 1200);
        })
        .catch(() => {});
    });
    return btn;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** KaTeX 数学公式（懒加载 KaTeX，失败时回退显示原文）。 */
export class MathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly display: boolean,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return other.latex === this.latex && other.display === this.display;
  }

  override toDOM(): HTMLElement {
    const span = document.createElement(this.display ? "div" : "span");
    span.className = this.display ? "cm-math-block" : "cm-math-inline";
    span.textContent = this.display ? this.latex : `$${this.latex}$`;
    void (async () => {
      try {
        const katex = await import("katex");
        span.innerHTML = katex.renderToString(this.latex, {
          displayMode: this.display,
          throwOnError: false,
          output: "html",
        });
      } catch {
        // 保持原文
      }
    })();
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** Mermaid 图表（懒加载 mermaid，按内容缓存渲染结果）。 */
const mermaidCache = new Map<string, string>();
let mermaidSeq = 0;

export class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }

  override eq(other: MermaidWidget): boolean {
    return other.code === this.code;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-mermaid";
    wrap.textContent = "⏳ 渲染图表…";
    void (async () => {
      const cached = mermaidCache.get(this.code);
      if (cached) {
        wrap.innerHTML = cached;
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "neutral",
        });
        const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, this.code);
        mermaidCache.set(this.code, svg);
        wrap.innerHTML = svg;
      } catch (err) {
        wrap.textContent = "⚠️ Mermaid 语法错误";
        wrap.classList.add("error");
        console.warn("[mermaid]", err);
      }
    })();
    return wrap;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
