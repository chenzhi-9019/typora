import { BrowserWindow, shell } from 'electron'
import { constants as fsConstants, watch } from 'fs'
import type { FSWatcher } from 'fs'
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { IPC } from '../shared/ipc'
import type { FileContent, FileNode, SaveResult } from '../shared/types'
import { applyEol } from './eol'
import { onInvoke } from './ipc-handle'
import { currentSettings } from './settings'

/** Files above this size are truncated instead of being pushed into the renderer. */
const MAX_FILE_BYTES = 20 * 1024 * 1024
const DEFAULT_DEPTH = 2
const MAX_DEPTH = 8
const WATCH_DEBOUNCE_MS = 150
const DEFAULT_FILE_NAME = '未命名.md'
const IGNORED_ENTRIES = new Set(['node_modules', '.git', '.DS_Store'])

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

let folderWatcher: FSWatcher | null = null
let watchDebounce: NodeJS.Timeout | null = null
let watchedFolder: string | null = null

function sortNodes(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return NAME_COLLATOR.compare(a.name, b.name)
  })
}

async function readFileNode(path: string): Promise<FileNode> {
  const stats = await stat(path)
  return { name: basename(path), path, isDirectory: false, mtime: stats.mtimeMs, size: stats.size }
}

async function readTree(path: string, depth: number): Promise<FileNode> {
  const stats = await stat(path)
  const node: FileNode = {
    name: basename(path) || path,
    path,
    isDirectory: stats.isDirectory(),
    mtime: stats.mtimeMs,
    size: stats.size
  }
  if (node.isDirectory && depth > 0) node.children = await readChildren(path, depth)
  return node
}

async function readChildren(path: string, depth: number): Promise<FileNode[]> {
  const entries = await readdir(path, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (IGNORED_ENTRIES.has(entry.name)) continue
    const full = join(path, entry.name)
    try {
      if (entry.isDirectory()) nodes.push(await readTree(full, depth - 1))
      else if (entry.isFile()) nodes.push(await readFileNode(full))
    } catch {
      continue
    }
  }
  return sortNodes(nodes)
}

async function readHead(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_BYTES, 0)
    return new TextDecoder('utf-8').decode(buffer.subarray(0, bytesRead), { stream: true })
  } finally {
    await handle.close()
  }
}

async function readTextFile(path: string): Promise<FileContent> {
  const stats = await stat(path)
  const truncated = stats.size > MAX_FILE_BYTES
  const content = truncated ? await readHead(path) : await readFile(path, 'utf-8')
  return { path, content, mtime: stats.mtimeMs, truncated }
}

async function writeTextFile(path: string, content: string): Promise<SaveResult> {
  await writeFile(path, applyEol(content, currentSettings().eol), 'utf-8')
  const stats = await stat(path)
  return { path, mtime: stats.mtimeMs }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

async function createDocumentFile(path: string): Promise<string> {
  const targetIsFolder = await isDirectory(path)
  const folder = targetIsFolder ? path : dirname(path)
  const requested = targetIsFolder ? DEFAULT_FILE_NAME : basename(path)
  const extension = extname(requested) || '.md'
  const stem = basename(requested, extname(requested))
  for (let index = 0; index < 1000; index += 1) {
    const candidate = join(
      folder,
      index === 0 ? `${stem}${extension}` : `${stem} ${index}${extension}`
    )
    try {
      const handle = await open(candidate, 'wx')
      await handle.close()
      return candidate
    } catch {
      continue
    }
  }
  throw new Error('无法为新文件找到可用的名称')
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

async function pushFolderTree(): Promise<void> {
  if (!watchedFolder) return
  try {
    broadcast(IPC.fsFolderChanged, await readTree(watchedFolder, DEFAULT_DEPTH))
  } catch {
    stopWatching()
  }
}

function scheduleFolderPush(): void {
  if (watchDebounce) clearTimeout(watchDebounce)
  watchDebounce = setTimeout(() => {
    watchDebounce = null
    void pushFolderTree()
  }, WATCH_DEBOUNCE_MS)
}

function stopWatching(): void {
  if (watchDebounce) {
    clearTimeout(watchDebounce)
    watchDebounce = null
  }
  if (folderWatcher) {
    folderWatcher.close()
    folderWatcher = null
  }
  watchedFolder = null
}

async function watchFolder(path: string | null): Promise<void> {
  stopWatching()
  if (!path) return
  try {
    folderWatcher = watch(path, { recursive: true }, () => scheduleFolderPush())
    folderWatcher.on('error', () => stopWatching())
    watchedFolder = path
  } catch {
    stopWatching()
  }
}

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth) || depth < 0) return DEFAULT_DEPTH
  return Math.min(Math.floor(depth), MAX_DEPTH)
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return null
  return (error as { code?: unknown }).code
}

/** `note.md` → `note - 副本.md`, then `note - 副本 (2).md` and so on. */
async function duplicateFile(path: string): Promise<string> {
  if (await isDirectory(path)) throw new Error('只能为文件创建副本，不能复制文件夹')
  const folder = dirname(path)
  const extension = extname(path)
  const stem = basename(path, extension)
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' - 副本' : ` - 副本 (${index})`
    const candidate = join(folder, `${stem}${suffix}${extension}`)
    const created = await copyFile(path, candidate, fsConstants.COPYFILE_EXCL).then(
      () => true,
      (error: unknown) => {
        if (errorCode(error) !== 'EEXIST') throw error
        return false
      }
    )
    if (created) return candidate
  }
  throw new Error('无法为文件找到可用的副本名称')
}

async function moveToDirectory(path: string, directory: string): Promise<string> {
  if (!(await isDirectory(directory))) throw new Error(`目标文件夹不存在：${directory}`)
  const target = join(directory, basename(path))
  if (await fileExists(target)) throw new Error(`目标文件夹中已存在同名项：${target}`)
  const moved = await rename(path, target).then(
    () => true,
    (error: unknown) => {
      // Windows cannot rename across volumes; fall back to copy + delete
      if (errorCode(error) !== 'EXDEV') throw error
      return false
    }
  )
  if (!moved) {
    await copyFile(path, target)
    await rm(path, { recursive: true, force: true })
  }
  return target
}

async function createFolder(directory: string, name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('文件夹名称不能为空')
  if (/[\\/]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    throw new Error(`文件夹名称不合法：${name}`)
  }
  const target = join(directory, trimmed)
  if (await fileExists(target)) throw new Error(`已存在同名文件夹：${target}`)
  await mkdir(target)
  return target
}

export function registerFileHandlers(): void {
  onInvoke(IPC.fsReadFile, (_event, path: string) => readTextFile(path))
  onInvoke(IPC.fsWriteFile, (_event, path: string, content: string) => writeTextFile(path, content))
  onInvoke(IPC.fsReadDir, (_event, path: string, depth: number = DEFAULT_DEPTH) =>
    readTree(path, clampDepth(depth))
  )
  onInvoke(IPC.fsExists, (_event, path: string) => fileExists(path))
  onInvoke(IPC.fsCreateFile, (_event, path: string) => createDocumentFile(path))
  onInvoke(IPC.fsRename, async (_event, oldPath: string, newPath: string) => {
    await rename(oldPath, newPath)
  })
  onInvoke(IPC.fsCopyFile, async (_event, source: string, destination: string) => {
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
    return destination
  })
  onInvoke(IPC.fsRemove, async (_event, path: string) => {
    await rm(path, { recursive: true, force: true })
  })
  onInvoke(IPC.fsDuplicate, (_event, path: string) => duplicateFile(path))
  onInvoke(IPC.fsMoveTo, (_event, path: string, directory: string) =>
    moveToDirectory(path, directory)
  )
  onInvoke(IPC.fsCreateFolder, (_event, directory: string, name: string) =>
    createFolder(directory, name)
  )
  onInvoke(IPC.fsReveal, (_event, path: string) => {
    shell.showItemInFolder(path)
  })
  onInvoke(IPC.fsWatchFolder, (_event, path: string | null) => watchFolder(path))
}
