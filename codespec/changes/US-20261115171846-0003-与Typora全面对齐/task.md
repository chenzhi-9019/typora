---
status: done
us: US-20261115171846-0003-与Typora全面对齐
---

# 任务分解

| 编号 | 任务 | 执行方式 | 状态 |
|---|---|---|---|
| T1 | 定位「输入不渲染」根因 | 主 Agent | 完成：行尾空格是 U+00A0 |
| T2 | 修复 NBSP 导致输入规则全失效 | 主 Agent | 完成 |
| T3 | 图片拖放与剪贴板粘贴 | subagent editor-engine | 完成 |
| T4 | 行为巡检 harness（144 条） | subagent parity-audit | 完成 |
| T5 | 第 1 轮 4 条差异修复 | 主 Agent + editor-engine | 完成 |
| T6 | 第 2 轮 16 条差异修复 | 主 Agent + editor/sidebar/settings | 完成 |
| T7 | 第 3 轮 3 条差异修复 | 主 Agent + editor-engine | 完成 |
| T8 | 复跑巡检至无剩余产品缺陷 | 主 Agent | 完成（142/144，其余 2 条为 harness 局限） |

## 循环规则

每轮「跑巡检 → 记录差异 → 分派修复 → 再跑」。第 4 轮后剩余 2 条均为 harness 局限（见 validation.md），产品侧已无已知差异。
