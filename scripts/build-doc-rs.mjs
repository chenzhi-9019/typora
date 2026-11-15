#!/usr/bin/env node
// Builds lib/doc-rs for both Windows targets and stages the binaries where the
// main process looks for them (resources/bin/doc-rs-<arch>.exe).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const crate = join(root, 'lib', 'doc-rs')
const stage = join(root, 'resources', 'bin')

const targets = [
  { triple: 'x86_64-pc-windows-msvc', arch: 'x64' },
  { triple: 'aarch64-pc-windows-msvc', arch: 'arm64' }
]

const cargo =
  process.platform === 'win32'
    ? join(homedir(), '.cargo', 'bin', 'cargo.exe')
    : 'cargo'

const cargoBin = existsSync(cargo) ? cargo : 'cargo'
const env = {
  ...process.env,
  PATH: (process.platform === 'win32' ? join(homedir(), '.cargo', 'bin') + ';' : '') + process.env.PATH,
  // keep the workspace target dir out of the crate so the repo stays clean
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(tmpdir(), 'doc-rs-target')
}

mkdirSync(stage, { recursive: true })

for (const { triple, arch } of targets) {
  process.stdout.write('building ' + triple + ' ... ')
  execFileSync(cargoBin, ['build', '--release', '--target', triple, '--quiet'], {
    cwd: crate,
    env,
    stdio: ['ignore', 'inherit', 'inherit']
  })
  const built = join(env.CARGO_TARGET_DIR, triple, 'release', 'doc-rs.exe')
  if (!existsSync(built)) throw new Error('missing build output: ' + built)
  const destination = join(stage, 'doc-rs-' + arch + '.exe')
  copyFileSync(built, destination)
  console.log('ok -> ' + destination + ' (' + Math.round(statSync(destination).size / 1024) + ' KB)')
}

console.log('doc-rs staged in resources/bin')
