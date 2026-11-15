---
status: done
us: US-20261115090946-0002-Rust实现Pandoc转换
---

# 增量设计

## Context

现有三层架构（shared 契约 / main 主进程 / renderer）已冻结。渲染层已有 HTML 产出（导出 HTML/PDF 的路径就是这么走的），所以转换器的输入统一用 HTML，不需要在 Rust 里再写一遍 Markdown 解析器——这是本变更最重要的一个取舍。

## Goals / Non-Goals

**Goals:** 覆盖 Typora 导入/导出菜单里 pandoc 承担的格式；两种 Windows 架构；零外部运行时依赖；单次转换 200ms 量级。

**Non-Goals:** 不做完整 pandoc（不实现 CiteProc、LaTeX 数学转 OMML、模板系统、filter、自定义 pandoc AST JSON）；不支持非 Windows 平台；不实现 pdf/odt/pptx。

## Decisions

### 用中间 AST 而不是 HTML 直通
- 选择：`readers/*` → `model::Document` → `writers/*`，每个格式只实现"到 AST"和"从 AST"两个方向。
- 理由：10 种输入输出两两组合会变成 40 条路径，AST 把它压成 9 个实现单元。
- 否掉的替代：每个格式对写（pandoc 的 reader/writer 也是这么解的，只是 AST 更重）。

### 输入统一走 HTML
- 选择：导出只接受 `--from html`；导入才用 docx/epub/rtf/html 四个 reader。
- 理由：渲染层已经有 markdown-it，产出 HTML 是免费的；在 Rust 里再写 Markdown 解析器是重复劳动且必然和渲染层的方言不一致。
- 否掉的替代：Rust 侧解析 Markdown（两套解析器会漂移）。

### 二进制随包分发，不动态下载
- 选择：`scripts/build-doc-rs.mjs` 交叉编译两个 target，落到 `resources/bin/`，electron-builder 的 `asarUnpack: resources/**` 保证它在包外可执行。
- 理由：主进程要 `spawn` 它，asar 内的文件无法直接执行；两个架构各自一份，避免 ARM 机器跑 x64 模拟层。
- 否掉的替代：运行时下载（离线不可用）；只带 x64（ARM 机器要走模拟）。

## Risks / Trade-offs

- **OOXML 正确性**：docx 写出必须能被 Word 打开，命名空间或 content-types 少一项就会报错。缓解：写完立刻用 zip 解开 + XML 解析自证。
- **RTF/HTML 解析是手写的**：容错度不如成熟库，畸形输入可能丢内容。缓解：解析器对未知标签/控制字一律跳过而不是中断。
- **体积**：两个静态二进制约 2-4MB，相对已有 30MB 的 Electron 包可接受。
