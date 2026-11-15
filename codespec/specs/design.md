---
status: done
---

# Design

> 架构与图形由 df-arch 成文到 `docs/arch_{US}.md`，最终并入 `docs/arch.md`。本文件只写决策与风险。

## Context

尚未实现。当前仓库是 electron-vite + Vue 3 + TypeScript 脚手架，加上从 Typora 1.14.15 安装包解包得到的参考资料（`tmp/`，不纳入构建）。解包结果：主进程 `launch.dist.js` 与 `atom.compiled.dist.jsc` 为 V8 字节码不可读；渲染层 `appsrc/window/frame.js`（1.7MB 压缩可读）、`window.html`、`style/` 全为明文；附加窗口是 `page-dist/` 下的 React 产物。

## Goals / Non-Goals

**Goals:**

- 主窗口外壳（侧栏、编辑区、状态栏）与 Typora 1.14.15 在同一主题下视觉一致
- 编辑区能渲染 Markdown 全部常用块与行内元素，并支持原地编辑
- 五套主题通过 CSS 变量契约切换，不重载文档
- 主进程、预加载、渲染进程三层职责清晰，IPC 有单一契约来源

**Non-Goals:**

- 不复用 Typora 的 CSS 文件、字体文件与图标字体，等价样式全部自行编写（用户决定）
- 不复用 `frame.js` 作为运行时，只当作行为规格参考
- 不做登录、云同步、图床上传、PDF 注释、公式编辑面板等 Typora 商业功能
- 不做 macOS / Linux 的窗口 chrome 适配，本期只保证 Windows

## Decisions

### 三层架构与单一 IPC 契约

- 选择：`src/shared` 存放类型与 IPC 频道名，主进程用 `ipcMain.handle` 实现，预加载通过 `contextBridge` 暴露 `window.api`，渲染进程只依赖 `window.api`。
- 理由：Electron 项目最常见的问题是主进程与渲染进程各写一份 channel 字符串导致漂移；把契约固化成一个模块，改一处就编译报错。
- 否掉的替代：渲染进程直接 `ipcRenderer`（需关闭 contextIsolation，安全性差）；用第三方 RPC 框架（对这么小的面引入额外依赖不划算）。

### 主题用 CSS 变量契约而非样式表切换

- 选择：主题文件只覆盖 `body[data-theme='x']` 下的 CSS 变量与少量排版规则，结构样式集中在 `styles/shell.css` 与 `styles/editor.css`。
- 理由：旅行时主题文件只需声明差异；切换主题只改一个属性，不引起重排或重新加载；变量名沿用 Typora 的既有名字，后续导入第三方主题时改造成本低。
- 否掉的替代：每套主题一整份完整样式表（体积大、切换时布局抖动、维护四份重复的结构规则）。

### 编辑区采用 markdown-it 渲染 + contenteditable 原地编辑

- 选择：非源码模式用 markdown-it 渲染成 HTML 放入 contenteditable，编辑后把 DOM 回写 Markdown；源码模式交给 CodeMirror 6。
- 理由：像素级对齐的目标是"渲染后的文档长得像 Typora"，用真实 HTML 渲染最直接的就能吃到 CSS；CodeMirror 6 的装饰器方案要做到同样的排版需要重写大量布局逻辑。
- 否掉的替代：纯 CodeMirror 6 装饰器做 WYSIWYG（排版保真度不足）；嵌入 Typora 的 frame.js（等于再分发本体）。

### 围栏输入分两段：空格唤起列表，回车成块

- 选择：键入 ``` 与空格时不立刻把段落换成代码块，而是保留段落文本、弹出语言列表；回车才转换为 `pre.md-fences`。筛选文本就是段落里的真实文本，胶囊与新建两条入口共用同一个 `.typora-lang-suggest` 面板与同一套排序（前缀命中优先、完全匹配的别名排最后、其次按长度、再按字典序）。
- 理由：没有 fence 就没有语言输入位，凭空插入一个隐藏输入框会让撤销、序列化与失焦都多一套状态；让查询住在段落文本里，列表的打开/取消只是浮层显隐，文档模型不变。
- 代价：取消后段落会留下 ```py 这样的文本，序列化后重新打开会被 markdown-it 当成围栏；这条写进 Risks。```js 后直接回车仍立即成块，作为快捷通道保留。

### 字体从开源包引入

- 选择：Open Sans、Lato、Merriweather、PT Serif 通过 `@fontsource` 引入，不复制 Typora 包内的 woff。
- 理由：字形与原版一致才能像素级对齐，而这些字体本身是 OFL 授权，走 npm 合法且体积可控。
- 否掉的替代：直接用系统字体（字宽不一致，行高与断行会偏）；复制包内 woff（授权不明）。

### 窗口使用原生 frame

- 选择：Windows 下保留系统标题栏与原生菜单栏，不做自绘标题栏。
- 理由：Typora 1.14.15 在 Windows 上就是原生 frame + 原生菜单，自绘反而会偏离像素基准。
- 否掉的替代：无边框 + 自绘标题栏（需要额外处理缩放、贴边、系统菜单，收益为负）。

## Risks / Trade-offs

- **contenteditable 回写 Markdown 有损**：粘贴富文本、表格内换行、嵌套列表这类结构在 DOM 与 Markdown 之间往返时可能规范化，导致保存后原文变化。缓解：回写只作用于被编辑的块，未编辑块的原文原样保留。
- **清洗掉 Typora 的 CSS 后像素对齐要靠迭代**：所有取值需要逐条量取并与原版截图比对，首版必然有像素级偏差，需要在实现阶段反复校准。
- **mermaid 与 katex 的渲染尺寸受字体影响**：图表与公式内部排版由第三方库决定，和 Typora 打包的版本可能有细微差异。
- **取消围栏选择会留下半截围栏文本**：语言列表打开时按 Esc 或点别处，段落里的 ```py 会按原样序列化，重新打开文档时被 markdown-it 解析成围栏开头。缓解：把该文本当作普通文本保留，用户可以自己退格删掉；若要根治，需要在序列化层对行首反引号转义。
- **未注册原版授权**：本工程是独立实现，不包含 Typora 的代码资产，但仍需注意不得分发原版资源。
