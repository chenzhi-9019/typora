---
status: done
us: US-20261115090946-0002-Rust实现Pandoc转换
---

# 任务分解：Rust 实现 Pandoc 转换 + 全量功能对齐

| 编号 | 任务 | 执行方式 | 状态 |
|---|---|---|---|
| T1 | doc-rs crate 骨架、AST、CLI | 主 Agent | 完成 |
| T2 | 四个 reader（docx/epub/rtf/html） | subagent rust-readers | 完成 |
| T3 | 五个 writer（markdown+html/markup/rtf/docx/epub） | subagent rust-writers | 完成 |
| T4 | 双架构构建与 resources/bin 落盘 | 主 Agent | 完成 |
| T5 | 主进程接 doc-rs：导入 + 九种导出 | 主 Agent | 完成 |
| T6 | 编辑器输入规则（9 类） | subagent editor-engine | 完成 |
| T7 | 偏好设置 65 行零灰显 | subagent settings-ui | 完成 |
| T8 | 设置生效链路 14 条 | subagent settings-runtime | 完成 |
| T9 | 主进程设置（启动/退出/导出默认/调试/窗口样式） | subagent main-process | 完成 |
| T10 | 编辑器渲染开关 15 条 | subagent editor-engine | 完成 |
| T11 | 中英双语 | subagent i18n | 完成 |
| T12 | 源码模式配对、公式图表编辑面板、表格 Tab | subagent editor-engine | 完成 |
| T13 | 大纲跟随光标 | subagent sidebar-ui | 完成 |
| T14 | 上传服务与图片归档 | subagent settings-runtime | 完成 |
| T15 | 图片拖放与粘贴（G2） | — | 待做 |

## 验收数字

- 菜单命令运行时覆盖 **201 / 201**
- 偏好设置 **65 行、灰显 0**
- 编辑器像素差异 **2.05%**、平均色差 4.65（github 主题，1500x1140）
- doc-rs 单测 **38 个**（reader 22 + writer 16）全通过；两个 Windows 目标各产出一份可执行文件
