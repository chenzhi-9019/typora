---
status: done
us: US-20261115213400-0005-代码块语言输入
---

# Scope

## 目标范围

本次只改「代码块语言列表」这一条输入链路：`wysiwyg.ts` 内的围栏输入规则、待转换状态与语言面板，加上 `checks.mjs` 里对应的 parity 断言；由 delta-spec 的「新建代码块时即时选择语言」与「既有代码块的语言修改沿用同一列表」共同驱动。

## 可改（白名单）

- `src/renderer/src/editor/wysiwyg.ts`
- `scripts/parity/checks.mjs`

## 明确不动

- `src/shared/**`：IPC 频道名、类型与 `TyporaApi` 契约
- `src/main/**`、`src/preload/**`：主进程与预加载
- `src/renderer/src/editor/markdown-renderer.ts`：`listCodeLanguages()` 只读复用，不修改
- `src/renderer/src/components/**`、`stores/**`、`styles/**`：界面外壳与主题
- `src/renderer/src/editor/editor.css`：面板样式已满足（`max-height: 12em` + 滚动），本次不新增规则
- `codespec/specs/**`：基线只读，合并由收尾环节做
- `docs/arch.md`：本变更的架构块合并由收尾环节做
- `package.json`、`package-lock.json`：不新增依赖
- `codespec/changes/US-*` 下除本变更以外的目录
- `out/**`、`resources/**`：构建产物，只由构建命令生成，不手工编辑
- `tmp/**`：解包与探针的临时区

## 越界处置

停手，报「需要改 `<路径>`，因为 `<理由>`，对应 `<需求名>`」，拿到用户确认后才扩范围；不许先改了再解释。

## 与任务的一致性

白名单逐条对应 `task.md` 的「涉及文件 / 模块」列：T1-T4 落在 `wysiwyg.ts`，T5 落在 `checks.mjs`，T6 只跑命令不产生源码改动。`task.md` 新增任务时必须同步更新本文件，否则执行阶段会按旧边界拦人。
