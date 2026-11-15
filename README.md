# Typora 复刻

> 用 Electron + Vue 3 + TypeScript 重新实现 Typora 1.14.15 的 Windows 桌面编辑器，目标是与原版在视觉与交互上逐像素一致。

[![release](https://img.shields.io/github/v/release/chenzhi-9019/typora?label=release)](https://github.com/chenzhi-9019/typora/releases)
[![build](https://img.shields.io/github/actions/workflow/status/chenzhi-9019/typora/release.yml?label=build)](https://github.com/chenzhi-9019/typora/actions/workflows/release.yml)

## 功能

- **窗口与菜单**：Windows 原生 frame 与原生菜单栏，七个中文一级菜单与原版同构、同序、同文案
- **编辑区**：markdown-it 渲染 + contenteditable 原地编辑，源码模式交 CodeMirror 6，带行号与 Markdown 高亮
- **代码块**：highlight.js 着色；键入 ``` 与空格即弹出语言列表，输入即筛、回车成块；右下角胶囊随时改语言
- **主题**：github / night / newsprint / pixyll / whitey 五套，切换只换 CSS 变量，不重载文档
- **数学与图表**：katex 行内与块级公式、mermaid 图表
- **文件与工作区**：文件树、大纲、查找替换、字数统计、自动保存
- **导出与转换**：HTML / PDF 导出；docx / epub / rtf 导入由 `lib/doc-rs` 承接

## 下载与安装

到 [Releases](https://github.com/chenzhi-9019/typora/releases) 下载最新的 NSIS 安装包：

| 文件 | 适用机器 |
|---|---|
| `typora-<版本>-x64-setup.exe` | 绝大多数 Intel / AMD 机器 |
| `typora-<版本>-arm64-setup.exe` | Windows on ARM（骁龙 X 系列等） |

安装包未做代码签名，首次运行 Windows SmartScreen 会拦截一次，选择「更多信息 → 仍要运行」即可。

## 从源码构建

环境要求：

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 20 | 主进程、预加载与渲染层 |
| Rust | ≥ 1.75 | `lib/doc-rs` 文档转换器，需装 `x86_64-pc-windows-msvc` 与 `aarch64-pc-windows-msvc` 两个 target |
| Visual Studio Build Tools | 2022 | Rust 链接 MSVC 目标 |

```bash
npm install
npm run build:doc-rs   # 交叉编译 x64 与 arm64 两个转换器，产物落到 resources/bin/
npm run build          # 双端类型检查 + electron-vite 打包到 out/
npx electron-builder --win nsis --x64 --arm64   # 生成两个安装包到 dist/
```

日常开发：

```bash
npm run dev          # 开发模式，热更新
npm run typecheck    # node + web 两侧类型检查
npm run lint         # eslint
```

依赖下载走 npmmirror 时需要设置镜像：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
```

## 持续集成与发布

`.github/workflows/release.yml` 在每次推送到 `main`（或手动触发）后执行：

1. 装 Node 22 与 Rust，补上两个 Windows target；
2. `npm ci` → `npm run build:doc-rs` → `npm run build`；
3. `electron-builder --win nsis --x64 --arm64` 产出两个安装包；
4. 用仓库自带的 `GITHUB_TOKEN` 创建或更新 `v<package.json 版本号>` 的 Release，把两个安装包挂上去。

改版本号只需改 `package.json` 的 `version`，下一次推送会自动生成对应 tag 的 Release。重跑不会失败：同名 tag 的 Release 会被更新而不是重复创建。

## 结构

```
src/
  shared/          # 三层共享契约：类型、IPC 频道名、TyporaApi 接口
  main/            # 主进程：窗口、原生菜单、文件 IO、设置、导出
  preload/         # contextBridge 暴露 window.api
  renderer/src/
    App.vue        # 布局与菜单命令分发
    components/    # Sidebar FileTree Outline StatusBar MegaMenu FindPanel
    stores/        # settings / workspace / document / outline
    editor/        # createEditor：CodeMirror 6 源码模式 + markdown-it 所见即所得
    styles/        # tokens / shell / editor / themes
lib/doc-rs/        # Rust 实现的文档转换器（替代外部 pandoc）
scripts/           # 构建脚本、像素比对、行为巡检 harness
build/             # electron-builder 图标与打包资源
codespec/          # 过程文档：基线 spec/design 与每次变更的 delta
```

渲染进程只依赖 `window.api`，不允许直接 import `electron`。

## 文档转换器 `lib/doc-rs`（替代 pandoc）

原版 Typora 靠外部 pandoc 完成「文件 > 导入」和若干导出格式。本工程用自研 Rust 转换器顶上：

- **读**：docx / epub / rtf / html → 中间 AST
- **写**：markdown / html / docx / epub / rtf / org / rst / textile / mediawiki / opml / latex
- 导入走四个 reader；导出统一由渲染层产 HTML 再交给它，所以 Rust 侧不需要再实现一遍 Markdown 解析

```bash
npm run build:doc-rs   # 交叉编译 x86_64 与 aarch64，产物落到 resources/bin/
npm run test:doc-rs    # cargo test，38 个用例
npm run build:app      # 转换器 + 应用一起构建
```

主进程按 `process.arch` 选 `doc-rs-x64.exe` 或 `doc-rs-arm64.exe`；`resources/**` 由 electron-builder 的 `asarUnpack` 排除在 asar 之外，保证可执行。

转换器本身也可单独用：

```bash
doc-rs --from docx --to markdown -o out.md in.docx
doc-rs --from html  --to docx --output out.docx in.html
doc-rs --probe          # 打印支持的格式
```

## 行为巡检与像素比对

`scripts/parity/run.mjs` 用 CDP 驱动真实窗口，逐条重放 Typora 的行为并断言 DOM 结果（144+ 条用例，覆盖输入规则、渲染、菜单、设置、保存、导出、主题）：

```bash
npm run build                        # 巡检跑的是 out/，必须先构建
node scripts/parity/run.mjs          # 全量，约 6 分钟
node scripts/parity/run.mjs --only input
```

`scripts/pixel-diff.cjs` 用 Electron 的 nativeImage 做逐像素比较：

```bash
npx electron scripts/pixel-diff.cjs ref.png shot.png diff.png
```

输出差异像素比例、差异包围盒与平均色差，并写出可视化 diff 图。

## 规格参考是怎么来的

原版 Typora 1.14.15 的安装包由 Inno Setup 6 打包（不是 NSIS，7-Zip 打不开），解包后主进程逻辑是 V8 字节码不可读，但渲染层 `appsrc/window/frame.js`、`window.html` 与 `style/` 是明文，可作为行为与数值规格。

**本仓库不包含原版的任何资源**：样式按量取到的数值自行编写，字体走 `@fontsource` 的开源版本，图标自行绘制；解包产物与参照截图放在本地 `tmp/`，不入库。解包流程与目录对照见 `docs/arch.md` 的参照物章节。

## 过程文档

`codespec/` 是开发过程的留痕：`specs/spec.md` 与 `specs/design.md` 是当前基线，`changes/US-*` 是每次变更的 delta-spec / delta-design / task / validation / review。

## 免责声明

本项目是为学习 Electron 与编辑器实现而做的独立复刻，与 Typora 官方无关，不包含、不分发原版任何二进制或资源。原版 Typora 是付费软件，请通过官方渠道购买授权。若本项目侵犯了你的权益，请提 issue，我会及时处理。
