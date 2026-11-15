import { doc } from '@renderer/stores/document'
import { settings } from '@renderer/stores/settings'
import { extensionOf, joinPath, relativePath, splitPath, stripExtension } from './paths'

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
/** A value that already carries a percent escape must not be encoded twice. */
const ESCAPED_RE = /%[0-9a-f]{2}/i
const MAX_UNIQUE_ATTEMPTS = 100

/** True for `http:`/`https:`/`//cdn` sources; `file:`, `data:` and drive paths are local. */
export function isRemoteImage(src: string): boolean {
  const value = src.trim()
  if (value === '') return false
  if (WINDOWS_DRIVE_RE.test(value)) return false
  if (/^file:/i.test(value) || /^data:/i.test(value)) return false
  if (value.startsWith('//')) return true
  return SCHEME_RE.test(value)
}

/**
 * `applyToLocalImages` / `applyToRemoteImages`: may the insert rule (copy into the
 * configured folder, rename, upload) touch this source?
 *
 * `insertImageRule: 'none'` means "no rule", so it answers false for every source.
 */
export function shouldApplyImageRule(src: string): boolean {
  if (settings.insertImageRule === 'none') return false
  return isRemoteImage(src) ? settings.applyToRemoteImages : settings.applyToLocalImages
}

/**
 * `escapeImageUrl`: percent-encodes a URL for `![alt](url)` so spaces and parentheses do
 * not break the link. An already escaped value keeps its escapes; the setting turns the whole
 * step off.
 */
export function escapeImageUrl(url: string): string {
  const value = url.trim()
  if (value === '' || !settings.escapeImageUrl) return value
  try {
    const base = ESCAPED_RE.test(value) ? value : encodeURI(value)
    return base
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E')
      .replace(/ /g, '%20')
  } catch {
    return value
  }
}

/**
 * `uploadService` / `uploadCommand` / `uploadOnInsert`: uploads one image through the
 * main-process service and answers the URL to insert.
 *
 * The main process owns the mechanics (`window.api.image.upload`: `picgo upload`,
 * `npx picgo upload`, or `uploadCommand` with the `${path}` placeholder). Every failure -
 * service off, upload disabled, missing bridge, thrown error, empty answer - keeps the local
 * path, so inserting an image never fails because an upload did.
 */
export async function uploadImage(localPath: string): Promise<string> {
  if (settings.uploadService === 'none') return localPath
  if (!settings.uploadOnInsert) {
    console.info('[settings] uploadImage skipped: uploadOnInsert is off')
    return localPath
  }
  if (typeof window.api?.image?.upload !== 'function') {
    console.warn(
      '[settings] uploadImage: window.api.image.upload is missing from the preload bridge; ' +
        'keeping the local path'
    )
    return localPath
  }
  try {
    const url = (await window.api.image.upload(localPath)).trim()
    if (url === '') {
      console.warn('[settings] uploadImage: the service answered no URL; keeping ' + localPath)
      return localPath
    }
    return url
  } catch (error) {
    console.warn('[settings] uploadImage failed, keeping the local path :: ' + messageOf(error))
    return localPath
  }
}

/**
 * Copies one image according to `insertImageRule` and optionally uploads it, then answers the
 * source to write into the Markdown.
 *
 * - the rule does not apply (`none`, or the local/remote flag is off) -> the source as typed
 * - remote source -> the source as typed (there is nothing to copy)
 * - no document folder (untitled document) -> the source as typed
 * - otherwise the file is copied into `<document dir>` / `assets` / `<name>.assets` /
 *   `imageRoot` and the Markdown gets the path relative to the document folder
 * - with `uploadOnInsert` on, a successful upload replaces it with the returned URL
 *
 * `documentPath` defaults to the open document; a caller that tracks its own active path can
 * pass it explicitly. The answer always goes through {@link escapeImageUrl}.
 */
export async function attachImage(src: string, documentPath?: string | null): Promise<string> {
  const source = src.trim()
  if (source === '') return ''
  if (!shouldApplyImageRule(source) || isRemoteImage(source))
    return escapeImageUrl(markdownPath(source))

  const document = (documentPath ?? doc.path ?? '').trim()
  let absolute = source
  let markdown = source

  const folder = imageFolderFor(document)
  if (folder === null) {
    console.info('[settings] attachImage: no document folder, leaving ' + source + ' in place')
  } else {
    const destination = await uniqueDestination(folder, splitPath(source).name)
    try {
      absolute = await window.api.fs.copyFile(source, destination)
      markdown = relativeToDocument(document, absolute)
    } catch (error) {
      console.warn(
        '[settings] attachImage: copy failed, inserting the source path :: ' + messageOf(error)
      )
      absolute = source
      markdown = relativeToDocument(document, source)
    }
  }

  if (settings.uploadOnInsert && settings.uploadService !== 'none') {
    const uploaded = await uploadImage(absolute)
    if (isRemoteImage(uploaded)) return escapeImageUrl(uploaded)
  }
  return escapeImageUrl(markdownPath(markdown))
}

/**
 * The single entry point for `commands.ts`: everything that happens to an image between the
 * picker/paste and the `![](…)` source lives here.
 */
export async function insertImageSource(
  src: string,
  documentPath?: string | null
): Promise<string> {
  return attachImage(src, documentPath)
}

/** Folder the copy lands in, or null when there is nowhere to put it. */
function imageFolderFor(documentPath: string): string | null {
  if (documentPath === '') return null
  const { dir, name } = splitPath(documentPath)
  switch (settings.insertImageRule) {
    case 'current':
      return dir === '' ? null : dir
    case 'assets':
      return joinPath(dir, 'assets')
    case 'filename':
      return joinPath(dir, stripExtension(name) + '.assets')
    case 'custom':
      return settings.imageRoot.trim() || (dir === '' ? null : dir)
    default:
      return null
  }
}

/** Markdown form of a path: forward slashes, so `![](…)` stays readable on Windows. */
function markdownPath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** `C:/docs/a.md` + `C:/docs/assets/p.png` -> `assets/p.png`. */
function relativeToDocument(documentPath: string, target: string): string {
  if (documentPath === '') return target
  return relativePath(splitPath(documentPath).dir, target)
}

/** `pic.png`, `pic-1.png`, ... - an insert never overwrites an existing image. */
async function uniqueDestination(folder: string, fileName: string): Promise<string> {
  const base = stripExtension(fileName)
  const extension = extensionOf(fileName)
  let candidate = joinPath(folder, fileName)
  for (let attempt = 1; attempt <= MAX_UNIQUE_ATTEMPTS; attempt += 1) {
    if (!(await exists(candidate))) return candidate
    candidate = joinPath(folder, base + '-' + attempt + extension)
  }
  return joinPath(folder, fileName)
}

async function exists(path: string): Promise<boolean> {
  try {
    return await window.api.fs.exists(path)
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
