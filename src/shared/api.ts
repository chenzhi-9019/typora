import type {
  EditorSettings,
  FileContent,
  FileNode,
  MenuCommandPayload,
  SaveResult
} from './types'

export interface DialogFileFilter {
  name: string
  extensions: string[]
}

/** Which filter set the open dialog should offer. */
export type OpenFileKind = 'document' | 'image' | 'importable'

export interface ImportedDocument {
  path: string
  content: string
}

export interface ConvertPayload {
  title: string
  html: string
  /** target format name understood by doc-rs, e.g. 'docx' or 'restructuredtext' */
  format: string
  defaultPath?: string
}

export interface TyporaApi {
  settings: {
    get(): Promise<EditorSettings>
    patch(patch: Partial<EditorSettings>): Promise<EditorSettings>
    reset(): Promise<EditorSettings>
    /** fires when another window changed the settings */
    onChanged(cb: (settings: EditorSettings) => void): () => void
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChanged(cb: (maximized: boolean) => void): () => void
    /** opens another editor window */
    openNew(): Promise<void>
    /** fired when the user closes the window, so the renderer can offer to save */
    onCloseRequested(cb: () => void): () => void
    /** lets a held-back close go through */
    closeConfirmed(): Promise<void>
  }
  dialog: {
    openFile(kind?: OpenFileKind): Promise<string | null>
    openFolder(): Promise<string | null>
    saveAs(defaultPath?: string): Promise<string | null>
    message(options: {
      type?: 'info' | 'warning' | 'error' | 'question'
      message: string
      detail?: string
      buttons?: string[]
    }): Promise<number>
  }
  fs: {
    readFile(path: string): Promise<FileContent>
    writeFile(path: string, content: string): Promise<SaveResult>
    readDir(path: string, depth?: number): Promise<FileNode>
    exists(path: string): Promise<boolean>
    createFile(path: string): Promise<string>
    rename(oldPath: string, newPath: string): Promise<void>
    /** copies a binary file (images) and returns the destination path */
    copyFile(source: string, destination: string): Promise<string>
    remove(path: string): Promise<void>
    duplicate(path: string): Promise<string>
    moveTo(path: string, directory: string): Promise<string>
    createFolder(directory: string, name: string): Promise<string>
    reveal(path: string): Promise<void>
    watchFolder(path: string | null): Promise<void>
    onFolderChanged(cb: (node: FileNode) => void): () => void
  }
  image: {
    /** uploads a local image through the configured service, returns its URL */
    upload(localPath: string): Promise<string>
  }
  importDoc: {
    /** opens a picker, converts the chosen file to Markdown and returns it */
    markdown(): Promise<ImportedDocument | null>
  }
  shell: {
    openExternal(url: string): Promise<void>
    googleSearch(query: string): Promise<void>
  }
  app: {
    quit(): Promise<void>
    print(): Promise<void>
    pageSetup(): Promise<void>
    inspectElement(): Promise<void>
    checkUpdates(): Promise<void>
    version(): Promise<string>
    /** Markdown file passed on the command line, e.g. `typora notes.md`. */
    initialFile(): Promise<string | null>
    openExternal(url: string): Promise<void>
  }
  onMenuCommand(cb: (payload: MenuCommandPayload) => void): () => void
  export: {
    html(payload: { title: string; html: string; defaultPath?: string }): Promise<string | null>
    pdf(payload: { title: string; html: string; defaultPath?: string }): Promise<string | null>
    image(payload: { title: string; html: string; defaultPath?: string }): Promise<string | null>
    /** converts through doc-rs and writes the result; null when the user cancels */
    convert(payload: ConvertPayload): Promise<string | null>
  }
}

export interface AppBridge {
  electron: unknown
  api: TyporaApi
}
