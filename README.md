# NoteDock

轻量级 macOS Markdown / TXT / SQL 编辑器——Typora 式即时渲染 × Dock 式文件快速访问。

A lightweight macOS Markdown / TXT / SQL editor with Typora-style instant rendering and dock-style quick file access.

<!-- 截图占位：替换为应用界面截图（建议放 assets/ 目录；docs/ 不入仓库） -->

## 特性

**即时渲染编辑**

- Typora 式所见即所得：光标所在行显示 Markdown 源码，其余行即时渲染，中文输入法组合期天然安全
- GFM 全套：标题 / 粗斜体 / 删除线 / 行内代码 / 链接（⌘点击打开）/ 图片 / 列表 / 可勾选任务列表 / 表格美化 / 代码块高亮 + 一键复制
- 数学公式（KaTeX）与 Mermaid 图表
- ⌘/ 随时切换纯源码模式（撤销历史不丢失）

**草稿模式**

- ⌘N 直接开写，不弹保存面板——临时记录无需落盘
- 标题从正文首行自动抽取（标签页 / 侧栏 / 保存面板三处同步）
- 首次 ⌘S 才选择保存位置，默认文件名就是抽取的标题
- 关闭未保存草稿一次确认即丢弃，随手写随手扔

**Dock 式快速访问**

- 固定文件（可拖拽排序）+ 最近编辑，重启保留
- 草稿实时显示在「最近编辑」顶部，点击切回
- ⌘P 文件名模糊搜索、⌘⇧F 固定与最近文件的内容全文搜索

**可靠保存**

- 手动保存优先：⌘S 写盘，不做后台自动保存
- 原子写入（临时文件 + fsync + rename，保留原文件权限）
- 外部修改检测：无未保存编辑时静默重载，有编辑时给出冲突横幅——**绝不静默覆盖**
- 文件被移动 / 删除时保留内存内容并可另存为；非 UTF-8 编码自动检测并明确提示
- 大文件（>2MB）打开前提示

**macOS 原生体验**

- 标签栏并入标题栏，深浅色与界面语言跟随系统
- 多标签页 + 完整会话恢复（光标 / 滚动位置 / 源码模式）
- Finder 双击打开、拖拽文件到窗口打开、单实例（重复打开自动聚焦已有窗口）

**本地优先**

- 无账号、无云端、无数据库——正文永不入库，仅偏好与文件列表存于本地 JSON
- 升级不影响数据；元数据损坏时进入只读保护，绝不用默认值覆盖

## 快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|---|---|---|---|
| ⌘N / ⌘⇧N | 新建 Markdown / TXT 草稿 | ⌘F / ⌘⌥F | 查找 / 替换 |
| ⌘O | 打开文件 | ⌘/ | 切换源码模式 |
| ⌘S / ⌘⇧S | 保存 / 另存为 | ⌘B / ⌘I / ⌘K | 粗体 / 斜体 / 链接 |
| ⌘W | 关闭标签页 | ⌘Z / ⌘⇧Z | 撤销 / 重做 |
| ⌘P / ⌘⇧F | 快速打开 / 全局搜索 | ⌘1–9 | 切换标签页 |
| ⌘⇧P | 固定 / 取消固定 | ⌘⌥S | 隐藏 / 显示侧边栏 |

## 开发

**环境要求**：Node.js ≥ 20、pnpm、Rust stable、Xcode Command Line Tools（Universal 打包需 `rustup target add x86_64-apple-darwin`）。

```bash
pnpm install        # 安装依赖
pnpm tauri dev      # 开发运行（Vite 热更新）
pnpm test           # 前端单元测试（vitest）
cd src-tauri && cargo test   # Rust 单元测试
pnpm tauri build --target universal-apple-darwin   # 打包 Universal .app / .dmg
```

产物位于 `src-tauri/target/universal-apple-darwin/release/bundle/`。构建使用 ad-hoc 签名（无开发者账号），首次打开需右键点击应用 → 「打开」。

## 目录结构

```
src/
├── components/   # Sidebar / TabBar / EditorPane / SearchPalette 等
├── editor/       # CodeMirror 6 扩展：即时渲染装饰层 / 快捷键 / 粘贴转换
├── stores/       # zustand：标签页 / 元数据
├── lib/          # IPC 封装 / 文件监听 / 模糊匹配 / i18n
└── i18n/         # 中英文案（跟随系统语言）
src-tauri/src/
├── files.rs      # 文件读写 / 编码检测 / 全局搜索（async + spawn_blocking）
├── fsio.rs       # 原子写入 / mtime 快照
├── watch.rs      # notify(FSEvents) 外部修改监听
├── menu.rs       # 原生菜单（中英双语）
└── state.rs      # 元数据 JSON 持久化 + 版本门禁
```

## 数据与隐私

- 所有文档保存在你自己选择的位置，应用不内置任何目录锁定
- 元数据（偏好 / 固定 / 最近 / 会话）存于 `~/Library/Application Support/com.notetock.app/notedock-state.json`
- 升级 / 重装应用不触碰该目录；元数据损坏时应用进入只读保护而不会覆盖

## 平台

macOS 10.15+，Universal（Apple Silicon + Intel）双架构，版本 0.1.0。

## Community

This project has been linked and endorsed by [LINUX DO Community](https://linux.do).

## License

[MIT](./LICENSE) © 2026 cd826
