import MarkdownIt from 'markdown-it'
import type { StateCore, StateInline, Token } from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import type { LanguageFn } from 'highlight.js'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import katex from 'katex'
import { installExtensions } from './md-extensions'

const LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  markdown,
  perl,
  php,
  plaintext,
  python,
  r,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml
}

for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition)

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char])
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml'
    })
  } catch {
    return '<span class="katex-error">' + escapeHtml(tex) + '</span>'
  }
}

/** Typora's block math container: `div.md-math-block` carrying the TeX in a data attribute. */
export function renderMathBlockHtml(tex: string, number?: string): string {
  const badge = number === undefined ? '' : '<span class="md-math-number">(' + number + ')</span>'
  const numberAttr = number === undefined ? '' : ' data-number="' + number + '"'
  return (
    '<div class="md-math-block md-end-block" contenteditable="false" data-math="' +
    escapeHtml(tex) +
    '"' +
    numberAttr +
    '>' +
    renderKatex(tex, true) +
    badge +
    '</div>\n'
  )
}

/** Typora's inline math container: `span.md-inline-math` carrying the TeX in a data attribute. */
export function renderMathInlineHtml(tex: string): string {
  return (
    '<span class="md-inline-math" data-math="' +
    escapeHtml(tex) +
    '">' +
    renderKatex(tex, false) +
    '</span>'
  )
}

function renderDiagramHtml(code: string): string {
  return (
    '<div class="md-diagram md-end-block" contenteditable="false" data-mermaid="' +
    escapeHtml(code) +
    '"></div>\n'
  )
}

function highlightCode(code: string, lang: string): string {
  if (!lang || !hljs.getLanguage(lang)) return escapeHtml(code)
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(code)
  }
}

/** Typora's language pill: first child of the fence, hidden until the block is active. */
function codeTooltip(lang: string): string {
  return (
    '<div class="code-tooltip md-tooltip-remove" align="right" contenteditable="false">' +
    '<span class="ty-input ty-input-after ty-cm-lang-input" contenteditable tabindex="-1"' +
    ' autocorrect="false" placeholder="代码块语言">' +
    (lang === '' ? '' : escapeHtml(lang)) +
    '</span></div>'
  )
}

/** Registered highlight.js languages plus the diagram engines and the usual aliases. */
export function listCodeLanguages(): string[] {
  const names = new Set<string>(hljs.listLanguages())
  for (const extra of [
    'mermaid',
    'sequence',
    'flow',
    'text',
    'plaintext',
    'js',
    'ts',
    'jsx',
    'tsx',
    'py',
    'rb',
    'sh',
    'bash',
    'shell',
    'c',
    'cpp',
    'cs',
    'java',
    'go',
    'rs',
    'kt',
    'php',
    'sql',
    'html',
    'css',
    'scss',
    'less',
    'json',
    'yaml',
    'yml',
    'xml',
    'md',
    'markdown',
    'diff',
    'toml',
    'ini',
    'dockerfile',
    'makefile'
  ]) {
    names.add(extra)
  }
  return Array.from(names).sort((left, right) => left.localeCompare(right))
}

function fenceGutter(code: string): string {
  const lines = code.split('\n')
  const count = code.endsWith('\n') ? lines.length - 1 : lines.length
  const numbers = Array.from({ length: Math.max(1, count) }, (_value, index) => index + 1).join(
    '\n'
  )
  return (
    '<span class="md-fences-gutter" contenteditable="false" aria-hidden="true">' +
    numbers +
    '</span>'
  )
}

function renderFence(token: Token): string {
  const info = token.info.trim()
  const lang = (info.split(/\s+/)[0] ?? '').toLowerCase()
  const code = token.content
  if (lang === 'mermaid' && renderOptions.diagrams) return renderDiagramHtml(code)
  if (lang === 'math' || lang === 'latex' || lang === 'katex') return renderMathBlockHtml(code)
  const langAttr = lang ? ' lang="' + escapeHtml(lang) + '"' : ''
  const codeClass = lang ? ' class="language-' + escapeHtml(lang) + ' hljs"' : ' class="hljs"'
  const classes = renderOptions.codeLineNumbers
    ? 'md-fences md-end-block md-fences-with-lineno'
    : 'md-fences md-end-block'
  const gutter = renderOptions.codeLineNumbers ? fenceGutter(code) : ''
  return (
    '<pre class="' +
    classes +
    '"' +
    langAttr +
    '>' +
    codeTooltip(lang) +
    gutter +
    '<code' +
    codeClass +
    '>' +
    highlightCode(code, lang) +
    '</code></pre>\n'
  )
}

function renderCodeBlock(token: Token): string {
  return (
    '<pre class="md-fences md-end-block">' +
    codeTooltip('') +
    '<code class="hljs">' +
    escapeHtml(token.content) +
    '</code></pre>\n'
  )
}

const MATH_BLOCK_RE = /^\s*\$\$\s*\r?\n([\s\S]*?)\r?\n\s*\$\$\s*$/

/**
 * `$$\n…\n$$` reaches the token stream as an ordinary paragraph; promote it to a
 * block math token so the renderer can emit the Typora math container.
 */
function mathBlockRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'paragraph_open') continue
    const inline = tokens[i + 1]
    const closing = tokens[i + 2]
    if (!inline || inline.type !== 'inline' || !closing || closing.type !== 'paragraph_close') {
      continue
    }
    const match = MATH_BLOCK_RE.exec(inline.content)
    if (!match) continue
    const token = new state.Token('math_block', 'div', 0)
    token.block = true
    token.level = tokens[i].level
    token.content = match[1]
    tokens.splice(i, 3, token)
  }
}

const MATH_INLINE_MAX_LENGTH = 2000

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (src.charCodeAt(start) !== 0x24) return false

  const double = src.charCodeAt(start + 1) === 0x24
  const markerLength = double ? 2 : 1
  const contentStart = start + markerLength
  if (contentStart >= src.length) return false
  if (!double && /\s/.test(src[contentStart])) return false

  let pos = contentStart
  while (pos < src.length) {
    const char = src[pos]
    if (char === '\\') {
      pos += 2
      continue
    }
    if (pos - contentStart > MATH_INLINE_MAX_LENGTH) return false
    if (char === '$') {
      if (double && src[pos + 1] !== '$') {
        pos += 1
        continue
      }
      const content = src.slice(contentStart, pos)
      if (content.trim() !== '' && !/\s$/.test(content)) {
        if (!silent) {
          const token = state.push('math_inline', 'span', 0)
          token.content = content
          token.markup = double ? '$$' : '$'
        }
        state.pos = pos + markerLength
        return true
      }
    }
    pos += 1
  }
  return false
}

const TASK_RE = /^\[([ xX])\][ \t]+/

/**
 * Rewrites `- [ ] item` list items into Typora's task list contract: the item gets
 * md-task-list-item (plus done/not-done) and a real checkbox is injected inline.
 */
function taskListRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'list_item_open') continue
    let j = i + 1
    while (
      j < tokens.length &&
      tokens[j].type !== 'inline' &&
      tokens[j].type !== 'list_item_close'
    ) {
      j += 1
    }
    if (j >= tokens.length || tokens[j].type !== 'inline') continue
    const inline = tokens[j]
    const children = inline.children
    if (!children || children.length === 0) continue
    const first = children[0]
    if (first.type !== 'text') continue
    const match = TASK_RE.exec(first.content)
    if (!match) continue

    const checked = match[1].toLowerCase() === 'x'
    first.content = first.content.slice(match[0].length)
    const checkbox = new state.Token('html_block', '', 0)
    checkbox.content =
      '<input type="checkbox" class="task-list-item-checkbox"' + (checked ? ' checked' : '') + '>'
    tokens.splice(i + 1, 0, checkbox)
    tokens[i].attrSet(
      'class',
      'md-list-item task-list-item md-task-list-item task-list-' + (checked ? 'done' : 'not-done')
    )
  }
}

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  breaks: false
})

installExtensions(md)
md.core.ruler.push('md_math_block', mathBlockRule)
md.core.ruler.after('inline', 'md_task_list', taskListRule)
md.inline.ruler.before('escape', 'md_math_inline', mathInlineRule)

md.renderer.rules.heading_open = (tokens, idx): string =>
  '<' + tokens[idx].tag + ' class="md-end-block">'
md.renderer.rules.heading_close = (tokens, idx): string => '</' + tokens[idx].tag + '>\n'
md.renderer.rules.paragraph_open = (tokens, idx): string =>
  tokens[idx].hidden ? '' : '<p class="md-end-block md-p">'
md.renderer.rules.blockquote_open = (tokens, idx): string =>
  '<blockquote class="' +
  escapeHtml(String(tokens[idx].attrGet('class') ?? 'md-end-block')) +
  '">\n'
md.renderer.rules.bullet_list_open = (tokens, idx): string => {
  const mark = tokens[idx].markup === '*' || tokens[idx].markup === '+' ? tokens[idx].markup : '-'
  return '<ul class="ul-list" data-mark="' + mark + '">\n'
}
md.renderer.rules.ordered_list_open = (tokens, idx): string => {
  const start = tokens[idx].attrGet('start')
  const startAttr = start === null || String(start) === '1' ? '' : ' start="' + String(start) + '"'
  return '<ol class="ol-list"' + startAttr + '>\n'
}
md.renderer.rules.list_item_open = (tokens, idx): string => {
  const cls = tokens[idx].attrGet('class')
  return '<li class="' + escapeHtml(cls === null ? 'md-list-item' : String(cls)) + '">'
}
md.renderer.rules.table_open = (): string =>
  '<div class="md-table md-table-fig md-end-block">\n<table class="md-table">\n'
md.renderer.rules.table_close = (): string => '</table>\n</div>\n'
md.renderer.rules.hr = (): string => '<hr class="md-hr md-end-block">\n'
md.renderer.rules.softbreak = (): string => '<br class="md-softbreak">' + breakMarker()
// The default rule emits "<br>\n"; that stray newline becomes a text node inside the
// paragraph and would survive the round-trip as an extra blank line.
md.renderer.rules.hardbreak = (): string => '<br>' + breakMarker()
md.renderer.rules.fence = (tokens, idx): string => renderFence(tokens[idx])
md.renderer.rules.code_block = (tokens, idx): string => renderCodeBlock(tokens[idx])
let mathNumber = 0
md.renderer.rules.math_block = (tokens, idx): string => {
  if (!renderOptions.autoNumber) return renderMathBlockHtml(tokens[idx].content)
  mathNumber += 1
  return renderMathBlockHtml(tokens[idx].content, String(mathNumber))
}
md.renderer.rules.math_inline = (tokens, idx): string => renderMathInlineHtml(tokens[idx].content)

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

interface SplitDocument {
  meta: string | null
  body: string
}

function splitFrontMatter(markdown: string): SplitDocument {
  const normalized = markdown.replace(/^\uFEFF/, '')
  const match = FRONT_MATTER_RE.exec(normalized)
  if (!match) return { meta: null, body: normalized }
  return { meta: match[1], body: normalized.slice(match[0].length) }
}

function renderMetaBlock(meta: string): string {
  return '<pre class="md-meta-block md-end-block">' + escapeHtml(meta) + '\n</pre>\n'
}

export interface RenderOptions {
  /** draw a visible marker next to every <br> */
  showBr: boolean
  /** render-time dash/ellipsis/quote conversion (markdown-it typographer) */
  smartPunctuation: boolean
  /** parse Unicode punctuation as its ASCII Markdown equivalent */
  remapPunctuation: boolean
  /** strict GFM: raw HTML is rendered as text instead of being passed through */
  strictMode: boolean
  /** `$tex$` becomes inline math */
  inlineMath: boolean
  /** `~sub~` becomes a subscript */
  subscript: boolean
  /** `^sup^` becomes a superscript */
  superscript: boolean
  /** `==mark==` becomes a highlight */
  highlight: boolean
  /** mermaid fences render as diagrams instead of code blocks */
  diagrams: boolean
  /** show a line-number gutter inside fenced code */
  codeLineNumbers: boolean
  /** number block math (`(1)`, `(2)`, …) */
  autoNumber: boolean
}

const renderOptions: RenderOptions = {
  showBr: false,
  smartPunctuation: true,
  remapPunctuation: true,
  strictMode: false,
  inlineMath: true,
  subscript: true,
  superscript: true,
  highlight: true,
  diagrams: true,
  codeLineNumbers: false,
  autoNumber: false
}

function toggleInlineRule(name: string, enabled: boolean): void {
  if (enabled) md.inline.ruler.enable(name, true)
  else md.inline.ruler.disable(name, true)
}

// markdown-it is constructed with typographer:false and html:true, so the defaults apply here
md.options.typographer = renderOptions.smartPunctuation
md.options.html = !renderOptions.strictMode

const UNICODE_PUNCTUATION: [RegExp, string][] = [
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u2013\u2014]/g, '-'],
  [/\u2026/g, '...']
]

function remapUnicodePunctuation(source: string): string {
  let output = source
  for (const [pattern, replacement] of UNICODE_PUNCTUATION)
    output = output.replace(pattern, replacement)
  return output
}

/** A zero-width span so the marker can be painted by CSS without touching the text. */
function breakMarker(): string {
  return renderOptions.showBr ? '<span class="md-br-mark"></span>' : ''
}

/** Applies render options; returns true when at least one of them actually changed. */
export function setRenderOptions(patch: Partial<RenderOptions>): boolean {
  let changed = false
  const assign = (key: keyof RenderOptions, value: boolean | undefined): void => {
    if (value === undefined || value === renderOptions[key]) return
    renderOptions[key] = value
    changed = true
  }
  assign('showBr', patch.showBr)
  assign('smartPunctuation', patch.smartPunctuation)
  assign('remapPunctuation', patch.remapPunctuation)
  assign('strictMode', patch.strictMode)
  assign('inlineMath', patch.inlineMath)
  assign('subscript', patch.subscript)
  assign('superscript', patch.superscript)
  assign('highlight', patch.highlight)
  assign('diagrams', patch.diagrams)
  assign('codeLineNumbers', patch.codeLineNumbers)
  assign('autoNumber', patch.autoNumber)

  md.options.typographer = renderOptions.smartPunctuation
  md.options.html = !renderOptions.strictMode
  toggleInlineRule('md_math_inline', renderOptions.inlineMath)
  toggleInlineRule('md_sub', renderOptions.subscript)
  toggleInlineRule('md_sup', renderOptions.superscript)
  toggleInlineRule('md_mark', renderOptions.highlight)
  return changed
}

/** Smart punctuation (curly quotes / dashes) is a Markdown-level render option. */
export function setTypographer(enabled: boolean): void {
  setRenderOptions({ smartPunctuation: enabled })
}

const EMPTY_PARAGRAPH = '<p class="md-end-block md-p"><br></p>'

/** Renders Markdown into Typora's static DOM contract (`#write` children). */
export function renderMarkdown(markdown: string): string {
  const split = splitFrontMatter(markdown)
  const meta = split.meta
  const body = renderOptions.remapPunctuation ? remapUnicodePunctuation(split.body) : split.body
  const head = meta === null ? '' : renderMetaBlock(meta)
  mathNumber = 0
  const html = md.render(body)
  if (head === '' && html.trim() === '') return EMPTY_PARAGRAPH
  return head + html
}
