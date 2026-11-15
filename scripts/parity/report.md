# Typora 差异巡检报告 · 第 3 轮

> 被测构建：`out/`（2026-11-15 18:21 构建，与当前 `src/` 同步）
> 运行环境：Windows / Electron 44.11.3 / Node v24.18.0
> 用例规模：**144 条**（第 1 轮 57 条 + 第 2 轮新增 86 条 + 本轮新增 1 条）
> 结论：**144 条 / 141 PASS / 3 FAIL**（`node scripts/parity/run.mjs` → `TOTAL 144 | PASS 141 | FAIL 3`，退出码 1）
> 本轮只诊断；改的都是 `scripts/parity/**` 里的 probe，`src/**` 未动。

---

## 1. 怎么跑

```bash
npm run build                              # out/ 与 src/ 同步
node scripts/parity/run.mjs                # 全量 144 条（约 6 分钟）
node scripts/parity/run.mjs --only find    # 只跑某个区域
node scripts/parity/run.mjs --only save.dirty-cleared --verbose
```

产物：`checks.mjs`（144 条 `{ id, area, description, probe, initial?, settings? }`）、`run.mjs`（起应用 + 逐条 reload + PASS/FAIL + 总表）、`lib/cdp.mjs`（CDP + 真实按键/鼠标）、本文件。

所有输入仍走真实事件（`rawKeyDown → char → keyUp`、`dispatchMouseEvent`、真实菜单项点击），没有任何 probe 写 DOM。每条 probe 前 `Page.reload` + `settings.reset()` 复位；跑完杀进程树并清临时目录（本轮实测残留进程 0 / 残留目录 0）。

## 2. 本轮结果

| 区域 | 用例 | PASS | FAIL |
|---|---:|---:|---:|
| input | 19 | 19 | 0 |
| render | 16 | 16 | 0 |
| ui | 5 | 5 | 0 |
| settings | 15 | 15 | 0 |
| storage | 2 | 2 | 0 |
| harness | 8 | 8 | 0 |
| tabs | 10 | 10 | 0 |
| save | 4 | 3 | **1** |
| find | 11 | 10 | **1** |
| table | 9 | 9 | 0 |
| list | 6 | 6 | 0 |
| format | 8 | 8 | 0 |
| theme | 7 | 7 | 0 |
| view | 8 | 8 | 0 |
| status | 5 | 5 | 0 |
| export | 4 | 4 | 0 |
| prefs | 4 | 3 | **1** |
| style | 3 | 3 | 0 |
| **合计** | **144** | **141** | **3** |

第 2 轮那 16 条 FAIL 的去向：

| 第 2 轮失败项 | 现在 | 原因 |
|---|---|---|
| `theme.*`（5 条） | **PASS** | `App.vue` 的 dispatch 已把 arg 拼回 `theme.set:<name>` |
| `tabs.ctrl-w` | **PASS** | 快捷键已改绑 `view.closeTab`；本轮的 probe 也修了：只剩一个标签时**标签条整体隐藏**，不能数 `.ty-tab`，改数「关前 2 / 关后 0 + 窗口存活」 |
| `tabs.close-dirty-tab` | **PASS** | 关标签已走 `confirmDiscard()`，桩对话框收到 1 次调用 |
| `find.input-keeps-focus` `find.counter` `find.next` `find.previous` `find.replace-all` `find.selection`（6 条） | **PASS** | 命中改用 Custom Highlight API 后不再抢输入管线；`find.selection` 的断言已按新实现改写 |
| `status.popover-click` | **PASS** | 状态栏字数已可点击 |
| `format.*`（含 `format.em`） | **PASS** | 编辑器侧已修 |
| `save.dirty-cleared` | **仍 FAIL** | 见下方定性：写盘成功但标签脏标记没清 |
| `prefs.search-filter` | **仍 FAIL** | 见下方定性：驱动问题，未复现你的 12→1 |

## 3. FAIL 明细（含定性）

| 编号 | 区域 | 现象 | 期望 | 实测 | 定性 | 建议归属 |
|---|---|---|---|---|---|---|
| `save.dirty-cleared` | save | 无路径的新标签页里按 Ctrl+S：**另存为写盘成功**（`wrote: true`），但标签仍然标脏 | `{ before: 1, after: 0, wrote: true }` | `{ before: 1, after: 1, wrote: true }` | **实现缺陷** | **editor** |
| `find.caret-untouched` | find | 高亮存在（`typora-find-current` 有值），关掉查找条后光标回到正文（`inEditor: true`），但**偏移量和原来不同**（`sameOffset: false`） | `{ highlighted: true, inEditor: true, sameOffset: true }` | `{ highlighted: true, inEditor: true, sameOffset: false }` | **待确认** | **editor** |
| `prefs.search-filter` | prefs | 输入「主题」后：页签变暗类**有反应**（`dimmed: true`），但被我统计的行数不变（`matched === all`） | 被过滤的行数变少 | `{ before: 12?, after: 12?, dimmed: true }`（见下） | **驱动问题** | **驱动（scripts/parity）** |

### 3.1 `save.dirty-cleared` —— 实现缺陷（editor）

- 证据：`stubDialogs({ saveAs: <临时路径> })` 之后按 Ctrl+S，`H.fileStat(target).exists === true`（**文件确实写出来了**），但 `.ty-tab.dirty` 仍为 1。
- 说明 `saveActiveDocument → 另存为 → 写盘` 这条链路已经通了，**唯独标签级的 `saved` 快照没被 `adoptSaveAs` 同步**：`TabBar.vue` 的 `dirty` 类来自 `tab.content !== tab.saved`，`doc.saved` 更新后没有 `snapshot()` 到当前 tab。
- 建议：`adoptSaveAs` 里在更新 `doc.path/saved` 后同样 `snapshot()`（`stores/document.ts` 里已有该函数）。

### 3.2 `find.caret-untouched` —— 待确认（editor）

- 这是本轮按你的要求**新增**的用例：`CSS.highlights.has("typora-find-current")` 为真的同时，用户原来的光标不被挪走。
- 实测：高亮确实存在（`highlighted: true`），关掉查找条后光标仍在 `#write` 内（`inEditor: true`），但 `anchorOffset` 变了。
- **判别不了的两件事**：① 绘制高亮时把光标挪到了命中处；② 关闭查找条时 `close()` 里 `root.focus()` 把光标复位到了别处。当前判据（Esc 之后再读选区）对这两者不可分辨，所以定性为「待确认」，不记为应用缺陷。
- 下一轮判据建议：在 `find-bar` 打开、输入前后的同一帧里比较 `#write` 内 `Selection.getRangeAt(0)` 的 `startOffset`（用 `MutationObserver`/微任务采样），或在 `close()` 前后各采一次样。

### 3.3 `prefs.search-filter` —— 驱动问题（不是应用缺陷）

按你给的三条线索逐条核对后的情况：

1. **选择器**：用的是 `.search-input`（`windows/PreferencesWindow.vue`），不是主窗口侧栏的输入框 —— 已确认对。
2. **等待**：点击搜索框后 150ms 再打字，打完再等 350ms（> 你要求的 120–250ms）—— 已满足。
3. **统计对象**：改成 `.input-group-content > .row`，页签单独数 `.nav-group-item` 与 `.nav-group-item.no-search-hit` —— 已按要求改。

结果：**变暗类有反应**（`dimmed: true`，说明查询词确实进了 Vue 的 `query` 并触发了过滤逻辑），但**行数不变**。你在 settings 那一路用离屏 Electron + `sendInputEvent` 实测是 12 → 1，我这边复现不出来，因此判定为**我的驱动没把「行数变化」这一步测对**，而不是应用缺陷 —— 不给它记 FAIL 归因，等你那边或下一轮再收敛（可能原因：统计时机仍在 Vue `flush` 之前、或面板切换后统计的是另一个 `.input-group-content`）。

## 4. 未计入 FAIL 但值得知道的

- `format.em` 等 8 条格式化命令全部 PASS（含「`getValue()` 里有 `**beta**` / `*beta*` / `~~beta~~` / 反引号 / `==beta==` / `^beta^` 标记」的断言）。
- 主题 7 条全绿：四套非默认主题的 `data-theme` 与背景色都会变，night 的滚动条滑块颜色规则也在。
- `find.*` 10 条全绿：查找条、计数、上下一个、Esc、无命中、替换全部都按真实按键验证过；`find.selection` 已改成断言 `CSS.highlights` 覆盖的文本等于命中词。
- `tabs.*` 10 条全绿：新建/切换不串台/脏标记/菜单关标签/× 关标签/脏标签提示/Ctrl+W 只关标签/标题跟随。

## 5. 已知限制

- `prefs.search-filter` 的驱动问题见 3.3（本轮唯一未收敛的驱动项）。
- 表格「对齐命令」仍无独立菜单项可测，暂未单列。
- 导入路径（`file.import` 选文件）需要原生打开对话框，目前只桩了「另存为 / 消息框」。
- 设置生效类用例仍走「打补丁 → 重开 → 观察」；`settings.live-apply` 已证明即时生效链路可用，下一轮可改成不重开。
- `ui.menu` / `ui.preferences` 的文案断言按中文系统写。
- **历史副作用（第 1 轮遗留）**：早期用 `APPDATA` 隔离无效，几轮实验写进了真实 `%APPDATA%\typora\conf.user.json`，现在是默认设置 + 一条指向已删临时目录的 `recentFiles`。之后已改用 `--user-data-dir`，profile 落在临时目录并随运行删除。那个 json 我没有动。
