// Installs the engine's Python side, with nothing asked of the user:
//
//   1. uv, Astral's Python package manager, as one downloaded binary of a
//      pinned release, checked against its SHA-256 (./uv-release.ts)
//   2. Python 3.12, fetched by uv, in a virtual environment
//   3. PyTorch built for this machine's GPU (see ./gpus.ts) and the engine's
//      dependencies (stock diffusers, FastAPI), exactly as pinned in the
//      lock for this machine (engine/locks/, see ./locks.ts), every file
//      checked against its SHA-256; then the engine (./engine) itself
//
// All of it goes under the runtime folder (./paths.ts), never into the
// system Python or the user's home, so deleting that folder uninstalls it.
// Running it again repairs or updates an install; it is safe to repeat, and
// it leaves the environment holding the lock's packages and nothing else.

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { downloadVerified } from './download'
import { chooseTorch, detectGpus, type TorchChoice } from './gpus'
import { lineSplitter } from './lines'
import { LOCKED_ON, lockFailure, lockName, torchRunsOn, wantsLatest, type UnpinnedReason } from './locks'
import { enginePaths } from './paths'
import { UV_SHA256, UV_VERSION, uvUrl } from './uv-release'

const PYTHON_VERSION = '3.12'

export type InstallState = 'idle' | 'running' | 'done' | 'error'

export interface InstallRecord {
  torch: string
  indexUrl: string | null
  installedAt: string
  /** The lock installed from (engine/locks/<lock>.txt) and the day it was resolved for; null when unpinned. */
  lock?: { name: string; lockedOn: string } | null
  /** Why the packages are not pinned, when they are not. Absent in records from before the locks. */
  unpinned?: UnpinnedReason | null
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

/** A program that exited non-zero, with the end of what it printed to stderr. */
class RunError extends Error {
  constructor(
    message: string,
    readonly output: string
  ) {
    super(message)
  }
}

/** Runs a program, sending its output to the log; rejects with a RunError on a non-zero exit. */
function run(command: string, args: string[], env: Env = process.env): Promise<string> {
  log(`> ${path.basename(command)} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const out = lineSplitter(log)
    const err = lineSplitter(log)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      out.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      // The end says why it failed; that much is kept.
      stderr = (stderr + chunk.toString()).slice(-20_000)
      err.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      out.flush()
      err.flush()
      if (code === 0) resolve(stdout)
      else reject(new RunError(`${path.basename(command)} exited with ${code}`, stderr))
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

/** Whether `uv --version` output is the pinned release. Pure. */
export function isPinnedUv(versionOutput: string, version: string = UV_VERSION): boolean {
  return versionOutput.trim().split(/\s+/)[1] === version
}

/** The uv already installed, if it is the pinned release. */
async function installedUv(file: string): Promise<boolean> {
  if (!(await exists(file))) return false
  try {
    return isPinnedUv(await run(file, ['--version']))
  } catch {
    return false
  }
}

/** The pinned uv in the runtime folder, downloaded and checked when it is missing or another release. */
export async function ensureUv(): Promise<string> {
  const paths = enginePaths()
  if (await installedUv(paths.uv)) return paths.uv
  const asset = uvAsset(process.platform, process.arch)
  const sha256 = asset ? UV_SHA256[asset] : undefined
  if (!asset || !sha256) throw new Error(`No uv build for ${process.platform}/${process.arch}`)

  // A fixed release, checked against its pinned SHA-256 before it is unpacked or run.
  const url = uvUrl(asset)
  const dir = path.dirname(paths.uv)
  const archive = path.join(paths.root, asset)
  const unpacked = path.join(paths.root, 'uv-unpacked')
  await fs.mkdir(dir, { recursive: true })
  log(`Downloading ${url}`)
  await downloadVerified(url, archive, { sha256 })
  log(`uv ${UV_VERSION}: SHA-256 matches`)

  // tar reads both .tar.gz and (on Windows 10 and later, bsdtar) .zip. On
  // Windows, the system's own: a GNU tar from Git earlier on PATH reads
  // "C:/..." as a remote host.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar'
  await fs.rm(unpacked, { recursive: true, force: true })
  await fs.mkdir(unpacked, { recursive: true })
  await run(tar, ['-xf', archive, '-C', unpacked])
  const binary = await findFile(unpacked, path.basename(paths.uv))
  if (!binary) throw new Error('The uv download did not contain uv')
  await fs.rm(paths.uv, { force: true })
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

  const name = lockName(process.platform, process.arch, torch.backend, os.release())
  const lockFile = name ? path.join(paths.engineSource, 'locks', `${name}.txt`) : null
  let unpinned: UnpinnedReason | null = wantsLatest() ? 'latest' : lockFile && (await exists(lockFile)) ? null : 'no-lock'

  if (lockFile && unpinned === null) {
    try {
      job.step = 'packages'
      // sync, not install: the environment ends up holding the lock's
      // packages and nothing else, each file checked against its hash.
      await run(
        uv,
        ['pip', 'sync', '--require-hashes', '--python', paths.python, ...(torch.backend ? ['--torch-backend', torch.backend] : []), lockFile],
        uvEnv
      )
      job.step = 'engine'
      await run(uv, ['pip', 'install', '--no-deps', '--python', paths.python, '-e', paths.engineSource], uvEnv)
    } catch (error) {
      // Only a pinned file no longer offered is retried unpinned; a hash that
      // does not match, or anything not recognised, stops here.
      if (!(error instanceof RunError) || lockFailure(error.output) !== 'missing') throw error
      unpinned = 'missing'
    }
  }
  if (unpinned) {
    log(UNPINNED_NOTES[unpinned](`${process.platform}/${process.arch}, ${torch.label}`))
    await installUnpinned(uv, torch, uvEnv)
  }

  job.step = 'check'
  let check = await checkTorch(paths.python)
  if (!unpinned && check.capability && !torchRunsOn(check.arch, check.capability)) {
    unpinned = 'new-gpu'
    log(UNPINNED_NOTES[unpinned](check.capability.join('.')))
    await installUnpinned(uv, torch, uvEnv, true)
    job.step = 'check'
    check = await checkTorch(paths.python)
  }
  if (torch.indexUrl?.includes('/cu') && check.device !== 'cuda') {
    // Installed, but the GPU is not usable from it; say so rather than run on the CPU unnoticed.
    log('Warning: PyTorch does not see the GPU. The engine will run on the CPU.')
  }
  const { arch: _arch, capability: _capability, ...shown } = check
  return {
    torch: torch.label,
    indexUrl: torch.indexUrl,
    installedAt: new Date().toISOString(),
    lock: unpinned || !name ? null : { name, lockedOn: LOCKED_ON },
    unpinned,
    check: shown,
  }
}

/** What the log says when the packages are installed unpinned, and why. */
const UNPINNED_NOTES: Record<UnpinnedReason, (detail: string) => string> = {
  latest: () =>
    'LATENTRY_ENGINE_PACKAGES=latest: installing the newest packages within engine/pyproject.toml, not the pinned ones. They are not checked against hashes.',
  'no-lock': (machine) => `No pinned package set for this machine (${machine}): installing unpinned. The packages are not checked against hashes.`,
  missing: () => 'A pinned package is no longer offered by its index: installing unpinned instead. The packages are not checked against hashes.',
  'new-gpu': (capability) =>
    `The pinned PyTorch has no kernels for this GPU (compute ${capability}): installing the newest PyTorch unpinned. It is not checked against hashes.`,
}

/**
 * PyTorch and the engine, newest within engine/pyproject.toml: what every
 * install did before the locks, and still does where a lock cannot be used.
 */
async function installUnpinned(uv: string, torch: TorchChoice, uvEnv: Env, upgradeTorch = false): Promise<void> {
  const paths = enginePaths()
  job.step = 'torch'
  await run(
    uv,
    [
      'pip',
      'install',
      '--python',
      paths.python,
      // torchvision too: Anima's transformer (Cosmos) needs it to resize its padding mask.
      'torch',
      'torchvision',
      ...(upgradeTorch ? ['--upgrade-package', 'torch', '--upgrade-package', 'torchvision'] : []),
      ...(torch.indexUrl ? ['--index-url', torch.indexUrl] : []),
    ],
    uvEnv
  )
  job.step = 'engine'
  await run(uv, ['pip', 'install', '--python', paths.python, '-e', paths.engineSource], uvEnv)
}

/** Asks the installed PyTorch what it runs on, and which GPUs it has kernels for. */
async function checkTorch(python: string): Promise<InstallRecord['check'] & { arch: string[]; capability: [number, number] | null }> {
  const output = await run(python, [
    '-c',
    [
      'import json, torch, diffusers',
      'cuda = torch.cuda.is_available()',
      'mps = getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available()',
      'print(json.dumps({"torch": torch.__version__, "diffusers": diffusers.__version__,',
      ' "device": "cuda" if cuda else "mps" if mps else "cpu",',
      ' "gpu": torch.cuda.get_device_name(0) if cuda else None,',
      ' "arch": torch.cuda.get_arch_list() if cuda else [],',
      ' "capability": list(torch.cuda.get_device_capability(0)) if cuda else None}))',
    ].join('\n'),
  ])
  return JSON.parse(output.trim().split(/\r?\n/).pop() ?? '{}')
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
