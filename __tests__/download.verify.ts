/**
 * Pinned downloads (lib/engine/download.ts): a file is kept only when its
 * SHA-256 is the pinned one, and nothing is left behind otherwise. Against a
 * local server, so no network is needed.
 *
 * Run with: npm test -- download
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { ChecksumError, downloadVerified } from '../lib/engine/download'

const BODY = Buffer.from('the pinned bytes '.repeat(10_000))
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function main() {
  const server = createServer((request, response) => {
    if (request.url === '/missing') {
      response.writeHead(404)
      return response.end()
    }
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    response.end(request.url === '/tampered' ? Buffer.concat([BODY, Buffer.from('!')]) : BODY)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const dir = await mkdtemp(path.join(tmpdir(), 'latentry-download-'))
  try {
    let counted = 0
    const target = path.join(dir, 'model.onnx')
    await downloadVerified(`${base}/file`, target, { sha256: sha256(BODY), onBytes: (count) => (counted += count) })
    check((await readFile(target)).equals(BODY), 'a file with the pinned hash is kept')
    eq(counted, BODY.length, 'and its progress adds up')
    eq(await readdir(dir), ['model.onnx'], 'with no .part left over')

    const tampered = path.join(dir, 'tampered.onnx')
    const refused = await downloadVerified(`${base}/tampered`, tampered, { sha256: sha256(BODY) }).then(
      () => null,
      (error: unknown) => error
    )
    check(refused instanceof ChecksumError && refused.expected === sha256(BODY), 'a file with other bytes is refused, by name')
    eq(await readdir(dir), ['model.onnx'], 'and leaves nothing behind')

    const missing = await downloadVerified(`${base}/missing`, path.join(dir, 'missing.onnx'), { sha256: sha256(BODY) }).then(
      () => null,
      (error: unknown) => error
    )
    check(missing instanceof Error && /HTTP 404/.test(missing.message), 'an HTTP error says so')
    const unpinned = await downloadVerified(`${base}/file`, path.join(dir, 'unpinned.onnx'), { sha256: '' }).then(
      () => null,
      (error: unknown) => error
    )
    check(unpinned instanceof Error && /No pinned SHA-256/.test(unpinned.message), 'a download with no pin is not even started')
    eq(await readdir(dir), ['model.onnx'], 'neither leaves anything')
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
  done('download')
}

void main()
