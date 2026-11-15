---
status: done
us: US-20261115204338-0004-代码块语言徽标与补全
---

# 增量设计

## Context

代码块的语言呈现完全照抄原版 Typora 的 DOM 与 CSS —— 这些值是从解包出来的 `appsrc/window/frame.js` 与 `style/base-control.css` 里直接挖出来的，不是凭截图猜的。

## Decisions

### 复用原版 DOM 与类名
原版在 `pre.md-fences` 的第 1 个子节点插入：
```html
<div class="code-tooltip md-tooltip-remove" align="right" contenteditable="false">
  <span class="ty-input ty-input-after ty-cm-lang-input" contenteditable tabindex="-1" placeholder="代码块语言">js</span>
</div>
```
用同一套类名的好处：`md-tooltip-remove` 这个类名在原版里就是「序列化时跳过」的标记，我们的 `dom-to-markdown` 与查找栏都直接沿用它做过滤，语义一致。

### 可见性用 CSS 而不是增删 DOM
原版是「聚焦时创建、失焦时移除」。我们改成常驻节点 + `.md-fences.md-focus / :hover` 显示，避免在 contenteditable 里频繁增删节点引发选区抖动。代价是未聚焦时节点仍在，因此序列化与查找栏必须过滤——两处都加了。

### 围栏不再裁剪
原版胶囊挂在 `bottom:-2.5em`，即块外。我们的 `pre.md-fences` 原本是 `overflow:auto`，会把它裁掉（第一版实现就是这样，DOM 有、屏幕上看不见）。修法是把滚动下移到 `code`，`pre` 改 `overflow:visible`。

### 语法高亮的类名早就对，缺的是配色
排查发现 `hljs-keyword` 等 class 都正确产出，但全仓没有一条 `.hljs-*` 规则，所以整块只有正文色。补的是原版 CodeMirror 的调色板（`style/codemirror.css` 的 `.cm-s-inner` 与 `night/codeblock.dark.css`），映射表与出处逐条记在 `task.md`。

## Risks / Trade-offs

- **裸标识符无法着色**：hljs 对 `const a = 1` 只给 `const` 和 `1` 包 span，`a` 与 `=` 是裸文本；原版 CodeMirror 会分别标 `cm-def` / `cm-operator`。纯 CSS 够不到未包 span 的文本，要对齐得在渲染层给标识符/运算符补 span。当前差的就是这两处。
- **newsprint 灰底**上 4 个 token 对比度低于 3:1（原版同样如此），按「与 Typora 一致」优先于「可读性」，未做改良。
