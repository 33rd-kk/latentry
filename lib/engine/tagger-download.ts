// Downloads a WD14 tagger from the catalog into <models>/wd14/<id> and points
// the built-in tagger at it. The tagger runs in Latentry itself
// (lib/tagger/wd14.ts), so this needs no engine.

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

export function startTaggerDownload(entry: CatalogEntry): TaggerDownload {
  const running = downloads.get(entry.id)
  if (running?.state === 'downloading') return running
  const item: TaggerDownload = { id: entry.id, state: 'downloading', doneBytes: 0, totalBytes: entry.bytes, error: null, dir: taggerDir(entry) }
  downloads.set(entry.id, item)

  void (async () => {
    try {
      await fs.mkdir(item.dir, { recursive: true })
      const headers: Record<string, string> = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {}
      // The pinned commit, each file checked against its pinned SHA-256.
      for (const file of entry.files ?? []) {
        await downloadVerified(`https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${file}`, path.join(item.dir, file), {
          sha256: entry.sha256?.[file] ?? '',
          headers,
          onBytes: (count) => {
            item.doneBytes += count
          },
        })
      }
      // Use it straight away, keeping any thresholds already set.
      const settings = getSettings()
      await saveSettings({ ...settings, wd14: { ...settings.wd14, modelDir: item.dir } })
      item.state = 'done'
    } catch (error) {
      item.state = 'error'
      item.error = error instanceof Error ? error.message : String(error)
    }
  })()
  return item
}
