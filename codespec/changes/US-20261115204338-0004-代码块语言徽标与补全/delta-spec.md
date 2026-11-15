---
status: done
us: US-20261115203000-0004-代码块语言徽标与补全
---

# 增量规格：代码块的语言徽标与语言补全

## Purpose

用户反馈：代码块不会提示用哪种语言，也不会在右下角显示语言。原版 Typora 在这两处都有一致的呈现，本变更补齐。

## Requirements

### Requirement: 语言徽标

代码块获得焦点或鼠标悬停时，SHALL 在其右下角（框下方 2.5em 处、右边缘对齐）显示当前语言，未设置语言时显示占位文案「代码块语言」。

#### Scenario: 已设置语言的代码块

- **WHEN** 文档里有一个 ` ```js ` 代码块，点击进入该块
- **THEN** 块下方右侧出现宽度约 181 逻辑像素的浅色胶囊，居中显示 `js`

#### Scenario: 未设置语言的代码块

- **WHEN** 通过 ` ``` ` 加空格新建代码块
- **THEN** 胶囊显示占位文案「代码块语言」，提示可以指定语言

### Requirement: 点击修改语言

点击胶囊 SHALL 进入可编辑状态；输入语言名后回车或失焦 SHALL 提交，写回 Markdown 的围栏信息串。

#### Scenario: 修改语言

- **WHEN** 用户点开胶囊，把 `js` 改成 `python` 并回车
- **THEN** 代码块用 Python 高亮，Markdown 里围栏变成 ` ```python `

### Requirement: 语言补全

在胶囊里输入时 SHALL 弹出候选列表，方向键选择、回车确认。

#### Scenario: 输入前缀

- **WHEN** 用户在胶囊里输出 `py`
- **THEN** 候选里出现 `python`，回车后语言变为 python
