import { BrowserWindow, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import { IPC } from '../shared/ipc'
import type { ConvertPayload, ImportedDocument } from '../shared/api'
import { converterAvailable, runConversion, runConversionFromHtml } from './doc-rs'
import { uploadImage } from './upload'
import { chooseSaveFile } from './dialogs'
import { defaultExportPath, finishExport } from './exporter'
import { onInvoke } from './ipc-handle'
import { currentSettings } from './settings'

const IMPORT_FILTERS = [
  { name: '可导入的文档', extensions: ['docx', 'epub', 'rtf', 'html', 'htm'] },
  { name: '所有文件', extensions: ['*'] }
]

const IMPORTABLE = new Set(['docx', 'epub', 'rtf', 'html', 'htm'])

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return (
    BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
  )
}

function sourceFormat(path: string): 'docx' | 'epub' | 'rtf' | 'html' | null {
  const ext = extname(path).slice(1).toLowerCase()
  if (!IMPORTABLE.has(ext)) return null
  return (ext === 'htm' ? 'html' : ext) as 'docx' | 'epub' | 'rtf' | 'html'
}

/** Converts a picked document into Markdown through doc-rs. */
export async function importAsMarkdown(
  event: IpcMainInvokeEvent
): Promise<ImportedDocument | null> {
  const window = parentWindow(event)
  const options = { title: '导入', properties: ['openFile'] as const, filters: IMPORT_FILTERS }
  const picked = window
    ? await dialog.showOpenDialog(window, { ...options, properties: ['openFile'] })
    : await dialog.showOpenDialog({ ...options, properties: ['openFile'] })
  if (picked.canceled || picked.filePaths.length === 0) return null

  const source = picked.filePaths[0]
  const from = sourceFormat(source)
  if (!from) {
    throw new Error('不支持的文件类型：' + extname(source))
  }
  if (!converterAvailable()) {
    throw new Error('转换器缺失，请先运行 npm run build:doc-rs')
  }

  const scratch = await mkdtemp(join(tmpdir(), 'typora-import-'))
  const target = join(scratch, 'imported.md')
  try {
    await runConversion({ from, to: 'markdown', input: source, output: target })
    const content = await readFile(target, 'utf-8')
    return { path: source, content }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

const FORMAT_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  docx: { name: 'Word 文档', extensions: ['docx'] },
  epub: { name: 'EPUB 电子书', extensions: ['epub'] },
  rtf: { name: 'RTF 文档', extensions: ['rtf'] },
  org: { name: 'Org mode', extensions: ['org'] },
  rst: { name: 'reStructuredText', extensions: ['rst'] },
  textile: { name: 'Textile', extensions: ['textile'] },
  mediawiki: { name: 'MediaWiki', extensions: ['wiki', 'mediawiki'] },
  opml: { name: 'OPML', extensions: ['opml'] },
  latex: { name: 'LaTeX', extensions: ['tex'] },
  markdown: { name: 'Markdown', extensions: ['md'] },
  html: { name: 'HTML', extensions: ['html'] }
}

function withExtension(path: string, format: string): string {
  const filter = FORMAT_FILTERS[format]
  const ext = filter ? filter.extensions[0] : format
  const base = path.replace(/\.[^./\\]+$/, '')
  return extensionOf(path) === ext ? path : `${base}.${ext}`
}

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.')
  return index < 0 ? '' : path.slice(index + 1).toLowerCase()
}

export function registerConvertHandlers(): void {
  onInvoke(IPC.importMarkdown, (event) => importAsMarkdown(event))
  onInvoke(IPC.imageUpload, (_event, localPath: string) => uploadImage(localPath))

  onInvoke(IPC.exportConvert, async (event, payload: ConvertPayload) => {
    if (!converterAvailable()) {
      throw new Error('转换器缺失，请先运行 npm run build:doc-rs')
    }
    const filter = FORMAT_FILTERS[payload.format]
    const extension = '.' + (filter ? filter.extensions[0] : payload.format)
    const fallback = defaultExportPath(payload.defaultPath, extension)
    const chosen = currentSettings().exportNoDialog
      ? fallback
      : await chooseSaveFile(event, {
          title: '导出为 ' + (filter?.name ?? payload.format),
          defaultPath: fallback,
          filters: filter ? [filter] : undefined
        })
    if (!chosen) return null
    const target = withExtension(chosen, payload.format)
    const written = await runConversionFromHtml(payload.html, payload.format, target)
    await finishExport(written)
    return written
  })
}
