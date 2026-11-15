import { execFile } from 'child_process'
import { currentSettings } from './settings'

const UPLOAD_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/

interface CommandResult {
  stdout: string
  stderr: string
}

function isMissingExecutable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  // Windows reports EINVAL when libuv cannot start a name that has no usable extension
  return code === 'ENOENT' || code === 'EINVAL'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function run(file: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: UPLOAD_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

/** npm-installed CLIs on Windows are .cmd shims, which execFile cannot start directly. */
async function runWithShim(file: string, args: string[]): Promise<CommandResult> {
  const candidates = process.platform === 'win32' ? [file, file + '.cmd'] : [file]
  let missing: unknown = null
  for (const candidate of candidates) {
    try {
      return await run(candidate, args)
    } catch (error) {
      if (!isMissingExecutable(error)) throw error
      missing = error
    }
  }
  // keep the original failure so the caller can tell "not installed" apart
  throw missing instanceof Error ? missing : new Error(`无法启动 ${file}：${String(missing)}`)
}

async function runService(file: string, args: string[], label: string): Promise<CommandResult> {
  try {
    return await runWithShim(file, args)
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new Error(`找不到上传程序（${label}）：请确认 "${file}" 已安装并位于 PATH 中`, {
        cause: error
      })
    }
    throw new Error(`上传命令执行失败（${label}）：${errorMessage(error)}`, { cause: error })
  }
}

function customArgs(template: string, localPath: string): { file: string; args: string[] } {
  const tokens = template
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/\$\{path\}/g, localPath))
  const file = tokens.shift()
  if (!file) throw new Error('自定义上传命令为空：请在偏好设置中填写 uploadCommand')
  return { file, args: tokens }
}

async function runCustom(template: string, localPath: string): Promise<CommandResult> {
  const { file, args } = customArgs(template, localPath)
  return runService(file, args, '自定义上传命令')
}

/**
 * Uploads one image and returns its public URL. Not wired to IPC yet: the frozen
 * contract has no channel for it, so the renderer cannot reach it until one exists.
 */
export async function uploadImage(localPath: string): Promise<string> {
  const settings = currentSettings()
  const service = settings.uploadService
  if (service === 'none') {
    throw new Error('未选择上传服务：请先在偏好设置中配置上传服务')
  }

  const result =
    service === 'picgo-app'
      ? await runService('picgo', ['upload', localPath], 'PicGo 桌面端')
      : service === 'picgo-core'
        ? await runService('npx', ['picgo', 'upload', localPath], 'PicGo Core（npx picgo）')
        : await runCustom(settings.uploadCommand, localPath)

  const url = URL_PATTERN.exec(result.stdout)
  if (!url) {
    throw new Error('上传成功但未能从命令输出中解析到图片地址')
  }
  return url[0]
}
