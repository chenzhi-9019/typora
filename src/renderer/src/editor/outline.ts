import type { OutlineItem } from './index'

const ATX_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const FRONT_MATTER_RE = /^---[ \t]*$/
const FRONT_MATTER_END_RE = /^(?:---|\.\.\.)[ \t]*$/
const SETEXT_H1_RE = /^ {0,3}=+[ \t]*$/
const SETEXT_H2_RE = /^ {0,3}-{2,}[ \t]*$/
const BLOCK_START_RE = /^ {0,3}(?:[#>]|[-+*][ \t]|\d+[.)][ \t])/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\$\$?([^$]*)\$\$?/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Collects ATX/setext headings of a Markdown source. Fenced code blocks and the
 * leading YAML front matter are skipped so their `#` characters never leak in.
 */
export function extractOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split(/\r\n|\r|\n/)
  const items: OutlineItem[] = []

  let startLine = 0
  if (lines.length > 0 && FRONT_MATTER_RE.test(lines[0])) {
    for (let i = 1; i < lines.length; i += 1) {
      if (FRONT_MATTER_END_RE.test(lines[i])) {
        startLine = i + 1
        break
      }
    }
  }

  let fence: string | null = null
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]
    if (fence) {
      const close = new RegExp(
        '^ {0,3}' + escapeRegExp(fence[0]) + '{' + fence.length + ',}[ \\t]*$'
      )
      if (close.test(line)) fence = null
      continue
    }
    const opening = FENCE_RE.exec(line)
    if (opening) {
      fence = opening[1]
      continue
    }
    const atx = ATX_RE.exec(line)
    if (atx) {
      items.push({ level: atx[1].length, text: plainText(atx[2]), line: i + 1 })
      continue
    }
    const next = lines[i + 1]
    if (!next || line.trim() === '' || BLOCK_START_RE.test(line)) continue
    if (SETEXT_H1_RE.test(next)) {
      items.push({ level: 1, text: plainText(line), line: i + 1 })
      i += 1
      continue
    }
    if (SETEXT_H2_RE.test(next)) {
      items.push({ level: 2, text: plainText(line), line: i + 1 })
      i += 1
    }
  }
  return items
}
