// Looks up a file the user named by URL (./hf-url.ts) on the Hugging Face
// API: the commit its revision points at, and the size and SHA-256 the Hub
// records for it. The engine then downloads exactly that commit and keeps the
// file only if its bytes match (engine/latentry_engine/models.py), as it does
// for the catalog.
//
// Only https://huggingface.co is asked, at a URL built here. Redirects are
// not followed (a renamed repository is refused, not chased), so HF_TOKEN is
// only ever sent to that origin.

import type { MessageKey } from '@/lib/i18n/core'
import { isSha256 } from './download'
import type { HfFile } from './hf-url'

const API = 'https://huggingface.co/api/models'
const TIMEOUT_MS = 15_000
// A repository's file list; large ones list thousands of files.
const MAX_ANSWER_BYTES = 8 * 1024 * 1024
const COMMIT = /^[0-9a-f]{40}$/
// More than any checkpoint; a bigger number is not a size the Hub would list.
const MAX_FILE_BYTES = 128 * 1024 ** 3

export interface HfResolved extends HfFile {
  /** The commit `revision` pointed at when asked. */
  commit: string
  sha256: string
  size: number
  /** The license tag on the model card, if it has one. */
  license: string | null
  /** Whether the repository asks you to accept its terms (or sign in) first. */
  gated: boolean
}

/** A lookup that failed, with a message for the page and an HTTP status. */
export class HfLookupError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly status: number
  ) {
    super(key)
    this.name = 'HfLookupError'
  }
}

interface Sibling {
  rfilename?: unknown
  size?: unknown
  lfs?: { sha256?: unknown; size?: unknown } | null
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => {})
      throw new HfLookupError('setup.hf.error.lookup', 502)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function licenseOf(cardData: unknown): string | null {
  const license = cardData && typeof cardData === 'object' ? (cardData as { license?: unknown }).license : null
  const text = Array.isArray(license) ? license.filter((item) => typeof item === 'string').join(', ') : license
  return typeof text === 'string' && text ? text.slice(0, 80) : null
}

/** The file's commit, size and SHA-256 at `file.revision`, or an HfLookupError. */
export async function resolveHfFile(file: HfFile, fetchImpl: typeof fetch = fetch): Promise<HfResolved> {
  const url = `${API}/${file.repo.split('/').map(encodeURIComponent).join('/')}/revision/${encodeURIComponent(file.revision)}?blobs=true`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`

  let response: Response
  try {
    response = await fetchImpl(url, { headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new HfLookupError('setup.hf.error.unreachable', 502)
  }
  if (response.status >= 300 && response.status < 400) {
    void response.body?.cancel().catch(() => {})
    throw new HfLookupError('setup.hf.error.moved', 409)
  }
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => {})
    throw new HfLookupError('setup.hf.error.private', 403)
  }
  if (response.status === 404) {
    void response.body?.cancel().catch(() => {})
    throw new HfLookupError('setup.hf.error.missing', 404)
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    throw new HfLookupError('setup.hf.error.lookup', 502)
  }

  let info: { sha?: unknown; siblings?: unknown; cardData?: unknown; gated?: unknown }
  try {
    info = JSON.parse(await readCapped(response))
  } catch (error) {
    if (error instanceof HfLookupError) throw error
    throw new HfLookupError('setup.hf.error.lookup', 502)
  }
  const commit = typeof info.sha === 'string' ? info.sha : ''
  // A commit typed in the URL must be the one answered for.
  if (!COMMIT.test(commit) || (COMMIT.test(file.revision) && commit !== file.revision)) throw new HfLookupError('setup.hf.error.lookup', 502)

  const sibling = (Array.isArray(info.siblings) ? (info.siblings as Sibling[]) : []).find((item) => item?.rfilename === file.path)
  if (!sibling) throw new HfLookupError('setup.hf.error.missing', 404)
  const sha256 = sibling.lfs?.sha256
  const size = sibling.lfs?.size ?? sibling.size
  // Without the Hub's own hash there is nothing to check the bytes against.
  if (!isSha256(sha256)) throw new HfLookupError('setup.hf.error.noHash', 422)
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
    throw new HfLookupError('setup.hf.error.lookup', 502)
  }
  return {
    repo: file.repo,
    revision: file.revision,
    path: file.path,
    commit,
    sha256,
    size,
    license: licenseOf(info.cardData),
    gated: info.gated !== false && info.gated !== undefined && info.gated !== null,
  }
}
