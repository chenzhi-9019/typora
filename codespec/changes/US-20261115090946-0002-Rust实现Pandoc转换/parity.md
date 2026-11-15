---
status: done
us: US-20261115090946-0002-Rust实现Pandoc转换
---

# 功能缺口巡检

对照 Typora 1.14.15 的菜单、偏好设置与编辑器行为逐项核对。本轮迭代后，「未实现」只剩下面列出的项。

## 本轮已完成

| 编号 | 功能 | 证据 |
|---|---|---|
| G1 | 界面语言切换（中 / 英） | 将 language 设为 en 后菜单渲染为 File / Edit / Paragraph / Format / View / Themes / Help；195 个菜单项都有 labelEn，6 个组件与偏好设置走 i18n 字典 |
| G3 | 上传服务接线 | 渲染端改调 window.api.image.upload；67 项 harness 全 PASS，含 picgo 成功/失败回退、图片归档四种规则、不覆盖同名文件 |
| G4 | 大纲跟随光标 | 12 项 harness PASS，含仅靠 md-focus 变化（零 scroll 事件）也能重算；顺带修好「点击大纲不跳转」——事件此前无人监听 |
| G5 | 源码模式自动配对与纠正 | 28 项冒烟 PASS，真实 sendInputEvent 注入字符命中 CodeMirror inputHandler |
| G6 | 公式块与 mermaid 图的内联编辑面板 | 单击出 textarea、回车提交重渲染、Esc 取消且 Markdown 不变 |
| G8 | 表格 Tab 跳格与整行整列选中 | 末格 Tab 自动补行、点击边缘选中整列/整行 |

## 仍未实现

| 编号 | 功能 | 现状 | 说明 |
|---|---|---|---|
| G2 | 图片拖放与剪贴板粘贴 | 只能通过菜单/对话框插入 | insertImageSource 已就绪，缺 drag/drop 与 paste 事件接入 |

## 已知限制（不阻塞，属平台或范围外）

| 项 | 说明 |
|---|---|
| G7 视图 > 工具栏 | Typora 桌面版本体不显示工具栏，按「不适用」记录 |
| G10 拼写检查右键建议 | 依赖 Chromium 原生能力，无法程序化接管；autoCorrect 只做词表纠正 |
| 表格整列复制 | 浏览器 Selection 只能表达连续区间，复制出的是连续文本而非纯列内容 |
| docx reader | 合并单元格未合并、页眉页脚/脚注不读、文本框与图表不抽取 |
| rtf reader | 无表格、无编号、无图片、meta 为空 |
| epub writer | 本地相对路径图片退化为 alt 文本 |

## 明确不做

| 项 | 原因 |
|---|---|
| 激活 / License | 用户明确排除 |
| 云同步、发布、在线图床内置账号 | 需要服务端 |
| macOS / Linux 窗口 chrome | 只保证 Windows |
| 完整 pandoc（CiteProc、模板、filter、自定义 AST JSON） | 范围外 |
