// Installs the engine's Python side, with nothing asked of the user:
//
//   1. uv, Astral's Python package manager, as one downloaded binary
//   2. Python 3.12, fetched by uv, in a virtual environment
//   3. PyTorch built for this machine's GPU (see ./gpus.ts)
//   4. the engine (./engine) and its dependencies: stock diffusers, FastAPI
//
// All of it goes under the runtime folder (./paths.ts), never into the
// system Python or the user's home, so deleting that folder uninstalls it.
// Running it again repairs or updates an install; it is safe to repeat.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { chooseTorch, detectGpus, type TorchChoice } from './gpus'
import { lineSplitter } from './lines'
import { enginePaths } from './paths'

const PYTHON_VERSION = '3.12'

export type InstallState = 'idle' | 'running' | 'done' | 'error'

export interface InstallRecord {
  torch: string
  indexUrl: string | null
  installedAt: string
  /** What the check at the end printed: torch version, whether the GPU answers. */
  check: { torch: string; diffusers: string; device: string; gpu: string | null }
}

interface InstallJob {
  state: InstallState
  step: string | null
  log: string[]
  error: string | null
}

const MAX_LOG_LINES = 400

const globalForInstall = globalThis as typeof globalThis & { __latentryInstall?: InstallJob }
const job: InstallJob = (globalForInstall.__latentryInstall ??= { state: 'idle', step: null, log: [], error: null })

function log(line: string): void {
  for (const part of line.split(/\r?\n|\r/)) {
    const trimmed = part.trimEnd()
    if (!trimmed) continue
    job.log.push(trimmed)
  }
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES)
}

export function installJob(): Readonly<InstallJob> {
  return job
}

export async function installRecord(): Promise<InstallRecord | null> {
  const paths = enginePaths()
  try {
    const record = JSON.parse(await fs.readFile(paths.state, 'utf8')) as InstallRecord
    await fs.access(paths.python)
    return record
  } catch {
    return null
  }
}

/** uv's release asset for this machine, or null where uv has none. Pure. */
export function uvAsset(platform: NodeJS.Platform, arch: string): string | null {
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null
  if (!cpu) return null
  if (platform === 'win32') return `uv-${cpu}-pc-windows-msvc.zip`
  if (platform === 'darwin') return `uv-${cpu}-apple-darwin.tar.gz`
  if (platform === 'linux') return `uv-${cpu}-unknown-linux-gnu.tar.gz`
  return null
}

type Env = Record<string, string | undefined>

/**
 * The environment uv runs in: this process's, without any uv settings the
 * user has made for their own projects (UV_* variables, and uv.toml through
 * UV_NO_CONFIG), and with uv's cache and Python kept in the runtime folder.
 * UV_MANAGED_PYTHON makes uv download its own Python there rather than build
 * the engine on a Python installed elsewhere on this machine, which could be
 * updated or removed from under it. Pure.
 */
export function uvEnvironment(paths: { uvCache: string; uvPython: string }, base: Env = process.env): Env {
  const env: Env = {}
  for (const [name, value] of Object.entries(base)) if (!/^UV_/i.test(name)) env[name] = value
  return {
    ...env,
    UV_CACHE_DIR: paths.uvCache,
    UV_PYTHON_INSTALL_DIR: paths.uvPython,
    UV_MANAGED_PYTHON: '1',
    UV_NO_CONFIG: '1',
    UV_NO_PROGRESS: '1',
  }
}

/**
 * Whether a virtual environment (its pyvenv.cfg) was built on a Python outside
 * `uvPython`, as installs before Latentry kept its own Python were. Such an
 * environment is made again. Pure.
 */
export function venvOnOtherPython(pyvenvCfg: string, uvPython: string, platform: NodeJS.Platform = process.platform): boolean {
  const home = /^\s*home\s*=\s*(.+?)\s*$/m.exec(pyvenvCfg)?.[1]
  if (!home) return true
  // Paths of the platform asked about, whatever this one is (so tests run anywhere).
  const paths = platform === 'win32' ? path.win32 : path.posix
  const fold = (value: string) => {
    const normal = paths.resolve(value)
    return platform === 'win32' ? normal.toLowerCase() : normal
  }
  const relative = paths.relative(fold(uvPython), fold(home))
  return relative === '' || relative.startsWith('..') || paths.isAbsolute(relative)
}

/** Runs a program, sending its output to the log; rejects on a non-zero exit. */
function run(command: string, args: string[], env: Env = process.env): Promise<string> {
  log(`> ${path.basename(command)} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    const out = lineSplitter(log)
    const err = lineSplitter(log)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      out.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => err.write(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      out.flush()
      err.flush()
      if (code === 0) resolve(stdout)
      else reject(new Error(`${path.basename(command)} exited with ${code}`))
    })
  })
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  )
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    }
  }
  return null
}

async function ensureUv(): Promise<string> {
  const paths = enginePaths()
  if (await exists(paths.uv)) return paths.uv
  const asset = uvAsset(process.platform, process.arch)
  if (!asset) throw new Error(`No uv build for ${process.platform}/${process.arch}`)

  const url = `https://github.com/astral-sh/uv/releases/latest/download/${asset}`
  const dir = path.dirname(paths.uv)
  const archive = path.join(paths.root, asset)
  const unpacked = path.join(paths.root, 'uv-unpacked')
  await fs.mkdir(dir, { recursive: true })
  log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Downloading uv failed: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(archive))

  // tar reads both .tar.gz and (on Windows 10 and later, bsdtar) .zip. On
  // Windows, the system's own: a GNU tar from Git earlier on PATH reads
  // "C:/..." as a remote host.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar'
  await fs.rm(unpacked, { recursive: true, force: true })
  await fs.mkdir(unpacked, { recursive: true })
  await run(tar, ['-xf', archive, '-C', unpacked])
  const binary = await findFile(unpacked, path.basename(paths.uv))
  if (!binary) throw new Error('The uv download did not contain uv')
  await fs.rename(binary, paths.uv)
  if (process.platform !== 'win32') await fs.chmod(paths.uv, 0o755)
  await fs.rm(unpacked, { recursive: true, force: true })
  await fs.rm(archive, { force: true })
  return paths.uv
}

/**
 * The engine's virtual environment, on a Python uv downloaded into the runtime
 * folder. One built on another Python (installs before this) is made again.
 */
export async function ensureVenv(uv: string): Promise<void> {
  const paths = enginePaths()
  const cfg = await fs.readFile(path.join(paths.venv, 'pyvenv.cfg'), 'utf8').catch(() => null)
  if (cfg !== null && venvOnOtherPython(cfg, paths.uvPython)) {
    log("The engine's environment was built on a Python installed elsewhere on this computer; making it again with Latentry's own Python.")
    await fs.rm(paths.venv, { recursive: true, force: true })
  }
  await run(uv, ['venv', '--python', PYTHON_VERSION, '--allow-existing', paths.venv], uvEnvironment(paths))
}

async function steps(torch: TorchChoice): Promise<InstallRecord> {
  const paths = enginePaths()
  await fs.mkdir(paths.root, { recursive: true })
  const uvEnv = uvEnvironment(paths)

  job.step = 'uv'
  const uv = await ensureUv()

  job.step = 'python'
  await ensureVenv(uv)

  job.step = 'torch'
  await run(
    uv,
    // torchvision too: Anima's transformer (Cosmos) needs it to resize its padding mask.
    ['pip', 'install', '--python', paths.python, 'torch', 'torchvision', ...(torch.indexUrl ? ['--index-url', torch.indexUrl] : [])],
    uvEnv
  )

  job.step = 'engine'
  await run(uv, ['pip', 'install', '--python', paths.python, '-e', paths.engineSource], uvEnv)

  job.step = 'check'
  const output = await run(paths.python, [
    '-c',
    [
      'import json, torch, diffusers',
      'cuda = torch.cuda.is_available()',
      'mps = getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available()',
      'print(json.dumps({"torch": torch.__version__, "diffusers": diffusers.__version__,',
      ' "device": "cuda" if cuda else "mps" if mps else "cpu",',
      ' "gpu": torch.cuda.get_device_name(0) if cuda else None}))',
    ].join('\n'),
  ])
  const check = JSON.parse(output.trim().split(/\r?\n/).pop() ?? '{}') as InstallRecord['check']
  if (torch.indexUrl?.includes('/cu') && check.device !== 'cuda') {
    // Installed, but the GPU is not usable from it; say so rather than run on the CPU unnoticed.
    log('Warning: PyTorch does not see the GPU. The engine will run on the CPU.')
  }
  return { torch: torch.label, indexUrl: torch.indexUrl, installedAt: new Date().toISOString(), check }
}

/** Starts an install in the background; false when one is already running. */
export function startInstall(onDone?: () => void): boolean {
  if (job.state === 'running') return false
  job.state = 'running'
  job.step = 'detect'
  job.error = null
  job.log = []

  void (async () => {
    try {
      const gpus = await detectGpus()
      log(gpus.length ? gpus.map((gpu) => `GPU ${gpu.index}: ${gpu.name}, ${gpu.vramMiB} MiB, driver ${gpu.driver ?? '?'}`).join('\n') : 'No GPU found.')
      const torch = chooseTorch(gpus)
      if (torch.label.startsWith('unsupported')) throw new Error(torch.label)
      log(`PyTorch build: ${torch.label}`)
      const record = await steps(torch)
      await fs.writeFile(enginePaths().state, JSON.stringify(record, null, 2))
      log(`Installed: torch ${record.check.torch}, diffusers ${record.check.diffusers}, on ${record.check.gpu ?? record.check.device}`)
      job.state = 'done'
      job.step = null
      onDone?.()
    } catch (error) {
      job.state = 'error'
      job.error = error instanceof Error ? error.message : String(error)
      log(`Failed: ${job.error}`)
    }
  })()
  return true
}
