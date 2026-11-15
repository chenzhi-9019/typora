---
status: done
us: US-20261115213400-0005-代码块语言输入
---

# 代码块语言输入 Design Delta

> 受影响的组件、依赖方向与流程时序由 `df-arch` 画在 `docs/arch_US-20261115213400-0005-代码块语言输入.md`。本文件只写这次改哪里、为什么这么改、基线会怎么变。

## Context

本次改动全部落在渲染层编辑区内部，建立在基线 `design.md` 的既有决策「编辑区采用 markdown-it 渲染 + contenteditable 原地编辑」（design.md:43-47）之上：语言列表的选择过程不引入隐藏输入框，筛选文本就是段落里的真实文本，因此它天然可撤销、可序列化，也不需要新的 IPC 或主进程配合。

既有实现已提供三块可复用的地基：`markdown-renderer.ts:153` 的 `listCodeLanguages()` 给出全量语言名（hljs 语言 + js/py/ts 等别名），`wysiwyg.ts:2919` 起的胶囊编辑链路给出聚焦/提交/写回的完整流程，`editor.css:273` 的 `.typora-lang-suggest` 面板已有定位与 `max-height: 12em` 滚动。本次把「新建围栏」这条入口接到同一套地基上。

## Scope

- 新建代码块时即时选择语言
- 既有代码块的语言修改沿用同一列表

## Changes

| 模块 | 改什么 | 对应需求 |
|---|---|---|
| `src/renderer/src/editor/wysiwyg.ts` `matchBlockInputRule`（2172-2183） | 「```/`~~~` + 空格」命中后不再删除标记、不再调用 `convertToFence`，改为登记待转换段落并打开语言列表 | 新建代码块时即时选择语言 |
| `wysiwyg.ts` 新增待转换状态与两个方法 | `pendingFence = { block, query }`；`openFenceLangPicker(block, query)` 打开列表，`commitFenceLang(pick)` 完成转换 | 新建代码块时即时选择语言 |
| `wysiwyg.ts` `applyEnterBlockRules`（2401-2416） | 存在待转换段落时，回车改为「取当前高亮候选，无高亮取已键入文本，两者皆空则无语言」后转换；无待转换段落时保持原有的立即成块 | 新建代码块时即时选择语言 |
| `wysiwyg.ts` `updateLangSuggest`（3006-3045） | 空查询列出全部语言；匹配由 `startsWith` 改为大小写不敏感子串，名称以查询开头者优先、其次按长度、再按字典序；去掉 `LANG_SUGGEST_LIMIT` 的 12 条截断 | 新建代码块时即时选择语言；既有代码块的语言修改沿用同一列表 |
| `wysiwyg.ts` `updateLangSuggest` 的锚点（3037-3043） | 面板定位从「只认当前胶囊」改为接受传入的锚点元素：新建时锚段落，改语言时锚胶囊 | 新建代码块时即时选择语言 |
| `wysiwyg.ts` `convertToFence`（2290-2305）与 `toggleCodeFence`（1417） | 删除 `lastCodeLang` 兜底，新建围栏一律空语言；`commitLangEdit`（3082）不再写回该变量 | 新建代码块时即时选择语言 |
| `wysiwyg.ts` `openLangEditor`（2919-2927） | 打开时以胶囊现有语言为初始查询，走同一面板与同一排序 | 既有代码块的语言修改沿用同一列表 |
| `wysiwyg.ts` `moveLangIndex`（3047-3056） | 高亮移动后把新高亮项滚入面板可见区（条目从 12 条涨到 200 余条，12em 视口装不下） | 新建代码块时即时选择语言 |
| `src/renderer/src/editor/editor.css` | 无新增规则；沿用 `.typora-lang-suggest` 的 `max-height` 与滚动 | 两条需求共用 |

## Baseline Diff

- 组件与依赖方向不变：改动全在渲染层 `editor/` 内部，主进程、预加载、`src/shared` 的 IPC 契约与数据所有权都不动，`docs/arch.md` 的模块图无需新增节点，只需在编辑区节点内补一条「围栏输入两段式」的说明。
- 实现后基线 `design.md` 需要改两处：
  - `## Decisions` 的「编辑区采用 markdown-it 渲染 + contenteditable 原地编辑」下补一条子决策：围栏输入分两段——空格只唤起语言列表、回车才成块；筛选文本就是段落真实文本，因此不新增隐藏输入框，也不破坏「先成为文档文本再转换」的既有约定。
  - `## Risks / Trade-offs` 追加一条：取消后在段落里残留 ```py 这类文本时，保存后重新打开会被 markdown-it 当成围栏开头。
- 基线 `## Context` 里「尚未实现。当前仓库是 electron-vite + Vue 3 + TypeScript 脚手架」已与仓库现状不符，属基线漂移；本次不改基线，留给基线补正。
- `docs/arch.md` 目前只有 US-20261114220214-0001 的架构块，本变更的架构内容由 df-arch 单独成文后再合并进来，不在本文件展开。

## Risks / Rollback

- **取消后残留文本会被当成围栏**：段落停在 ```py 时如果直接保存，重新打开会被解析成代码块。现状已存在同样情形（打 ```js 不回车就切换文档），本次把该风险写进基线 `Risks`，不在本变更里改序列化规则。
- **待转换段落在转换前脱离文档**：面板打开期间切换文档或触发 `render()`，`pendingFence` 可能指向已移除的段落。转换前校验 `block.isConnected`，不通过则清空状态并关面板。
- **段落文本不再是「标记 + 片段」形态**：用户粘贴多行或删除反引号后，查询失配。此时只关面板、不改文本，按普通输入处理。
- **两条入口语义不同**：```js + 回车仍立即成块，``` + 空格走列表。这是有意的取舍（沿用 `scripts/parity/checks.mjs` 的 input.fence 断言），代价是同一意图有两条路径，需在基线的子决策里写明。
- **回滚**：改动集中在 `wysiwyg.ts` 的围栏输入与语言面板两段，CSS 无新增规则；回滚即恢复「空格即成块 + `lastCodeLang` 兜底」，不涉数据迁移。
