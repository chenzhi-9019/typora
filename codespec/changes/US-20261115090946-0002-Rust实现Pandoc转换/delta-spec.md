---
status: done
us: US-20261115090946-0002-Rust实现Pandoc转换
depends-on: US-20261114220214-0001-Typora像素级复刻
---

# 增量规格：用 Rust 实现 Pandoc 级文档转换

## Purpose

原版 Typora 通过外部 pandoc 完成「文件 > 导入」和若干「文件 > 导出」格式。本工程此前把这两条路径留成 no-op。本变更用自研 Rust 转换器 `lib/doc-rs` 替代 pandoc 依赖，让导入 docx/epub/rtf/html 与导出 docx/epub/rtf/org/rst/textile/mediawiki/opml/latex 全部可用，并同时支持 Windows x86_64 与 aarch64。

## Requirements

### Requirement: 文档转换器可执行文件

转换器 SHALL 以单文件可执行程序交付，链接为静态运行库，同时产出 `doc-rs-x64.exe` 与 `doc-rs-arm64.exe` 两个 Windows 目标，运行时按进程架构自动选择。

#### Scenario: 架构自动选择

- **WHEN** 应用在 x86_64 的 Windows 上运行并触发一次导出
- **THEN** 主进程调用 `resources/bin/doc-rs-x64.exe`，在 aarch64 机器上则调用 `doc-rs-arm64.exe`

#### Scenario: 能力自检

- **WHEN** 执行 `doc-rs --probe`
- **THEN** 输出 JSON 列出全部支持的输入与输出格式名，退出码 0

### Requirement: 导入

应用 SHALL 把 docx、epub、rtf、html 文件转换成 Markdown 文本并作为当前文档内容。

#### Scenario: 导入 Word 文档

- **WHEN** 用户选择「文件 > 导入」并选中一个 .docx
- **THEN** 当前文档被替换为转换后的 Markdown，标题层级、加粗斜体、有序与无序列表、表格、超链接、图片引用都保留

### Requirement: 导出

应用 SHALL 把当前文档导出为 docx、epub、rtf、org、rst、textile、mediawiki、opml、latex，导出时先由渲染层产出 HTML 再交给转换器。

#### Scenario: 导出 Word

- **WHEN** 用户执行「文件 > 导出 > Word (.docx)」并选择保存路径
- **THEN** 生成一个 Word 能直接打开的文件，包含标题、段落、列表与表格

#### Scenario: 导出失败可诊断

- **WHEN** 转换器返回非零退出码
- **THEN** 应用弹出错误对话框，内容是转换器的 stderr，且不产生半成品文件
