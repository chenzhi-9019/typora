---
status: done
us: US-20261115213400-0005-代码块语言输入
---

# Validation

## 检查范围

| 文件 | 存在 | 本次结论 |
|---|---|---|
| `spec.md`（基线） | 是 | 无问题：本次两条需求都是新增，与基线十条需求无同名、无冲突 |
| `design.md`（基线） | 是 | 1 处基线自身问题（提到 mermaid 无围栏），不属本次，需上游修正 |
| `delta-spec.md` | 是 | 无问题：2 条需求各带场景，ADDED 与 Impact 齐备 |
| `delta-design.md` | 是 | 无问题：五节齐全，9 行 Changes 覆盖两条需求 |
| `task.md` | 是 | 修掉 2 处：方向键拦截无任务覆盖、空查询默认高亮与规格冲突 |
| `docs/arch_US-20261115213400-0005-代码块语言输入.md` | 是 | 修掉 3 处结构问题：章节编号、围栏奇偶、内联三引号 |
| `README.md` | 是 | 修掉 1 处：`changes/<US-*>/` 触发占位符告警 |
| `scope.md` | 是 | 1 处模板固定措辞告警，判定不修复 |

## 问题清单

| ID | 档位 | 位置 | 问题 | 证据 | 处理 |
|---|---|---|---|---|---|
| V1 | 严重 | `docs/arch_…0005.md` | 缺模板要求的 `## 10.` 章节，机械校验判为缺章 | `check.py` 输出 `E_ARCH_SECTION 缺章节 ## 10.` | 已修复 |
| V2 | 严重 | `docs/arch_…0005.md` | 全文 ````` 出现 11 次，奇数次意味着围栏未闭合 | 原文第 25/93/162 行是正文内联三引号；`check.py` 输出 `E_MERMAID_FENCE` | 已修复 |
| V3 | 严重 | `task.md:111,113,114` | 「覆盖检查」写成 2 列表格，校验器要求 8 列 | `check.py` 输出 `E_TASK_COLUMNS 表格有 2 列，应为 8 列` ×3 | 已修复 |
| V4 | 严重 | `task.md` T1-T3 | 待转换段落上的方向键与 Esc 没有任何任务步骤覆盖；不拦截就选不了候选、Esc 也退不出去 | delta-spec「支持方向键移动高亮」↔ `task.md` T1-T3 全文无 ArrowUp/Down，且 `wysiwyg.ts` 的 `handleLangKeydown` 只对胶囊生效 | 已修复 |
| V5 | 严重 | `validation.md` | 文件不存在 | `check.py` 输出 `E_NOFILE` | 已修复 |
| V6 | 一般 | `delta-spec.md` ↔ `task.md` T1 | 规格要求空查询「默认没有高亮项」，T1 未要求改掉现状的首项高亮 | `wysiwyg.ts:3030` `if (index === 0) item.className = 'md-active'` | 已修复 |
| V7 | 一般 | `task.md:25,78` | 正文里的 `<p>`、`language-<lang>` 触发占位符告警 | `check.py` 输出 `W_PLACEHOLDER` | 已修复 |
| V8 | 一般 | `docs/arch_…0005.md` | 9 处 `<br/>`、`<p>`、`<lang>` 告警，且缺「变更记录」小节 | `check.py` 输出 `W_PLACEHOLDER` ×9、`W_ARCH_CHANGELOG` | 已修复 |
| V9 | 一般 | `README.md:115` | `changes/<US-*>` 命中占位符正则 | `check.py` 输出 `W_PLACEHOLDER` | 已修复 |
| V10 | 一般 | `codespec/specs/design.md:7` | 出现 mermaid 字样但没有 mermaid 围栏 | `check.py` 输出 `W_MERMAID_TAG` | 需上游修正 |
| V11 | 一般 | `scope.md:33` | 越界处置的 `<路径>` / `<理由>` / `<需求名>` 是模板规定的固定措辞 | `df-scope` 模板「保留固定措辞」 | 不修复 |
| V12 | 一般 | `review.md` | 文件不存在 | `check.py` 输出 `W_REVIEW_MISSING` | 待验证 |

## 处理记录

- 第 1 轮：`check.py` 报 23 项（严重 6 / 一般 17，含重复）；去重并叠加语义复查后共 12 项（严重 5 / 一般 7）。用户选择「全部修复（基线项除外）」。修了 V1-V9，V10 记需上游修正，V11 判不修复，V12 留到评审阶段。
- 第 2 轮：重跑 `check.py`，问题从 23 项降到 4 项：仅剩 V10（基线）、V11（模板措辞）、V12（未到阶段）与本轮新产出的 `validation.md` 自身。无新增问题。

## 遗留

| ID | 归属 | 说明 |
|---|---|---|
| V10 | 上游（基线补正） | `codespec/specs/design.md` 第 7 行提到「mermaid」但没有围栏；基线文件本次不动，留给基线补正 |
| V11 | 不处理 | `scope.md` 的尖括号是 df-scope 模板规定的固定措辞，改掉会偏离模板 |
| V12 | 实现后的评审阶段 | `review.md` 由 df-review 产出，本阶段不代写 |

## 实现后回填

| ID | 归属 | 说明 |
|---|---|---|
| V13 | 已确认 | 语言表规模：编辑器实际注册 30 个 highlight.js 语言 + 19 个别名，合计 49 个可选项，不是 190。T5 的 `input.fence-lang-list` 因此按 49 断言，而不是原先设想的「≥150」 |
| V14 | 已确认（实现与 delta 的细化） | 排序多一条「完全匹配的别名排最后」：键入 py 时 python 在前、别名 py 在后。delta-spec 只写了「前缀优先、长度、字典序」，这条细化沿用既有实现，并已写进基线 spec 与 design.md |
| V15 | 已确认（实现与 delta 的偏差） | 面板容器从 `div.typora-lang-suggest` 改为 `ul.typora-lang-suggest`，对齐 Typora 的真实 DOM 与 `editor.css` 里已有的 `li` 规则 |
| V16 | 已确认（超出 T5 原定范围） | T5 原定 6 条断言，实做 7 条：多出 `input.fence-pill-langs`，补上「既有代码块改语言」这条需求此前没有自动化断言的空档 |
| V17 | 需上游修正（既有问题） | `npm run lint` 在本仓库基线就是红的：`eslint .` 没有忽略 `tmp/`（1.7MB 压缩资源），单次运行超过十分钟未结束；实际执行的是 `npx eslint src scripts`，结果是 64 errors / 652 warnings，均为既有问题。本次改动的两个文件里只剩 `checks.mjs:38` 的 `explicit-function-return-type`，属既有 helper |
