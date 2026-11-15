import { shell } from 'electron'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Opens an external link, refusing anything that could inject a local file or script. */
export async function openExternalUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('无法解析的外部链接')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`已阻止不受支持的外部链接协议：${parsed.protocol}`)
  }
  await shell.openExternal(url)
}

export async function googleSearch(query: string): Promise<void> {
  const trimmed = (query ?? '').trim()
  if (!trimmed) throw new Error('搜索内容为空')
  await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(trimmed)}`)
}
