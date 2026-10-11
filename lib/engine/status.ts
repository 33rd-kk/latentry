// Everything the setup page shows, in one answer it can poll.

import fs from 'node:fs/promises'
import path from 'node:path'
import { getSettings } from '@/lib/settings/store'
import { hasModel } from '@/lib/tagger/wd14'
import { CATALOG, engineModelId, type CatalogEntry } from './catalog'
import { chooseTorch, detectGpus, type Gpu, type TorchChoice } from './gpus'
import { installJob, installRecord, type InstallRecord, type InstallState } from './install'
import { enginePaths } from './paths'
import { DEFAULT_BASE_PORT, engineFetch, engines, modelsDir, type EngineState } from './supervisor'
import { taggerDir, taggerDownloads } from './tagger-download'

export interface DownloadView {
  state: 'queued' | 'downloading' | 'verifying' | 'done' | 'error'
  doneBytes: number
  totalBytes: number
  error: string | null
}

export interface CatalogView extends CatalogEntry {
  modelId: string
  installed: boolean
  /** For a tagger: whether the built-in tagger uses this one now. */
  inUse: boolean
  /** For a tagger: the folder it is (or will be) downloaded to. */
  dir: string | null
  download: DownloadView | null
}

export interface EngineModel {
  id: string
  name: string
  family: string | null
  sizeBytes: number
}

export interface EngineView {
  id: string
  gpu: string | null
  port: number
  state: EngineState
  pid: number | null
  model: string | null
  loading: string | null
  loadError: string | null
  restarts: number
  log: string[]
}

export interface EngineStatus {
  editable: true
  platform: string
  gpus: Gpu[]
  torch: TorchChoice
  runtimeDir: string
  modelsDir: string
  /** The folder set on the Setup page; null for the default (<app>/models). */
  customModelsDir: string | null
  autoStart: boolean
  basePort: number
  installed: InstallRecord | null
  install: { state: InstallState; step: string | null; error: string | null; log: string[] }
  engines: EngineView[]
  models: EngineModel[] | null
  current: string | null
  catalog: CatalogView[]
}

// nvidia-smi takes a moment; the GPUs do not change while the app runs.
let gpuCache: Gpu[] | null = null

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  )
}

interface EngineDownload {
  repo_id: string
  filename: string | null
  state: DownloadView['state']
  done_bytes: number
  total_bytes: number
  error: string | null
}

export async function engineStatus(): Promise<EngineStatus> {
  gpuCache ??= await detectGpus()
  const settings = getSettings()
  const dir = modelsDir()
  const job = installJob()
  const running = engines().find((engine) => engine.state === 'running')

  let models: EngineModel[] | null = null
  let current: string | null = null
  let downloads: EngineDownload[] = []
  if (running) {
    try {
      const [list, progress] = await Promise.all([
        engineFetch(running, '/api/models').then((response) => response.json()),
        engineFetch(running, '/api/models/downloads').then((response) => response.json()),
      ])
      models = (list.models as { id: string; name: string; family: string | null; size_bytes: number }[]).map((model) => ({
        id: model.id,
        name: model.name,
        family: model.family,
        sizeBytes: model.size_bytes,
      }))
      current = list.current ?? null
      downloads = progress.downloads ?? []
    } catch {
      // Busy starting a load; the next poll will have it.
    }
  }

  const wd14Dir = settings.wd14?.modelDir ?? null
  const taggerProgress = taggerDownloads()
  const catalog = await Promise.all(
    CATALOG.map(async (entry): Promise<CatalogView> => {
      const modelId = engineModelId(entry)
      if (entry.kind === 'tagger') {
        const target = taggerDir(entry)
        const item = taggerProgress.find((download) => download.id === entry.id)
        return {
          ...entry,
          modelId,
          installed: hasModel(target),
          inUse: Boolean(wd14Dir && path.resolve(/*turbopackIgnore: true*/ wd14Dir) === path.resolve(/*turbopackIgnore: true*/ target)),
          dir: target,
          download: item ? { state: item.state, doneBytes: item.doneBytes, totalBytes: item.totalBytes, error: item.error } : null,
        }
      }
      // The latest download of this entry, if the engine has one.
      const item = downloads.filter((download) => download.repo_id === entry.repo && (download.filename ?? undefined) === entry.filename).pop()
      return {
        ...entry,
        modelId,
        installed: await exists(path.join(dir, modelId)),
        inUse: false,
        dir: null,
        download: item ? { state: item.state, doneBytes: item.done_bytes, totalBytes: item.total_bytes, error: item.error } : null,
      }
    })
  )

  return {
    editable: true,
    platform: `${process.platform}/${process.arch}`,
    gpus: gpuCache,
    torch: chooseTorch(gpuCache),
    runtimeDir: enginePaths().root,
    modelsDir: dir,
    customModelsDir: settings.engine?.modelsDir ?? null,
    autoStart: settings.engine?.autoStart !== false,
    basePort: settings.engine?.basePort ?? DEFAULT_BASE_PORT,
    installed: await installRecord(),
    install: { state: job.state, step: job.step, error: job.error, log: job.log.slice(-200) },
    engines: engines().map((engine) => ({
      id: engine.id,
      gpu: engine.gpu ? `${engine.gpu.index}: ${engine.gpu.name}` : null,
      port: engine.port,
      state: engine.state,
      pid: engine.pid,
      model: engine.model,
      loading: engine.loading,
      loadError: engine.loadError,
      restarts: engine.restarts.length,
      log: engine.log.slice(-80),
    })),
    models,
    current,
    catalog,
  }
}
