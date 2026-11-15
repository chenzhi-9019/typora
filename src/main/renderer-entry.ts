import type { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Loads one renderer entry: the dev server page under `electron-vite dev`, the
 * built file otherwise. A failure is logged instead of taking the process down.
 */
export function loadRendererPage(window: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const loading =
    is.dev && devUrl
      ? window.loadURL(`${devUrl}/${page}`)
      : window.loadFile(join(__dirname, `../renderer/${page}`))
  loading.catch((error: unknown) => {
    console.error(`渲染进程页面加载失败: ${page}`, error)
  })
}
