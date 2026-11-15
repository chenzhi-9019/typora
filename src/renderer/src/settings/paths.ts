/** Path arithmetic for the renderer, which has no `node:path` in this bundle. */

export interface SplitPath {
  dir: string
  name: string
}

export function splitPath(path: string): SplitPath {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index < 0) return { dir: '', name: path }
  return { dir: path.slice(0, index), name: path.slice(index + 1) }
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

/** Extension including the dot, '' for a name without one (or a dotfile). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot)
}

/**
 * Path of `target` as written in Markdown, i.e. relative to the document folder and with
 * forward slashes. Answers `target` itself when it is not inside `fromDir`.
 */
export function relativePath(fromDir: string, target: string): string {
  const from = fromDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const to = target.replace(/\\/g, '/')
  if (from === '') return to
  const direct = to.slice(0, from.length + 1)
  if (direct.toLowerCase() === from.toLowerCase() + '/') return to.slice(from.length + 1)
  return to
}

export function joinPath(dir: string, name: string): string {
  if (dir === '') return name
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name
  return dir + (dir.includes('\\') && !dir.includes('/') ? '\\' : '/') + name
}
