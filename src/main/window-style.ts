import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import type { WindowStyle } from '../shared/types'

let appliedStyle: WindowStyle | null = null
let prompting = false

/** Window chrome is fixed when the window is created, so seamless mode lives here. */
export function windowChromeOptions(style: WindowStyle): {
  titleBarStyle?: 'hidden'
  titleBarOverlay?: boolean
} {
  return style === 'seamless' ? { titleBarStyle: 'hidden', titleBarOverlay: false } : {}
}

export function noteAppliedStyle(style: WindowStyle): void {
  appliedStyle = style
}

/** A style change needs a rebuilt window, so offer a restart instead of faking it. */
export function promptRestartIfNeeded(style: WindowStyle, window?: BrowserWindow): void {
  if (appliedStyle === null || style === appliedStyle || prompting) return
  prompting = true
  const message =
    style === 'seamless'
      ? '窗口样式已切换为无缝模式，需要重新启动 Typora 才能完全生效。'
      : '窗口样式已切换为经典模式，需要重新启动 Typora 才能完全生效。'
  const options = {
    type: 'info' as const,
    message,
    buttons: ['立即重启', '稍后'],
    defaultId: 1,
    cancelId: 1
  }
  const shown = window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
  shown
    .then((result) => {
      prompting = false
      if (result.response !== 0) return
      app.relaunch()
      app.exit(0)
    })
    .catch(() => {
      prompting = false
    })
}
