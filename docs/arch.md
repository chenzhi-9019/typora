# 架构文档

<!-- 由 df-arch 生成的各 US 架构文档按时间合并而成；每个块由 df-arch:<US> 标记界定。 -->
<!-- df-arch:US-20261114220214-0001-Typora像素级复刻 -->
<!-- df-arch:US-20261114220214-0001-Typora像素级复刻 -->

# 架构：Typora 像素级复刻（US-20261114220214-0001-Typora像素级复刻）

## 1. 参照物：Typora 1.14.15 的实际结构

解包 `typora-setup-x64.exe`（Inno Setup 6，414 个条目）后，安装目录只有一棵 `app/` 树，没有 `app.asar` 之外的打包层：

```mermaid
flowchart TD
    EXE["Typora.exe<br/>Electron 主进程入口"]
    APP["resources/app.asar"]
    LAUNCH["launch.dist.js"]
    JSC["atom.compiled.dist.jsc<br/>V8 字节码，不可读"]
    WIN["window.html<br/>主窗口骨架 91KB"]
    FRAME["appsrc/window/frame.js<br/>编辑引擎 1.7MB 可读压缩"]
    STYLE["style/<br/>base.css window.css themes/"]
    LIB["lib.asar<br/>CodeMirror mermaid MathJax4"]
    PAGEDIST["page-dist/<br/>偏好设置 欢迎页 React 产物"]

    EXE --> APP
    APP --> LAUNCH
    APP --> JSC
    EXE --> WIN
    WIN --> FRAME
    WIN --> STYLE
    EXE --> LIB
    EXE --> PAGEDIST
```

关键事实：主进程逻辑（`atom.compiled.dist.jsc`）是 V8 字节码，无法还原为源码；渲染层（`frame.js`、`window.html`、`style/`）是明文，可以作为行为与视觉规格读取，但按用户决定不作为运行时代码复用。

## 2. 目标结构：本工程分层

```mermaid
flowchart TD
    subgraph main["src/main（主进程）"]
        M_WIN["window.ts<br/>BrowserWindow 生命周期"]
        M_MENU["menu.ts<br/>中文原生菜单"]
        M_IO["ipc/fs.ts<br/>文件读写与目录树"]
        M_SET["ipc/settings.ts<br/>conf.user.json"]
        M_EXP["ipc/export.ts<br/>HTML / printToPDF"]
    end

    subgraph shared["src/shared（契约）"]
        S_TYPES["types.ts<br/>EditorSettings FileNode MenuCommand"]
        S_IPC["ipc.ts<br/>频道名常量"]
        S_API["api.ts<br/>TyporaApi 接口"]
    end

    subgraph preload["src/preload"]
        P_BRIDGE["index.ts<br/>contextBridge 暴露 window.api"]
    end

    subgraph renderer["src/renderer/src（渲染进程）"]
        R_APP["App.vue<br/>布局与菜单命令分发"]
        R_SHELL["components/<br/>Sidebar FileTree Outline<br/>StatusBar MegaMenu FindPanel"]
        R_STORE["stores/<br/>settings workspace document outline"]
        R_EDITOR["editor/<br/>createEditor 双模式引擎"]
        R_STYLE["styles/<br/>tokens shell editor themes"]
    end

    S_TYPES --> S_IPC
    S_TYPES --> S_API
    S_API --> P_BRIDGE
    S_IPC --> M_WIN
    S_IPC --> M_IO
    P_BRIDGE --> R_APP
    R_APP --> R_SHELL
    R_APP --> R_STORE
    R_APP --> R_EDITOR
    R_SHELL --> R_STYLE
    R_EDITOR --> R_STYLE
```

依赖方向是单向的：`shared` 不依赖任何一层；`main` 与 `preload` 只依赖 `shared`；`renderer` 只依赖 `preload` 暴露的 `window.api` 与 `shared` 的类型。渲染进程不允许直接 import `electron`。

## 3. 编辑区组件结构

```mermaid
flowchart LR
    HOST["editor-host<br/>挂载点"] --> CREATE["createEditor(host, options)"]
    CREATE --> MODE{"sourceCodeMode ?"}
    MODE -->|true| CM["CodeMirror 6<br/>markdown 高亮 + 行号"]
    MODE -->|false| CE["contenteditable #write"]
    CE --> MD["markdown-it 渲染管线"]
    MD --> HL["highlight.js 代码块"]
    MD --> KATEX["katex 公式"]
    MD --> MER["mermaid 图表"]
    CE -->|编辑后回写| SRC["Markdown 源串"]
    SRC --> ONCHANGE["options.onChange"]
    SRC --> OUTLINE["options.onOutline"]
    SRC --> COUNT["options.onCount"]
```

## 4. 主题机制

```mermaid
sequenceDiagram
    participant U as 用户
    participant M as 主进程菜单
    participant A as App.vue
    participant S as settings store
    participant D as document.body

    U->>M: 主题 > night
    M->>A: menuCommand { command: 'theme.set', arg: 'night' }
    A->>S: patchSettings({ theme: 'night' })
    S->>M: IPC settings:patch
    M-->>S: 合并后设置对象
    S-->>A: settings.theme 变化
    A->>D: body.dataset.theme = 'night'
    Note over D: body[data-theme='night'] 下的变量生效<br/>结构样式不变，只换取值
```

## 5. 与 Typora 的像素对齐锚点

| 锚点 | Typora 1.14.15 取值 | 本工程落点 |
|---|---|---|
| 侧栏宽度 | `--sidebar-width: 240px` | `styles/tokens.css` |
| 状态栏高度 | 28px，Windows 下 30px，上边框 1px `#ddd` | `styles/shell.css` `footer.ty-footer` |
| 编辑区盒子 | `max-width: 860px`（github 主题）、`padding: 30px`、`padding-bottom: 100px` | `styles/editor.css` `#write` |
| 根字号 | `html { font-size: 16px }`（github 主题） | 主题文件 `--write-font-size` |
| 正文行高 | 1.6 | 主题文件 `--write-line-height` |
| h1 / h2 | 2em / 1.6em，带 1px 下边框 | `styles/editor.css` + github 主题覆盖 |
| 代码块 | 浅灰底 `#f7f7f7`、等宽字体、无边框圆角的软块 | 主题 `--code-block-bg` |
| 窗口 chrome | Windows 原生 frame + 原生菜单栏 | `BrowserWindow` 不设 `titleBarStyle` |

## 6. 未纳入本期的参照物

- `page-dist/` 下的偏好设置与欢迎页（React 产物）需要等价重写为 Vue 页面，本期不做。
- `lib.asar` 中的 MathJax4、pdf-lib、aws-sdk、Jimp 由 npm 生态的等效库替代，不直接搬运。
<!-- /df-arch:US-20261114220214-0001-Typora像素级复刻 -->
