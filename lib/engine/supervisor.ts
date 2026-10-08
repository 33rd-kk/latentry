// Runs the installed engine: one process per GPU, each on its own port and
// pinned to its GPU with CUDA_VISIBLE_DEVICES, so a two-GPU machine draws
// two pictures at once. Each gets a fresh random token, which only Latentry
// holds; the engines listen on 127.0.0.1 only.
//
// A process that dies is restarted, up to MAX_RESTARTS within RESTART_WINDOW;
// past that it is left stopped with its log, for the setup page to show.
//
// The running engines are offered as backends (see lib/backends/config.ts),
// with ids "engine" (or "engine-<gpu>" when there are several GPUs).

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import type { BackendConfig } from '@/lib/backends/types'
import type { ProfileId } from '@/lib/profiles'
import { getSettings } from '@/lib/settings/store'
import { CATALOG, engineModelId } from './catalog'
import { detectGpus, type Gpu } from './gpus'
import { installRecord } from './install'
import { lineSplitter } from './lines'
import { defaultModelsDir, enginePaths } from './paths'

export const DEFAULT_BASE_PORT = 7861
const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 5 * 60 * 1000
const HEALTH_INTERVAL_MS = 5000
const MAX_LOG_LINES = 300

export type EngineState = 'starting' | 'running' | 'stopped' | 'crashed'

export interface EngineProcess {
  id: string
  gpu: Gpu | null
  port: number
  token: string
  state: EngineState
  pid: number | null
  child: ChildProcess | null
  restarts: number[]
  log: string[]
  /** The loaded model as the engine last reported it. */
  model: string | null
  family: string | null
  loading: string | null
  loadError: string | null
  stopping: boolean
}

interface Supervisor {
  engines: Map<string, EngineProcess>
  timer: ReturnType<typeof setInterval> | null
  exitHook: boolean
}

const globalForEngine = globalThis as typeof globalThis & { __latentryEngines?: Supervisor }
const supervisor: Supervisor = (globalForEngine.__latentryEngines ??= { engines: new Map(), timer: null, exitHook: false })

export function modelsDir(): string {
  return getSettings().engine?.modelsDir || defaultModelsDir()
}

function append(engine: EngineProcess, text: string): void {
  for (const line of text.split(/\r?\n|\r/)) if (line.trim()) engine.log.push(line.trimEnd())
  if (engine.log.length > MAX_LOG_LINES) engine.log.splice(0, engine.log.length - MAX_LOG_LINES)
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

async function freePort(from: number, taken: Set<number>): Promise<number> {
  for (let port = from; port < from + 50; port++) {
    if (!taken.has(port) && (await portFree(port))) return port
  }
  throw new Error(`No free port from ${from}`)
}

/** The profile a backend starts with for a model: the catalog's, else by family. Pure. */
export function profileFor(model: string | null, family: string | null): ProfileId {
  const known = CATALOG.find((entry) => model && engineModelId(entry) === model)
  if (known?.profile) return known.profile
  return family === 'anima' ? 'anima' : 'sdxl'
}

function spawnEngine(engine: EngineProcess): void {
  const paths = enginePaths()
  const model = getSettings().engine?.model
  // --parent-pid: the engine leaves by itself if Latentry is killed outright.
  const args = ['-m', 'latentry_engine', '--host', '127.0.0.1', '--port', String(engine.port), '--models-dir', modelsDir(), '--parent-pid', String(process.pid)]
  if (model) args.push('--model', model)

  engine.state = 'starting'
  engine.stopping = false
  append(engine, `> python ${args.join(' ')}`)
  const child = spawn(paths.python, args, {
    cwd: paths.root,
    env: {
      ...engineEnv(),
      LATENTRY_ENGINE_TOKEN: engine.token,
      PYTHONUNBUFFERED: '1',
      ...(engine.gpu?.vendor === 'nvidia' ? { CUDA_VISIBLE_DEVICES: String(engine.gpu.index) } : {}),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  engine.child = child
  engine.pid = child.pid ?? null
  const out = lineSplitter((line) => append(engine, line))
  const err = lineSplitter((line) => append(engine, line))
  child.stdout?.on('data', (chunk: Buffer) => out.write(chunk))
  child.stderr?.on('data', (chunk: Buffer) => err.write(chunk))
  child.on('error', (error) => append(engine, `Could not start: ${error.message}`))
  child.on('exit', (code, signal) => {
    out.flush()
    err.flush()
    engine.child = null
    engine.pid = null
    if (engine.stopping) {
      engine.state = 'stopped'
      return
    }
    append(engine, `Exited (${signal ?? code}).`)
    const now = Date.now()
    engine.restarts = engine.restarts.filter((at) => now - at < RESTART_WINDOW_MS)
    if (engine.restarts.length >= MAX_RESTARTS) {
      engine.state = 'crashed'
      append(engine, `Stopped restarting after ${MAX_RESTARTS} exits in ${RESTART_WINDOW_MS / 60000} minutes.`)
      return
    }
    engine.restarts.push(now)
    engine.state = 'starting'
    setTimeout(() => {
      if (!engine.stopping && !engine.child) spawnEngine(engine)
    }, 2000 * engine.restarts.length)
  })
}

async function poll(): Promise<void> {
  for (const engine of supervisor.engines.values()) {
    if (!engine.child) continue
    try {
      const response = await fetch(`http://127.0.0.1:${engine.port}/api/health`, { signal: AbortSignal.timeout(3000) })
      const health = (await response.json()) as Record<string, unknown>
      engine.state = 'running'
      engine.model = typeof health.model_id === 'string' ? health.model_id : null
      engine.family = typeof health.family === 'string' ? health.family : null
      engine.loading = typeof health.loading === 'string' ? health.loading : null
      engine.loadError = typeof health.load_error === 'string' ? health.load_error : null
    } catch {
      // Still starting (importing torch takes a while), or busy answering.
    }
  }
}

function ensureTimer(): void {
  if (supervisor.timer) return
  supervisor.timer = setInterval(() => void poll(), HEALTH_INTERVAL_MS)
  supervisor.timer.unref?.()
  if (!supervisor.exitHook) {
    supervisor.exitHook = true
    // The engines would otherwise outlive Latentry and keep their VRAM.
    const stopAll = () => {
      for (const engine of supervisor.engines.values()) {
        engine.stopping = true
        engine.child?.kill()
      }
    }
    process.once('exit', stopAll)
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        stopAll()
        process.exit(0)
      })
    }
  }
}

export type StartResult = { ok: true; engines: number } | { ok: false; reason: 'notInstalled' | 'noGpuSelected' }

/** Starts an engine for each selected GPU (one on the CPU when there is none). */
export async function startEngines(): Promise<StartResult> {
  if (!(await installRecord())) return { ok: false, reason: 'notInstalled' }
  const settings = getSettings().engine ?? {}
  const all = await detectGpus()
  const chosen = settings.gpus ? all.filter((gpu) => settings.gpus!.includes(gpu.index)) : all
  if (all.length && !chosen.length) return { ok: false, reason: 'noGpuSelected' }
  const targets: (Gpu | null)[] = chosen.length ? chosen : [null]

  const taken = new Set([...supervisor.engines.values()].filter((engine) => engine.child).map((engine) => engine.port))
  let port = settings.basePort ?? DEFAULT_BASE_PORT
  for (const gpu of targets) {
    const id = targets.length === 1 ? 'engine' : `engine-${gpu?.index ?? 0}`
    const existing = supervisor.engines.get(id)
    if (existing?.child) continue
    port = await freePort(port, taken)
    taken.add(port)
    const engine: EngineProcess = existing ?? {
      id,
      gpu,
      port,
      token: '',
      state: 'stopped',
      pid: null,
      child: null,
      restarts: [],
      log: [],
      model: null,
      family: null,
      loading: null,
      loadError: null,
      stopping: false,
    }
    Object.assign(engine, { gpu, port, token: randomBytes(24).toString('hex'), restarts: [] })
    supervisor.engines.set(id, engine)
    spawnEngine(engine)
    port++
  }
  ensureTimer()
  return { ok: true, engines: targets.length }
}

export async function stopEngines(): Promise<void> {
  const exits: Promise<void>[] = []
  for (const engine of supervisor.engines.values()) {
    engine.stopping = true
    const child = engine.child
    if (!child) {
      engine.state = 'stopped'
      continue
    }
    exits.push(new Promise((resolve) => child.once('exit', () => resolve())))
    child.kill()
  }
  await Promise.race([Promise.all(exits), new Promise((resolve) => setTimeout(resolve, 10000))])
}

export function engines(): EngineProcess[] {
  return [...supervisor.engines.values()]
}

/** The engines that are up, as backends. Read by lib/backends/config.ts. */
export function engineBackends(): BackendConfig[] {
  return engines()
    .filter((engine) => engine.child && engine.state !== 'crashed')
    .map((engine) => ({
      id: engine.id,
      kind: 'diffusers' as const,
      url: `http://127.0.0.1:${engine.port}/`,
      profile: profileFor(engine.model, engine.family),
      token: engine.token,
    }))
}

/**
 * This process's environment as the engine gets it: without the tokens of the
 * other backends or the pairing key, which it has no use for, and with
 * Hugging Face's usage reports off unless set otherwise.
 */
export function engineEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^GEN_TOKEN_/i.test(key) && key !== 'DIFFUSION_API_TOKEN' && key !== 'LATENTRY_PAIRING_KEY')
  )
  return { HF_HUB_DISABLE_TELEMETRY: '1', ...kept } as unknown as NodeJS.ProcessEnv
}

/** Calls an engine's own API (models, downloads) with its token. */
export async function engineFetch(engine: EngineProcess, pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${engine.port}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${engine.token}`, 'Content-Type': 'application/json' },
    signal: init.signal ?? AbortSignal.timeout(15000),
  })
}

/** At server start: bring the engines up when installed and not turned off. */
export async function autoStart(): Promise<void> {
  if (getSettings().engine?.autoStart === false) return
  if (process.env.LATENTRY_ENGINE === 'off') return
  const result = await startEngines().catch((error) => {
    console.warn('[engine] could not start:', error)
    return null
  })
  if (result?.ok) console.log(`[engine] starting ${result.engines} engine${result.engines === 1 ? '' : 's'}`)
}
