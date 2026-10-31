/**
 * Downloads by Hugging Face URL: which URLs are taken apart into a file
 * (lib/engine/hf-url.ts), and what the lookup on the Hub's API accepts
 * (lib/engine/hf-resolve.ts). The API is stood in for, so no network is needed.
 *
 * Run with: npm test -- hf-url
 */
import { done, eq } from './assert'
import { HfLookupError, resolveHfFile } from '../lib/engine/hf-resolve'
import { parseHfFileUrl } from '../lib/engine/hf-url'

const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01'
const SHA = 'e'.repeat(64)

function file(url: string) {
  const parsed = parseHfFileUrl(url)
  return parsed.ok ? { repo: parsed.repo, revision: parsed.revision, path: parsed.path } : parsed.error
}

function answer(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () => (typeof body === 'string' ? new Response(body, init) : Response.json(body, init))) as typeof fetch
}

const INFO = {
  sha: COMMIT,
  cardData: { license: ['openrail', 'mit'] },
  gated: 'manual',
  siblings: [
    { rfilename: 'model.safetensors', size: 1234, lfs: { sha256: SHA, size: 1234 } },
    { rfilename: 'small.safetensors', size: 10 },
  ],
}

async function lookupError(fetchImpl: typeof fetch, revision = 'main', path = 'model.safetensors') {
  return resolveHfFile({ repo: 'owner/name', revision, path }, fetchImpl).then(
    () => null,
    (error: unknown) => (error instanceof HfLookupError ? [error.key, error.status] : error)
  )
}

async function main() {
  // ── Taking a URL apart ──
  eq(
    file('https://huggingface.co/owner/name/blob/main/model.safetensors'),
    { repo: 'owner/name', revision: 'main', path: 'model.safetensors' },
    'a blob link names one file'
  )
  eq(
    file(` https://hf.co/Owner-1/name.v2/resolve/${COMMIT}/unet/lora%20v1.safetensors?download=true `),
    { repo: 'Owner-1/name.v2', revision: COMMIT, path: 'unet/lora v1.safetensors' },
    'so does a resolve link on hf.co, in a subfolder, with ?download=true'
  )
  for (const [url, error] of [
    ['http://huggingface.co/owner/name/blob/main/model.safetensors', 'setup.hf.error.host'],
    ['https://huggingface.co.evil.example/owner/name/blob/main/model.safetensors', 'setup.hf.error.host'],
    ['https://evil.example/huggingface.co/owner/name/blob/main/model.safetensors', 'setup.hf.error.host'],
    ['https://huggingface.co:8443/owner/name/blob/main/model.safetensors', 'setup.hf.error.host'],
    ['https://user:pass@huggingface.co/owner/name/blob/main/model.safetensors', 'setup.hf.error.host'],
    ['https://127.0.0.1/owner/name/blob/main/model.safetensors', 'setup.hf.error.host'],
    ['file:///C:/models/model.safetensors', 'setup.hf.error.host'],
    ['not a url', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/main/model.safetensors?x=1', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/main/model.safetensors#top', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name', 'setup.hf.error.notFile'],
    ['https://huggingface.co/owner/name/tree/main/unet', 'setup.hf.error.notFile'],
    ['https://huggingface.co/owner/name/blob/main/model.ckpt', 'setup.hf.error.notSafetensors'],
    ['https://huggingface.co/owner/name/blob/main/model.bin', 'setup.hf.error.notSafetensors'],
    ['https://huggingface.co/owner/name/blob/main/model.SAFETENSORS', 'setup.hf.error.notSafetensors'],
    ['https://huggingface.co/owner/name/blob/main/sub%2F..%2F..%2Fmodel.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/main/sub%5Cmodel.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/main/a%3Ab.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/main/%E0%A4%A.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/main//model.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name./blob/main/model.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/-owner/name/blob/main/model.safetensors', 'setup.hf.error.url'],
    ['https://huggingface.co/owner/name/blob/refs%2Fpr%2F1/model.safetensors', 'setup.hf.error.revision'],
    ['https://huggingface.co/owner/name/blob/a/b/c/d/e/f/g/h/i/model.safetensors', 'setup.hf.error.url'],
  ] as const) {
    eq(file(url), error, `refused: ${url}`)
  }
  eq(
    file('https://huggingface.co/owner/name/blob/main/sub/../model.safetensors'),
    { repo: 'owner/name', revision: 'main', path: 'model.safetensors' },
    'dot segments are settled by the URL parser before anything is checked'
  )

  // ── Looking it up ──
  let asked: { url: string; init?: RequestInit } | null = null
  const hub = (async (url: string, init?: RequestInit) => {
    asked = { url, init }
    return Response.json(INFO)
  }) as typeof fetch
  process.env.HF_TOKEN = 'hf_test'
  try {
    const resolved = await resolveHfFile({ repo: 'owner/name', revision: 'main', path: 'model.safetensors' }, hub)
    eq(
      resolved,
      { repo: 'owner/name', revision: 'main', path: 'model.safetensors', commit: COMMIT, sha256: SHA, size: 1234, license: 'openrail, mit', gated: true },
      "the commit, and the Hub's own size and SHA-256 for the file"
    )
    const seen = asked as { url: string; init?: RequestInit } | null
    eq(seen?.url, 'https://huggingface.co/api/models/owner/name/revision/main?blobs=true', 'asked of huggingface.co at a URL built here')
    eq([seen?.init?.redirect, new Headers(seen?.init?.headers).get('authorization')], ['manual', 'Bearer hf_test'], 'with HF_TOKEN, and redirects not followed')
  } finally {
    delete process.env.HF_TOKEN
  }

  eq(await lookupError(answer(INFO), 'main', 'small.safetensors'), ['setup.hf.error.noHash', 422], 'a file with no SHA-256 on the Hub is refused')
  eq(await lookupError(answer(INFO), 'main', 'other.safetensors'), ['setup.hf.error.missing', 404], 'so is one not in the repository')
  eq(await lookupError(answer(INFO), 'b'.repeat(40)), ['setup.hf.error.lookup', 502], 'and an answer for another commit than the one asked')
  eq(await lookupError(answer({ ...INFO, sha: 'main' })), ['setup.hf.error.lookup', 502], 'or with no commit')
  eq(
    await lookupError(answer({ ...INFO, siblings: [{ rfilename: 'model.safetensors', lfs: { sha256: SHA, size: -1 } }] })),
    ['setup.hf.error.lookup', 502],
    'or with a size that is not one'
  )
  eq(await lookupError(answer('', { status: 307, headers: { location: 'https://evil.example/' } })), ['setup.hf.error.moved', 409], 'a redirect is refused, not followed')
  eq(await lookupError(answer({}, { status: 401 })), ['setup.hf.error.private', 403], 'a private or gated repository says so')
  eq(await lookupError(answer({}, { status: 404 })), ['setup.hf.error.missing', 404], 'a missing one too')
  eq(await lookupError(answer('not json')), ['setup.hf.error.lookup', 502], 'an answer that is not JSON is refused')
  eq(await lookupError(answer('x'.repeat(9 * 1024 * 1024))), ['setup.hf.error.lookup', 502], 'and so is one too large to read')
  eq(
    await lookupError((async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch),
    ['setup.hf.error.unreachable', 502],
    'no answer at all says Hugging Face could not be reached'
  )
  done('hf-url')
}

void main()
