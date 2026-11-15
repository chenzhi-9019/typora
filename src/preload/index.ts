import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { TyporaApi } from '../shared/api'
import type { EditorSettings, MenuCommandPayload } from '../shared/types'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TyporaApi = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    patch: (patch: Partial<EditorSettings>) => ipcRenderer.invoke(IPC.settingsPatch, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset),
    onChanged: (cb) => subscribe<EditorSettings>(IPC.settingsChanged, cb)
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizedChanged: (cb) => subscribe<boolean>(IPC.windowMaximizedChanged, cb),
    openNew: () => ipcRenderer.invoke(IPC.windowOpenNew),
    onCloseRequested: (cb) => subscribe<void>(IPC.windowCloseRequested, cb),
    closeConfirmed: () => ipcRenderer.invoke(IPC.windowCloseConfirmed)
  },
  dialog: {
    openFile: (kind?: 'document' | 'image' | 'importable') =>
      ipcRenderer.invoke(IPC.dialogOpenFile, kind),
    openFolder: () => ipcRenderer.invoke(IPC.dialogOpenFolder),
    saveAs: (defaultPath?: string) => ipcRenderer.invoke(IPC.dialogSaveAs, defaultPath),
    message: (options) => ipcRenderer.invoke(IPC.dialogMessage, options)
  },
  fs: {
    readFile: (path: string) => ipcRenderer.invoke(IPC.fsReadFile, path),
    writeFile: (path: string, content: string) => ipcRenderer.invoke(IPC.fsWriteFile, path, content),
    readDir: (path: string, depth?: number) => ipcRenderer.invoke(IPC.fsReadDir, path, depth),
    exists: (path: string) => ipcRenderer.invoke(IPC.fsExists, path),
    createFile: (path: string) => ipcRenderer.invoke(IPC.fsCreateFile, path),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke(IPC.fsRename, oldPath, newPath),
    copyFile: (source: string, destination: string) =>
      ipcRenderer.invoke(IPC.fsCopyFile, source, destination),
    remove: (path: string) => ipcRenderer.invoke(IPC.fsRemove, path),
    duplicate: (path: string) => ipcRenderer.invoke(IPC.fsDuplicate, path),
    moveTo: (path: string, directory: string) =>
      ipcRenderer.invoke(IPC.fsMoveTo, path, directory),
    createFolder: (directory: string, name: string) =>
      ipcRenderer.invoke(IPC.fsCreateFolder, directory, name),
    reveal: (path: string) => ipcRenderer.invoke(IPC.fsReveal, path),
    watchFolder: (path: string | null) => ipcRenderer.invoke(IPC.fsWatchFolder, path),
    onFolderChanged: (cb) => subscribe(IPC.fsFolderChanged, cb)
  },
  image: {
    upload: (localPath: string) => ipcRenderer.invoke(IPC.imageUpload, localPath)
  },
  importDoc: {
    markdown: () => ipcRenderer.invoke(IPC.importMarkdown)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    googleSearch: (query: string) => ipcRenderer.invoke(IPC.appGoogleSearch, query)
  },
  app: {
    quit: () => ipcRenderer.invoke(IPC.appQuit),
    print: () => ipcRenderer.invoke(IPC.appPrint),
    pageSetup: () => ipcRenderer.invoke(IPC.appPageSetup),
    inspectElement: () => ipcRenderer.invoke(IPC.appInspectElement),
    checkUpdates: () => ipcRenderer.invoke(IPC.appCheckUpdates),
    version: () => ipcRenderer.invoke(IPC.appVersion),
    initialFile: () => ipcRenderer.invoke(IPC.appInitialFile),
    openExternal: (url: string) => ipcRenderer.invoke(IPC.appOpenExternal, url)
  },
  onMenuCommand: (cb) => subscribe<MenuCommandPayload>(IPC.menuCommand, cb),
  export: {
    html: (payload) => ipcRenderer.invoke(IPC.exportHtml, payload),
    pdf: (payload) => ipcRenderer.invoke(IPC.exportPdf, payload),
    image: (payload) => ipcRenderer.invoke(IPC.exportImage, payload),
    convert: (payload) => ipcRenderer.invoke(IPC.exportConvert, payload)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
