// A Hugging Face file URL the user typed on the setup page, taken apart into
// the pieces Latentry needs. Nothing here fetches anything: the server never
// requests the typed string, only URLs it builds from these pieces for
// huggingface.co (./hf-resolve.ts), so a URL cannot point it anywhere else.
//
// Only one .safetensors file: no whole repository (it can carry code), and
// no pickle formats (.ckpt, .bin, .pt), which run code when loaded.

import type { MessageKey } from '@/lib/i18n/core'

export interface HfFile {
  /** "owner/name". */
  repo: string
  /** A branch, tag or commit, as typed; ./hf-resolve.ts turns it into a commit. */
  revision: string
  /** The file inside the repository, "/"-separated, e.g. "unet/model.safetensors". */
  path: string
}

export type HfUrlResult = ({ ok: true } & HfFile) | { ok: false; error: MessageKey }

const HOSTS = new Set(['huggingface.co', 'hf.co'])
// Two plain parts, as engine/latentry_engine/models.py is_repo_id checks.
const REPO_PART = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/
const REVISION = /^[A-Za-z0-9_.-]{1,100}$/
// A file or folder name that is safe on every OS: no separators, no Windows
// reserved characters, no control characters.
const SEGMENT = /^[A-Za-z0-9 _.()+,=@[\]-]{1,200}$/
const MAX_DEPTH = 8

function plainRepoPart(part: string): boolean {
  return REPO_PART.test(part) && part !== '.' && part !== '..' && !part.endsWith('.')
}

function plainSegment(segment: string): boolean {
  return SEGMENT.test(segment) && segment !== '.' && segment !== '..' && !segment.endsWith('.') && !segment.endsWith(' ')
}

/**
 * https://huggingface.co/<owner>/<name>/(blob|resolve)/<revision>/<file…>,
 * or the same on hf.co, optionally with ?download=true. Anything else is refused.
 */
export function parseHfFileUrl(input: string): HfUrlResult {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { ok: false, error: 'setup.hf.error.url' }
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    return { ok: false, error: 'setup.hf.error.host' }
  }
  if (url.hash || (url.search && url.search !== '?download=true')) return { ok: false, error: 'setup.hf.error.url' }

  const raw = url.pathname.split('/').slice(1)
  if (raw.length < 5 || (raw[2] !== 'blob' && raw[2] !== 'resolve')) return { ok: false, error: 'setup.hf.error.notFile' }
  let parts: string[]
  try {
    parts = raw.map((part) => decodeURIComponent(part))
  } catch {
    return { ok: false, error: 'setup.hf.error.url' }
  }
  const [owner, name, , revision, ...file] = parts
  if (!plainRepoPart(owner) || !plainRepoPart(name)) return { ok: false, error: 'setup.hf.error.url' }
  if (!REVISION.test(revision) || revision === '.' || revision === '..') return { ok: false, error: 'setup.hf.error.revision' }
  if (file.length > MAX_DEPTH || !file.every(plainSegment)) return { ok: false, error: 'setup.hf.error.url' }
  if (!file[file.length - 1].endsWith('.safetensors')) return { ok: false, error: 'setup.hf.error.notSafetensors' }
  return { ok: true, repo: `${owner}/${name}`, revision, path: file.join('/') }
}
