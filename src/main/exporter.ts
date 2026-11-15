import { app, BrowserWindow, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { IPC } from '../shared/ipc'
import { applyEol } from './eol'
import { onInvoke } from './ipc-handle'
import { chooseSaveFile } from './dialogs'
import { currentSettings } from './settings'

interface ExportPayload {
  title: string
  html: string
  defaultPath?: string
}

/** Width of the PNG canvas; the height follows the rendered document. */
const IMAGE_WIDTH = 1000
const IMAGE_MIN_HEIGHT = 200
const IMAGE_MAX_HEIGHT = 20000
const RENDER_SETTLE_MS = 300

const EXPORT_STYLE = `
  html {
    -webkit-print-color-adjust: exact;
  }
  body {
    margin: 0;
    padding: 48px 24px;
    background: #ffffff;
    color: #333333;
    font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
    font-size: 16px;
    line-height: 1.7;
  }
  #write {
    max-width: 860px;
    margin: 0 auto;
  }
  img {
    max-width: 100%;
  }
  pre {
    padding: 12px 16px;
    overflow: auto;
    background: #f6f8fa;
    border-radius: 4px;
  }
  code {
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 0.9em;
  }
  blockquote {
    margin: 0;
    padding: 0 16px;
    color: #6a737d;
    border-left: 4px solid #dfe2e5;
  }
  table {
    border-collapse: collapse;
  }
  th,
  td {
    padding: 6px 13px;
    border: 1px solid #dfe2e5;
  }
`

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title || '未命名')}</title>
    <style>${EXPORT_STYLE}</style>
  </head>
  <body>
    <article id="write">${body}</article>
  </body>
</html>
`
}

const DEFAULT_EXPORT_NAME = '未命名'

/** exportFolder wins, then the source document's folder, then Documents. */
function exportDirectory(sourcePath: string | undefined): string {
  const folder = currentSettings().exportFolder
  if (folder) return folder
  if (sourcePath) return dirname(sourcePath)
  return app.getPath('documents')
}

/**
 * Export file name. `exportKeepExtensions` keeps the source extension inside the
 * name (`note.md.html`) instead of replacing it (`note.html`).
 */
function exportFileName(sourcePath: string | undefined, extension: string): string {
  if (!sourcePath) return `${DEFAULT_EXPORT_NAME}${extension}`
  const name = basename(sourcePath)
  if (currentSettings().exportKeepExtensions) return `${name}${extension}`
  return `${basename(name, extname(name))}${extension}`
}

/** Absolute default target of an export, shared with the doc-rs export path. */
export function defaultExportPath(sourcePath: string | undefined, extension: string): string {
  return join(exportDirectory(sourcePath), exportFileName(sourcePath, extension))
}

/** Dialog or no dialog, depending on `exportNoDialog`. */
async function resolveExportTarget(
  event: IpcMainInvokeEvent,
  payload: ExportPayload,
  extension: string,
  title: string,
  filterName: string
): Promise<string | null> {
  const fallback = defaultExportPath(payload.defaultPath, extension)
  if (currentSettings().exportNoDialog) return ensureExtension(fallback, extension)
  const target = await chooseSaveFile(event, {
    title,
    defaultPath: fallback,
    filters: [{ name: filterName, extensions: [extension.slice(1)] }]
  })
  if (!target) return null
  return ensureExtension(target, extension)
}

/** `exportAfter` decides what happens once the file is on disk. */
export async function finishExport(path: string): Promise<void> {
  const after = currentSettings().exportAfter
  if (after === 'reveal') shell.showItemInFolder(path)
  else if (after === 'open') await shell.openPath(path)
}

function ensureExtension(path: string, extension: string): string {
  return extname(path) ? path : `${path}${extension}`
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function documentHeight(window: BrowserWindow): Promise<number> {
  const measured: unknown = await window.webContents.executeJavaScript(
    'Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))'
  )
  const height =
    typeof measured === 'number' && Number.isFinite(measured) ? measured : IMAGE_MIN_HEIGHT
  return Math.min(Math.max(Math.ceil(height), IMAGE_MIN_HEIGHT), IMAGE_MAX_HEIGHT)
}

async function renderImage(document: string): Promise<Buffer> {
  const folder = await mkdtemp(join(tmpdir(), 'typora-image-'))
  const source = join(folder, 'document.html')
  await writeFile(source, document, 'utf-8')
  const window = new BrowserWindow({
    show: false,
    width: IMAGE_WIDTH,
    height: IMAGE_MIN_HEIGHT,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    await window.loadFile(source)
    await delay(RENDER_SETTLE_MS)
    window.setContentSize(IMAGE_WIDTH, await documentHeight(window))
    await delay(RENDER_SETTLE_MS)
    return (await window.webContents.capturePage()).toPNG()
  } finally {
    if (!window.isDestroyed()) window.destroy()
    await rm(folder, { recursive: true, force: true })
  }
}

async function renderPdf(document: string): Promise<Buffer> {
  const folder = await mkdtemp(join(tmpdir(), 'typora-export-'))
  const source = join(folder, 'document.html')
  await writeFile(source, document, 'utf-8')
  const window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    await window.loadFile(source)
    return await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    })
  } finally {
    if (!window.isDestroyed()) window.destroy()
    await rm(folder, { recursive: true, force: true })
  }
}

async function exportHtml(
  event: IpcMainInvokeEvent,
  payload: ExportPayload
): Promise<string | null> {
  const path = await resolveExportTarget(event, payload, '.html', '导出为 HTML', 'HTML 文件')
  if (!path) return null
  const document = buildDocument(payload.title, payload.html)
  await writeFile(path, applyEol(document, currentSettings().eol), 'utf-8')
  await finishExport(path)
  return path
}

async function exportPdf(
  event: IpcMainInvokeEvent,
  payload: ExportPayload
): Promise<string | null> {
  const path = await resolveExportTarget(event, payload, '.pdf', '导出为 PDF', 'PDF 文件')
  if (!path) return null
  await writeFile(path, await renderPdf(buildDocument(payload.title, payload.html)))
  await finishExport(path)
  return path
}

async function exportImage(
  event: IpcMainInvokeEvent,
  payload: ExportPayload
): Promise<string | null> {
  const path = await resolveExportTarget(event, payload, '.png', '导出为图像', 'PNG 图像')
  if (!path) return null
  await writeFile(path, await renderImage(buildDocument(payload.title, payload.html)))
  await finishExport(path)
  return path
}

export function registerExportHandlers(): void {
  onInvoke(IPC.exportHtml, (event, payload: ExportPayload) => exportHtml(event, payload))
  onInvoke(IPC.exportPdf, (event, payload: ExportPayload) => exportPdf(event, payload))
  onInvoke(IPC.exportImage, (event, payload: ExportPayload) => exportImage(event, payload))
}
