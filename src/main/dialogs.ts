import { BrowserWindow, dialog } from 'electron'
import type {
  IpcMainInvokeEvent,
  MessageBoxOptions,
  OpenDialogOptions,
  SaveDialogOptions
} from 'electron'
import { basename, join } from 'path'
import { IPC } from '../shared/ipc'
import { onInvoke } from './ipc-handle'
import { currentSettings } from './settings'

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'txt']

const MARKDOWN_FILTERS = [{ name: 'Markdown 文件', extensions: MARKDOWN_EXTENSIONS }]

const IMAGE_FILTERS = [
  { name: '图像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }
]

const IMPORT_FILTERS = [
  { name: '可导入的文档', extensions: ['docx', 'epub', 'rtf', 'html', 'htm'] },
  { name: '所有文件', extensions: ['*'] }
]

const ALL_FILTERS = [...MARKDOWN_FILTERS, ...IMAGE_FILTERS, { name: '所有文件', extensions: ['*'] }]

interface MessageOptions {
  type?: 'info' | 'warning' | 'error' | 'question'
  message: string
  detail?: string
  buttons?: string[]
}

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return (
    BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? undefined
  )
}

/** exportFolder, when set, becomes the starting directory of save dialogs. */
function withExportFolder(path: string | undefined): string | undefined {
  const folder = currentSettings().exportFolder
  if (!folder) return path
  return join(folder, path ? basename(path) : '未命名.md')
}

/** Shows a save dialog owned by the calling window and returns the picked path. */
export async function chooseSaveFile(
  event: IpcMainInvokeEvent,
  options: SaveDialogOptions
): Promise<string | null> {
  const window = parentWindow(event)
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled) return null
  return result.filePath ?? null
}

export function registerDialogHandlers(): void {
  onInvoke(IPC.dialogOpenFile, async (event, kind?: 'document' | 'image' | 'importable') => {
    const options: OpenDialogOptions = {
      title: kind === 'image' ? '插入图片' : '打开文件',
      properties: ['openFile'],
      filters:
        kind === 'image'
          ? IMAGE_FILTERS
          : kind === 'importable'
            ? IMPORT_FILTERS
            : kind === undefined
              ? MARKDOWN_FILTERS
              : ALL_FILTERS
    }
    const window = parentWindow(event)
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  onInvoke(IPC.dialogOpenFolder, async (event) => {
    const options: OpenDialogOptions = {
      title: '打开文件夹',
      properties: ['openDirectory']
    }
    const window = parentWindow(event)
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })

  onInvoke(IPC.dialogSaveAs, (event, defaultPath: string | undefined) =>
    chooseSaveFile(event, {
      title: '另存为',
      defaultPath: withExportFolder(defaultPath),
      filters: MARKDOWN_FILTERS
    })
  )

  onInvoke(IPC.dialogMessage, async (event, options: MessageOptions) => {
    const boxOptions: MessageBoxOptions = {
      type: options.type ?? 'info',
      message: options.message,
      detail: options.detail,
      buttons: options.buttons?.length ? options.buttons : ['确定']
    }
    const window = parentWindow(event)
    const result = window
      ? await dialog.showMessageBox(window, boxOptions)
      : await dialog.showMessageBox(boxOptions)
    return result.response
  })
}
