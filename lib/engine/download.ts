// Downloads that must arrive exactly as pinned: uv (./install.ts) and the
// catalog's taggers (./tagger-download.ts). The file is hashed as it is
// written, to `<target>.part`, and only takes its real name when the SHA-256
// matches; otherwise nothing is left behind. The pins themselves live in
// ./uv-release.ts and ./catalog.ts (see scripts/pin-downloads.mjs).

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

/** A download whose bytes are not the ones pinned. */
export class ChecksumError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string
  ) {
    super(`${url} did not match its pinned SHA-256 (expected ${expected}, got ${actual}); nothing was kept`)
    this.name = 'ChecksumError'
  }
}

export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/** Fetches `url` into `target`, keeping it only if its SHA-256 is `sha256`. */
export async function downloadVerified(
  url: string,
  target: string,
  options: { sha256: string; headers?: Record<string, string>; onBytes?: (count: number) => void }
): Promise<void> {
  if (!isSha256(options.sha256)) throw new Error(`No pinned SHA-256 for ${url}`)
  const partial = `${target}.part`
  try {
    const response = await fetch(url, { headers: options.headers })
    if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`)
    const hash = createHash('sha256')
    const tee = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        options.onBytes?.(chunk.length)
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as WebReadableStream), tee, createWriteStream(partial))
    const actual = hash.digest('hex')
    if (actual !== options.sha256) throw new ChecksumError(url, options.sha256, actual)
    await fs.rename(partial, target)
  } catch (error) {
    await fs.rm(partial, { force: true })
    throw error
  }
}
