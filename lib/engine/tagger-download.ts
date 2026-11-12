// Downloads a WD14 tagger from the catalog into <models>/wd14/<id> and points
// the built-in tagger at it, or a face detector into <models>/detectors/<id>.
// Both run in Latentry itself (lib/tagger/wd14.ts, lib/facefix/detect.ts),
// so this needs no engine.

import fs from 'node:fs/promises'
import path from 'node:path'
import { getSettings, saveSettings } from '@/lib/settings/store'
import type { CatalogEntry } from './catalog'
import { downloadVerified } from './download'
import { modelsDir } from './supervisor'

export interface TaggerDownload {
  id: string
  state: 'downloading' | 'done' | 'error'
  doneBytes: number
  totalBytes: number
  error: string | null
  dir: string
}

const globalForDownloads = globalThis as typeof globalThis & { __latentryTaggerDownloads?: Map<string, TaggerDownload> }
const downloads = (globalForDownloads.__latentryTaggerDownloads ??= new Map())

export function taggerDownloads(): TaggerDownload[] {
  return [...downloads.values()]
}

export function taggerDir(entry: CatalogEntry): string {
  return path.join(modelsDir(), 'wd14', entry.id)
}

/** A face detector's folder: its file is kept there by its own name, without the repository's folders. */
export function detectorDir(entry: CatalogEntry): string {
  return path.join(modelsDir(), 'detectors', entry.id)
}

/** The folder of a model Latentry runs itself (a face detector, or a control picture's model), kept by its file's own name. */
export function localModelDir(entry: CatalogEntry): string {
  return entry.kind === 'annotator' ? path.join(modelsDir(), 'annotators', entry.id) : detectorDir(entry)
}

export function startTaggerDownload(entry: CatalogEntry): TaggerDownload {
  const running = downloads.get(entry.id)
  if (running?.state === 'downloading') return running
  const detector = entry.kind === 'detector' || entry.kind === 'annotator'
  const item: TaggerDownload = { id: entry.id, state: 'downloading', doneBytes: 0, totalBytes: entry.bytes, error: null, dir: detector ? localModelDir(entry) : taggerDir(entry) }
  downloads.set(entry.id, item)

  void (async () => {
    try {
      await fs.mkdir(item.dir, { recursive: true })
      const headers: Record<string, string> = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {}
      // The pinned commit, each file checked against its pinned SHA-256.
      for (const file of entry.files ?? []) {
        await downloadVerified(`https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${file}`, path.join(item.dir, path.basename(file)), {
          sha256: entry.sha256?.[file] ?? '',
          headers,
          onBytes: (count) => {
            item.doneBytes += count
          },
        })
      }
      // A tagger is used straight away, keeping any thresholds already set; a detector or annotator is found by its folder.
      if (!detector) {
        const settings = getSettings()
        await saveSettings({ ...settings, wd14: { ...settings.wd14, modelDir: item.dir } })
      }
      item.state = 'done'
    } catch (error) {
      item.state = 'error'
      item.error = error instanceof Error ? error.message : String(error)
    }
  })()
  return item
}
