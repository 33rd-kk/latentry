// Prints the pins Latentry checks its downloads against, for pasting into
// lib/engine/uv-release.ts and lib/engine/catalog.ts. It changes no file:
// read what it prints before trusting it.
//
//   node scripts/pin-downloads.mjs uv <version>
//       SHA-256 of each uv build Latentry may install, from that release's
//       own .sha256 files.
//   node scripts/pin-downloads.mjs hf <owner/name> [file...]
//       The repository's current commit, and the SHA-256 of each file named:
//       from Hugging Face's metadata for large (LFS) files, by downloading
//       the file for small ones.
//
// HF_TOKEN is sent to huggingface.co when set, for gated repositories.

import { createHash } from 'node:crypto'

const UV_ASSETS = [
  'uv-x86_64-pc-windows-msvc.zip',
  'uv-aarch64-pc-windows-msvc.zip',
  'uv-x86_64-apple-darwin.tar.gz',
  'uv-aarch64-apple-darwin.tar.gz',
  'uv-x86_64-unknown-linux-gnu.tar.gz',
  'uv-aarch64-unknown-linux-gnu.tar.gz',
]

async function text(url, headers = {}) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

async function uv(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('usage: pin-downloads.mjs uv <version>, e.g. 0.12.23')
  console.log(`export const UV_VERSION = '${version}'`)
  console.log('export const UV_SHA256: Record<string, string> = {')
  for (const asset of UV_ASSETS) {
    const line = await text(`https://github.com/astral-sh/uv/releases/download/${version}/${asset}.sha256`)
    const hash = line.trim().split(/\s+/)[0]
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`${asset}: not a SHA-256: ${line}`)
    console.log(`  '${asset}': '${hash}',`)
  }
  console.log('}')
}

async function hf(repo, files) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('usage: pin-downloads.mjs hf <owner/name> [file...]')
  const headers = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {}
  const info = JSON.parse(await text(`https://huggingface.co/api/models/${repo}/revision/main?blobs=true`, headers))
  const revision = info.sha
  console.log(`    revision: '${revision}',`)
  if (!files.length) return
  console.log('    sha256: {')
  for (const file of files) {
    const sibling = (info.siblings ?? []).find((entry) => entry.rfilename === file)
    if (!sibling) throw new Error(`${repo} has no ${file}`)
    let hash = sibling.lfs?.sha256
    if (!hash) {
      const response = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${file}`, { headers })
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
      hash = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
    }
    console.log(`      '${file}': '${hash}',`)
  }
  console.log('    },')
}

const [kind, ...rest] = process.argv.slice(2)
try {
  if (kind === 'uv') await uv(rest[0])
  else if (kind === 'hf') await hf(rest[0], rest.slice(1))
  else throw new Error('usage: pin-downloads.mjs uv <version> | hf <owner/name> [file...]')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
