import type { MarkdownIt } from 'markdown-it'
import type { StateBlock, StateCore, StateInline, Token } from 'markdown-it'

/** Typora's five GitHub-style callouts; the CSS hook is `md-alert md-alert-<type>`. */
export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type AlertType = (typeof ALERT_TYPES)[number]

export const ALERT_TITLES: Record<AlertType, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
}

const ALERT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*/i

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Mirrors markdown-it's own reference normalisation, otherwise lookups miss. */
function normalizeLabel(label: string): string {
  const collapsed = label.trim().replace(/\s+/g, ' ')
  if ('ẞ'.toLowerCase() === 'ß') {
    return collapsed.normalize('NFKC').toUpperCase().toLowerCase().toUpperCase()
  }
  return collapsed.toUpperCase()
}

function pushTextToken(
  state: StateInline,
  type: string,
  tag: string,
  content: string,
  markup: string
): void {
  const token = state.push(type, tag, 0)
  token.content = content
  token.markup = markup
}

function pairedRule(
  marker: string,
  type: string,
  tag: string
): (state: StateInline, silent: boolean) => boolean {
  return (state: StateInline, silent: boolean): boolean => {
    const src = state.src
    const start = state.pos
    if (!src.startsWith(marker, start)) return false
    if (marker === '~' && src.charCodeAt(start + 1) === 0x7e) return false
    if (marker === '^' && /[\s]/.test(src[start + 1] ?? ' ')) return false
    const end = src.indexOf(marker, start + marker.length)
    if (end <= start + marker.length) return false
    const body = src.slice(start + marker.length, end)
    if (body === '' || /[\n]/.test(body)) return false
    if (marker !== '==' && /[\s]/.test(body[body.length - 1])) return false
    if (!silent) pushTextToken(state, type, tag, body, marker)
    state.pos = end + marker.length
    return true
  }
}

function commentRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (!src.startsWith('<!--', start)) return false
  const end = src.indexOf('-->', start + 4)
  if (end < 0) return false
  if (!silent) pushTextToken(state, 'md_comment', 'span', src.slice(start + 4, end), '<!--')
  state.pos = end + 3
  return true
}

function footnoteRefRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  const start = state.pos
  if (!src.startsWith('[^', start)) return false
  const end = src.indexOf(']', start + 2)
  if (end < 0) return false
  const label = src.slice(start + 2, end)
  if (label === '' || /[\s]/.test(label)) return false
  if (!silent) pushTextToken(state, 'md_fn_ref', 'sup', label, '[^]')
  state.pos = end + 1
  return true
}

function lineAt(state: StateBlock, line: number): string {
  const start = state.bMarks[line] + state.tShift[line]
  const end = state.eMarks[line]
  return state.src.slice(start, end)
}

function blockStart(state: StateBlock, startLine: number): boolean {
  return state.sCount[startLine] - state.blkIndent < 4
}

function defLinkRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean
): boolean {
  if (!blockStart(state, startLine)) return false
  const line = lineAt(state, startLine)
  const match = /^\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+"([^"]*)")?[ \t]*$/.exec(line)
  if (!match) return false
  if (silent) return true
  const label = match[1]
  const href = match[2]
  const title = match[3] ?? ''
  const references = state.env.references ?? (state.env.references = {})
  references[normalizeLabel(label)] = { href, title }
  const token = state.push('md_def_link', 'div', 0)
  token.content = line
  token.markup = 'reference'
  token.map = [startLine, startLine + 1]
  state.line = startLine + 1
  return true
}

function footnoteDefRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean
): boolean {
  if (!blockStart(state, startLine)) return false
  const line = lineAt(state, startLine)
  const match = /^\[\^([^\]]+)\]:[ \t]?(.*)$/.exec(line)
  if (!match) return false
  if (silent) return true
  const token = state.push('md_fn_def', 'div', 0)
  token.content = match[2]
  token.info = match[1]
  token.markup = 'footnote'
  token.map = [startLine, startLine + 1]
  state.line = startLine + 1
  return true
}

function alertCoreRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'blockquote_open') continue
    let j = i + 1
    while (
      j < tokens.length &&
      tokens[j].type !== 'inline' &&
      tokens[j].type !== 'blockquote_close'
    ) {
      j += 1
    }
    if (j >= tokens.length || tokens[j].type !== 'inline') continue
    const inline = tokens[j]
    const children = inline.children
    if (!children || children.length === 0) continue
    const first = children[0]
    if (first.type !== 'text') continue
    const match = ALERT_MARKER_RE.exec(first.content)
    if (!match) continue
    const type = match[1].toLowerCase()
    first.content = first.content.slice(match[0].length)
    inline.content = inline.content.replace(ALERT_MARKER_RE, '')
    while (
      children.length > 0 &&
      (children[0].type === 'softbreak' ||
        (children[0].type === 'text' && children[0].content === ''))
    ) {
      children.shift()
    }
    tokens[i].attrSet('class', 'md-alert md-end-block md-alert-' + type)
    const title = new state.Token('html_block', '', 0)
    title.content =
      '<p class="md-alert-text md-alert-text-' +
      type +
      '">' +
      escapeHtml(ALERT_TITLES[type as AlertType] ?? type) +
      '</p>'
    tokens.splice(i + 1, 0, title)
    if (inline.content.trim() === '') tokens.splice(j, 3)
  }
}

function collectHeadings(tokens: Token[]): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const open = tokens[i]
    if (open.type !== 'heading_open') continue
    const inline = tokens[i + 1]
    if (!inline || inline.type !== 'inline') continue
    headings.push({
      level: Number(open.tag.slice(1)),
      text: (inline.content ?? '').replace(/[*_`~[\]]/g, '').trim()
    })
  }
  return headings
}

function tocCoreRule(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'paragraph_open') continue
    const inline = tokens[i + 1]
    if (!inline || inline.type !== 'inline' || inline.content.trim() !== '[TOC]') continue
    const headings = collectHeadings(tokens)
    const items = headings
      .map(
        (heading) =>
          '<span class="md-toc-item md-toc-h' +
          heading.level +
          '"><a class="md-toc-inner">' +
          escapeHtml(heading.text) +
          '</a></span>'
      )
      .join('')
    const token = new state.Token('md_toc', 'div', 0)
    token.content = '<div class="md-toc-content">' + items + '</div>'
    token.block = true
    token.map = tokens[i].map ?? null
    tokens.splice(i, 3, token)
  }
}

/**
 * Typora-only Markdown surface: `==mark==`, `^sup^`, `~sub~`, `<!-- comment -->`,
 * footnote refs/definitions, `[label]: url` definitions that stay visible, `[TOC]`
 * and the five `> [!NOTE]`-style callouts.
 */
export function installExtensions(md: MarkdownIt): void {
  md.inline.ruler.after('emphasis', 'md_mark', pairedRule('==', 'md_mark', 'mark'))
  md.inline.ruler.after('emphasis', 'md_sup', pairedRule('^', 'md_sup', 'sup'))
  md.inline.ruler.after('strikethrough', 'md_sub', pairedRule('~', 'md_sub', 'sub'))
  md.inline.ruler.before('html_inline', 'md_comment', commentRule)
  md.inline.ruler.before('link', 'md_fn_ref', footnoteRefRule)

  md.block.ruler.before('reference', 'md_fn_def', footnoteDefRule)
  md.block.ruler.before('reference', 'md_def_link', defLinkRule)

  md.core.ruler.after('inline', 'md_alert', alertCoreRule)
  md.core.ruler.after('md_alert', 'md_toc', tocCoreRule)

  md.renderer.rules.md_mark = (tokens, idx): string =>
    '<mark>' + escapeHtml(tokens[idx].content) + '</mark>'
  md.renderer.rules.md_sup = (tokens, idx): string =>
    '<sup>' + escapeHtml(tokens[idx].content) + '</sup>'
  md.renderer.rules.md_sub = (tokens, idx): string =>
    '<sub>' + escapeHtml(tokens[idx].content) + '</sub>'
  md.renderer.rules.md_comment = (tokens, idx): string =>
    '<span class="md-comment">' + escapeHtml(tokens[idx].content) + '</span>'
  md.renderer.rules.md_fn_ref = (tokens, idx): string => {
    const label = escapeHtml(tokens[idx].content)
    return '<sup class="md-footnote"><a href="#fn-' + label + '">' + label + '</a></sup>'
  }
  md.renderer.rules.md_fn_def = (tokens, idx): string =>
    '<div class="footnotes md-def-footnote md-end-block" data-label="' +
    escapeHtml(tokens[idx].info) +
    '"><p class="md-footnote-line">' +
    escapeHtml(tokens[idx].content) +
    '</p></div>\n'
  md.renderer.rules.md_def_link = (tokens, idx): string =>
    '<div class="md-def-link md-end-block">' + escapeHtml(tokens[idx].content) + '</div>\n'
  md.renderer.rules.md_toc = (tokens, idx): string =>
    '<div class="md-toc md-end-block">' + tokens[idx].content + '</div>\n'
}
