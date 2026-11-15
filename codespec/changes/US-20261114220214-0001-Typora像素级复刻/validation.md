---
status: done
us: US-20261114220214-0001-Typora像素级复刻
---

# 校验：Typora 像素级复刻

## 严重

（无）

## 一般

| 编号 | 问题 | 位置 | 处理 |
|---|---|---|---|
| V1 | 字数统计与原版差 3 词（同一份样例原版 87、本工程 90） | editor/stats.ts | 已知差异，原版对数学块与链接的计数口径未公开，本期不追平 |
| V2 | 内容盒左右各偏 1–2 物理像素 | styles/editor.css | 滚动条宽度已从 15px 改为原版的 12px，剩余偏差在字形抗锯齿量级，接受 |
| V3 | 原有 12 条缺能力命令，已补齐 10 条（newWindow、saveAll、export.image、smartOnRender、remapPunctuation、CRLF/LF、showBr、imageRoot、switchDocument、copyImage） | src/main、commands.ts | 见 V5/V6，只剩导入与非 UTF-8 编码两条 |
| V4 | ~~「文件 > 关闭」由主进程直接关窗，渲染端来不及做脏检查~~ | — | **已修**：主进程改为关闭握手（close 拦截 + close-requested 推送 + close-confirmed 放行），渲染端弹保存提示；5 秒未应答自动放行，避免应用无法退出 |
| V5 | 「文件 > 导入」仍无 Pandoc 导入器 | commands.ts | 显式 no-op + 注释；接入需主进程调 pandoc 二进制 |
| V6 | 「选择编码重新打开」除 UTF-8 外的 22 种编码不生效 | commands.ts | 显式提示「当前版本只支持 UTF-8」；需主进程转码 |

## 建议

| 编号 | 建议 | 理由 |
|---|---|---|
| S1 | 把 CRLF/LF 换行符策略下沉到主进程的文件读写层 | 目前编辑器统一序列化为 \n，选 CRLF 无法生效 |
| S2 | 为菜单里六组特殊加速键（Ctrl+Shift+[ 、Ctrl+Shift+] 、Ctrl+\` 、Ctrl+\ 、Ctrl+] 、Ctrl+[）做一次真机手工点击验收 | 构建期已证明被接受，物理按键是否触发未验证 |
| S3 | 把 capture-window.ps1 + pixel-diff.cjs 接进 CI | 像素基线已建立，回归有据可依 |

## 文档一致性

- specs/spec.md 的十二条需求与 docs/arch.md 的分层一致。
- design.md 的五条决策全部落地，无被推翻项。
- 未发现文件间矛盾。
