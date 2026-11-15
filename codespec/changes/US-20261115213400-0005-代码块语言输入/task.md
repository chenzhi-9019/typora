---
status: done
us: US-20261115213400-0005-代码块语言输入
---

# Tasks

## 拆分方式

按可验证增量：本次改动集中在 `wysiwyg.ts` 一个文件，并行空间为零，因此每个任务切出一段能单独观测的行为（面板筛选 → 空格唤起 → 回车/取消 → 去掉上次语言兜底），失败了能立刻定位到是哪一段，回滚粒度也最小。

## 全局约束

- 不改 `src/shared/**`、`src/main/**`、`src/preload/**`：本次不涉及 IPC、菜单与主进程。
- 不新增 npm 依赖；语言表唯一来源是 `markdown-renderer.ts` 的 `listCodeLanguages()`，不许硬编码语言名单。
- 必须保住「```js + 回车」立即成块：`scripts/parity/checks.mjs` 的 `input.fence` 与 `input.fence-no-autopair` 两条断言全程不得失败。
- 筛选文本必须是段落里的真实文本，禁止引入隐藏输入框或把查询写进 `data-*` 属性。
- 浮层面板节点不得进入 `#write`；语言文本进入序列化的唯一通道是 `pre.md-fences` 的 `lang` 属性。

## 任务清单

| ID | 任务 | 方式 | 涉及文件 / 模块 | 对应需求 | 依赖 | 完成判据 | 状态 |
|---|---|---|---|---|---|---|---|
| T1 | 语言面板：空查询列全量、子串筛选与排序、锚点参数化、高亮滚入可见 | 主 Agent | `src/renderer/src/editor/wysiwyg.ts`（`updateLangSuggest` `moveLangIndex` `openLangEditor` `LANG_SUGGEST_LIMIT`） | 新建代码块时即时选择语言；既有代码块的语言修改沿用同一列表 | - | 点开胶囊即可看到全部语言（≥150 项，可滚动）；输入 `scr` 只剩名字含 `scr` 的项且前缀命中在前；高亮移动到底部时列表自动滚动 | 完成 |
| T2 | 空格唤起待转换状态：命中「围栏 + 空格」不再直接成块，改为登记并打开面板 | 主 Agent | `wysiwyg.ts`（`matchBlockInputRule` `applyBlockInputRule` 的 `fence` 分支；新增 `pendingFence` 与打开方法） | 新建代码块时即时选择语言 | T1 | 键入三反引号加空格后段落仍是普通段落元素、文本保留三反引号，面板出现并列出全部语言；不生成 `pre.md-fences` | 完成 |
| T3 | 回车确认与取消：候选/查询/空语言三种落点，Esc 与失焦不转换 | 主 Agent | `wysiwyg.ts`（`applyEnterBlockRules`、待转换提交方法、`handleLangKeydown` `handleLangFocusOut`） | 新建代码块时即时选择语言 | T2 | 高亮 `javascript` 回车得到 `lang="javascript"` 的块且光标在代码体；未筛选直接回车得到无 `lang` 的块；Esc 与点击别处都不成块 | 完成 |
| T4 | 去掉「带出上次语言」兜底 | 主 Agent | `wysiwyg.ts`（`convertToFence` `toggleCodeFence` `commitLangEdit`，删除 `lastCodeLang`） | 新建代码块时即时选择语言 | T3 | 先建一个 `python` 块，再新建围栏并直接回车，新块没有 `lang` 属性；`rg lastCodeLang src/` 无命中 | 完成 |
| T5 | 补 parity 断言：覆盖全量列表、筛选、回车成块、直接回车、Esc 取消、不沿用上次语言 | subagent | `scripts/parity/checks.mjs` | 新建代码块时即时选择语言；既有代码块的语言修改沿用同一列表 | T4 | 新增 ≥5 条 check，`node scripts/parity/run.mjs --only input` 全部 PASS 且无回退 | 完成 |
| T6 | 全量回归：类型检查、lint、144 条 parity 全跑 | 后台 | `npm run typecheck` `npm run lint` `node scripts/parity/run.mjs` | 两条需求共同验收 | T5 | `typecheck` 与 `lint` 退出码 0；parity 的 PASS 数不低于基线 141，新增断言全部 PASS | 完成 |

## 任务详情

### T1 语言面板

- 步骤：
  1. `updateLangSuggest`（wysiwyg.ts:3006）：查询为空时不再 `hideLangSuggest`，改为列出全部语言；匹配由 `startsWith` 改为大小写不敏感子串，名称以查询开头者优先、其次按名称长度、再按 `localeCompare`；删掉 `LANG_SUGGEST_LIMIT` 的 `slice` 截断。
  2. 删除默认高亮：空查询时不把首项标成 `md-active`（现状 §3030 无条件高亮首项），只有方向键移动或键入字符后才产生高亮——delta-spec 要求空列表「默认没有高亮项」，直接回车因此得到无语言块。
  3. 同函数 3037-3043：把「定位只认当前胶囊」改成接收锚点元素（新建路径锚段落，胶囊路径锚胶囊），面板固定定位逻辑不变。
  4. `moveLangIndex`（3047）：高亮变化后把新高亮项滚入面板可见区。
  5. `openLangEditor`（2919）：以胶囊现有语言为初始查询继续复用同一面板。
- 验收命令：`npm run build && node scripts/parity/run.mjs --only input`（期望：现有 input 断言无新增 FAIL）
- 自检：胶囊为空时点开必须看到全量列表而不是空面板；输入 `scr` 后 `javascript`、`coffeescript` 在前；列表滚到底时面板不溢出窗口。

### T2 空格唤起待转换状态

- 步骤：
  1. `matchBlockInputRule`（2172）命中围栏后不要再走 `deleteOffsets` 与 `convertToFence`：改为记录 `pendingFence = { block, query }`（`query` 取空格之前、围栏标记之后的片段）。
  2. 打开面板，锚点为该段落，初始查询为 `query`。
  3. 已有的 `applyBlockInputRule` 里 `case 'fence'`（2271）保留给回车快捷通道，不删除。
  4. 面板打开期间再次命中同一条规则只刷新查询，不重复登记。
- 验收命令：`npm run build && node scripts/parity/run.mjs --only input`（期望：无新增 FAIL，`input.fence` 仍 PASS）
- 自检：段落文本在面板打开时保持不变（``` 或 ```py，不出现被删掉标记的空段落）；连续打两个空格不产生两个面板。

### T3 回车确认与取消

- 步骤：
  1. 按键拦截：待转换状态下，段落仍是普通段落元素、光标在段落里，方向键与 Esc 的默认行为必须先被吃掉——在编辑器 keydown 里判断 `pendingFence` 存在时 `preventDefault` + `stopPropagation`，ArrowUp/ArrowDown 转给 `moveLangIndex`，Esc 走取消，Enter 交给下一步；否则方向键会在段落里移动光标、Esc 会什么都发生不了。
  2. `applyEnterBlockRules`（2401）开头判断 `pendingFence`：有则取「当前高亮候选 → 已键入查询 → 空」三级落点，删掉段落里的围栏标记与查询文本，调用 `convertToFence(block, lang)` 并在转换后清空状态。
  3. 取消路径：Esc 与编辑区 root 上的 `focusout`（焦点离开该段落）都关闭面板、清空 `pendingFence`，不改段落文本，不转换。
  4. 转换前校验 `block.isConnected`；不通过则丢弃状态、关面板。
  5. 光标落点：转换后光标位于代码体首行（沿用 `convertToFence` 现有实现）。
- 验收命令：`npm run build && node scripts/parity/run.mjs --only input`（期望：无新增 FAIL）
- 自检：三种落点各试一次（选中 javascript / 输入 `py` 不选 / 什么都不打）；Esc 后段落里的 ```py 文本仍在且可退格删除；点击其它段落后面板关闭且不生成代码块。

### T4 去掉上次语言兜底

- 步骤：
  1. 删除 `wysiwyg.ts:111-112` 的 `lastCodeLang` 变量。
  2. `convertToFence`（2290）：语言只来自入参，不再回落 `lastCodeLang`。
  3. `toggleCodeFence`（1402，菜单与快捷键插入代码块）：新建围栏一律空语言。
  4. `commitLangEdit`（3082）：删除写回 `lastCodeLang` 的语句（改完语言后只更新 `lang` 属性）。
- 验收命令：`npm run build && node scripts/parity/run.mjs --only input`（期望：无新增 FAIL）；`rg lastCodeLang src/`（期望：无输出）
- 自检：改语言后关闭再开新围栏，新围栏不带上一块的语言；菜单「插入代码块」得到的也是空语言块。

### T5 补 parity 断言

- 步骤（全部在 `scripts/parity/checks.mjs`，用 `H.type` / `H.key` / `H.count` / `H.attr` 等既有 helper，probe 内不许写 DOM）：
  1. `input.fence-lang-list`：键入三反引号加空格后 `H.count('.typora-lang-suggest:not([hidden]) li')` ≥ 150。
  2. `input.fence-lang-filter`：接着键入 `scr`，列表项全部包含 `scr`，且首项为 `javascript` 或 `coffeescript`。
  3. `input.fence-lang-enter`：键入选中的语言后回车，`pre.md-fences` 的 `lang` 等于所选语言，`code` 的 class 含 `language-` 前缀加该语言名。
  4. `input.fence-lang-enter-empty`：只打空格后回车，`pre.md-fences` 存在且没有 `lang` 属性。
  5. `input.fence-lang-esc`：打空格后按 `Escape`，没有 `pre.md-fences`，列表已隐藏。
  6. `input.fence-lang-no-remember`：先建 `python` 块再新建并直接回车，`lang` 为空。
- 验收命令：`npm run build && node scripts/parity/run.mjs --only input`（期望：新增 6 条全 PASS，原有 input 断言不回归）
- 自检：每条 check 都有 `initial` 或在 probe 内先 `H.focus()`；probe 的 `expect` 与 `actual` 结构一致，FAIL 时能一眼看出差在哪一列。

### T6 全量回归

- 步骤：
  1. `npm run typecheck`
  2. `npm run lint`
  3. `npm run build` 后 `node scripts/parity/run.mjs`（约 6 分钟）
- 验收命令：`npm run typecheck && npm run lint && npm run build && node scripts/parity/run.mjs`（期望：typecheck 与 lint 退出码 0；parity 末行 PASS 数 ≥ 141，新增 6 条全 PASS）
- 自检：对比基线 141 PASS 的失败清单，确认没有把已知的 3 条 harness 局限换成新的产品缺陷。

## 测试策略

TDD：每任务至少先有失败断言（seam = `scripts/parity/checks.mjs` 的 `input.*` 断言），验收命令必须包含 `node scripts/parity/run.mjs --only input`。执行顺序把 T5 前移为红阶段，T1-T4 逐条转绿，T6 收尾。

## 执行顺序

1. T1
2. T2
3. T3
4. T4
5. T5
6. T6

全部串行：T1-T4 改同一个文件，不能并行；T5 依赖 T4 的行为定稿；T6 是 T5 之后的整体回归。若无并行需求，本波次只有一条链。

## 覆盖检查

- 新建代码块时即时选择语言 → T1、T2、T3、T4、T5
- 既有代码块的语言修改沿用同一列表 → T1、T5

## 自检（落盘前）

- [x] 每条需求都被至少一个任务覆盖
- [x] 每个任务都有可复制执行的验收命令
- [x] 依赖无环（T1→T2→T3→T4→T5→T6 单链）
- [x] `方式` 只取 `主 Agent` / `subagent` / `后台`
- [x] 模板里的占位符与注释全部替换
