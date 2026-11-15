---
status: done
us: US-20261114220214-0001-Typora像素级复刻
---

# 任务分解：Typora 像素级复刻

## 执行方式与状态

| 编号 | 任务 | 执行方式 | 状态 | 边界 |
|---|---|---|---|---|
| T1 | 解包安装包，取得视觉与行为规格 | 主 Agent | 完成 | tmp/（不入构建） |
| T2 | 冻结三层契约：shared 类型、IPC 频道、preload API | 主 Agent | 完成 | src/shared、src/preload |
| T3 | 设计令牌与五套主题样式 | 主 Agent + subagent themes | 完成 | src/renderer/src/styles |
| T4 | 应用外壳：侧栏、文件树、大纲、状态栏、菜单 | 主 Agent + subagent sidebar-ui | 完成 | components、App.vue |
| T5 | Electron 主进程：窗口、菜单、文件 IO、设置、导出 | subagent main-process | 完成 | src/main |
| T6 | 编辑器引擎：CM6 源码模式 + markdown-it WYSIWYG | subagent editor-engine | 完成 | src/renderer/src/editor |
| T7 | 集成验证与像素比对 | 主 Agent | 完成 | 全量 |
| T8 | 附加窗口：偏好设置 + 欢迎页 | subagent aux-windows + main-process | 完成 | windows/、src/main/aux-windows.ts |
| T9 | 菜单栏完全照搬原版（7 顶级 / 192 叶子命令全部可执行） | 主 Agent + main-process + editor-engine | 完成 | shared/menu.ts、src/main/menu.ts、commands.ts |
| T10 | 应用图标与 .md 文件关联图标 | 主 Agent | 完成 | build/、resources/、electron-builder.yml |
| T11 | 滚动条复刻（12px 轨道 / 4px 透明边框收窄的滑块） | 主 Agent | 完成 | styles/scrollbar.css |
| T12 | 五套主题块级排版对齐 | subagent themes | 完成 | styles/themes/ |
| T13 | 补掉 12 条缺能力命令：PNG 导出、新窗口、关闭握手、CRLF/LF、showBr、智能标点、首行缩进、保留单换行、图片根目录 | 主 Agent + main-process + editor-engine | 完成 | src/main、commands.ts、editor |
| T14 | 多标签文档（视图 > 应用内窗口切换 Ctrl+Tab） | 主 Agent | 完成 | stores/document.ts、components/TabBar.vue |

## 里程碑

1. **M1 能跑起来** — 达成
2. **M2 像素对齐** — 达成：github 主题下与原版差异像素 **2.05%**、平均色差 4.65、15 个文字带纵向误差 0–1 物理像素
3. **M3 功能补齐** — 达成：192 条菜单命令运行时覆盖 192/192；大纲、源码模式、查找替换、导出 HTML/PDF/**PNG**、mermaid、KaTeX、偏好设置、欢迎页、多标签全部接通

## 已知未决

- 原版未注册时窗口上的试用提示不计入比对。
- 环境类命令（Pandoc 导入、iPic 上传、导出 PNG、多标签切换）在主进程/文件层缺能力，按「显式 no-op + 代码注释」处理，清单见 review.md。
