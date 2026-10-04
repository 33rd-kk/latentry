// Downloads a WD14 tagger from the catalog into <models>/wd14/<id> and points
// the built-in tagger at it. The tagger runs in Latentry itself
// (lib/tagger/wd14.ts), so this needs no engine.

import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { getSettings, saveSettings } from '@/lib/settings/store'
import type { CatalogEntry } from './catalog'
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
      for (const file of entry.files ?? []) {
        const target = path.join(item.dir, file)
        const partial = `${target}.part`
        const response = await fetch(`https://huggingface.co/${entry.repo}/resolve/main/${file}`, { headers })
        if (!response.ok || !response.body) throw new Error(`${file}: HTTP ${response.status}`)
        const count = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            item.doneBytes += chunk.length
            callback(null, chunk)
          },
        })
        await pipeline(Readable.fromWeb(response.body as WebReadableStream), count, createWriteStream(partial))
        await fs.rename(partial, target)
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
