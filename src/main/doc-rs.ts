import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { parseExportArgs } from './export-args'
import { currentSettings } from './settings'

/**
 * Wrapper around the bundled doc-rs converter (lib/doc-rs). Two architecture
 * specific binaries are shipped under resources/bin so an ARM machine never runs
 * through the x64 emulation layer.
 */

export class ConvertError extends Error {
  constructor(
    message: string,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'ConvertError'
  }
}

function binaryName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `doc-rs-${arch}.exe`
}

/** Searches the packaged resources dir first, then the repo's staging dir. */
export function converterPath(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin', binaryName()),
    join(app.getAppPath(), 'resources', 'bin', binaryName()),
    join(app.getAppPath(), '..', 'resources', 'bin', binaryName())
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function converterAvailable(): boolean {
  return existsSync(converterPath())
}

interface RunOptions {
  from: 'docx' | 'epub' | 'rtf' | 'html' | 'markdown'
  to: string
  input: string
  output: string
}

/** Runs one conversion; the output file is written by the converter itself. */
export function runConversion(options: RunOptions): Promise<string> {
  const binary = converterPath()
  if (!existsSync(binary)) {
    return Promise.reject(
      new ConvertError(`转换器缺失：${binary}`, 'run "npm run build:doc-rs" first')
    )
  }
  const extra = parseExportArgs(currentSettings().exportArgs)
  const args = [
    '--from',
    options.from,
    '--to',
    options.to,
    ...extra,
    '--output',
    options.output,
    options.input
  ]
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new ConvertError(`doc-rs 转换失败：${error.message}`, stderr || error.message))
        return
      }
      resolve(options.output)
    })
  })
}

/** Runs a conversion that reads from stdin, used to feed generated HTML in. */
export function runConversionFromHtml(
  html: string,
  target: string,
  output: string
): Promise<string> {
  const binary = converterPath()
  if (!existsSync(binary)) {
    return Promise.reject(
      new ConvertError(`转换器缺失：${binary}`, 'run "npm run build:doc-rs" first')
    )
  }
  const extra = parseExportArgs(currentSettings().exportArgs)
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      ['--from', 'html', '--to', target, ...extra, '--output', output],
      { windowsHide: true, timeout: 120_000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new ConvertError(`doc-rs 转换失败：${error.message}`, stderr || error.message))
          return
        }
        resolve(output)
      }
    )
    child.stdin?.end(html, 'utf8')
  })
}
