// Writing finished images into the gallery's save folder, with their settings.
//
// Backends save their own copies (or not), in their own layout, often without
// the settings. Latentry has the request and the PNG in hand when an image
// arrives, so it writes its own copy with both: an A1111-style `parameters`
// chunk any tool can read, and a `latentry` record with every field. The
// gallery reads them back, and "generate with these settings" restores them.

import { randomBytes } from 'node:crypto'
import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getTagger } from '@/lib/tagger'
import { serverMessage } from '@/lib/i18n/core'
import { autoTagEnabled, getSaveDir, type GalleryDir } from './dirs'
import { invalidateListing, resolveInDir } from './fs'
import {
  formatA1111Parameters,
  isPng,
  LATENTRY_KEY,
  PARAMETERS_KEY,
  readPngText,
  TAGS_KEY,
  writePngText,
  type ImageTag,
  type LatentryRecord,
} from './png-meta'
import type { ImageSink, Job, JobImage } from '@/lib/diffusion/job-store'

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** `20261003-142530_anima_12345_0.png`: sortable, and says where it came from. */
export function fileNameFor(backend: string, seed: number, index: number, date: Date): string {
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const safeBackend = backend.replace(/[^a-z0-9_-]/gi, '')
  return `${stamp}_${safeBackend}_${seed}_${index}.png`
}

export function recordFor(job: Job, image: JobImage, created: Date, size: { width: number; height: number } | null): LatentryRecord {
  const { request, profile, kind, model, mode } = job.context
  return {
    schema: 1,
    backend: job.backend,
    kind,
    profile,
    model,
    mode,
    prompt: request.prompt,
    negative_prompt: request.negative_prompt,
    seed: image.seed,
    // The size the picture actually came out at: img2img fits it to the source.
    width: size?.width ?? request.width,
    height: size?.height ?? request.height,
    sampler: request.sampler,
    scheduler: request.scheduler,
    steps: request.num_inference_steps,
    cfg: request.guidance_scale,
    ...(request.strength !== undefined ? { strength: request.strength } : {}),
    created: created.toISOString(),
  }
}

/** Writes beside the target and renames over it, so a reader never sees half a file. */
async function writeAtomically(file: string, data: Buffer): Promise<void> {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(temp, data)
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

async function uniqueName(dir: GalleryDir, name: string): Promise<string> {
  const ext = path.extname(name)
  const stem = name.slice(0, -ext.length)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt ? `${stem}-${attempt}${ext}` : name
    try {
      await access(path.join(dir.path, candidate))
    } catch {
      return candidate
    }
  }
  return `${stem}-${randomBytes(3).toString('hex')}${ext}`
}

/**
 * The image sink for the job store: saves each finished image to
 * GALLERY_SAVE_DIR, or does nothing when it is unset. Throws (with a message
 * the page can translate) when the folder cannot be written.
 */
export const saveToGallery: ImageSink = async (job, image, index) => {
  const dir = getSaveDir()
  if (!dir || !image.image_base64) return null

  const created = new Date()
  let png: Buffer = Buffer.from(image.image_base64, 'base64')
  if (!isPng(png)) return null

  try {
    // A backend that already wrote infotext (A1111 does) keeps it; ours fills
    // in what it does not have.
    const existing = readPngText(png)
    const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
    const record = recordFor(job, image, created, size)
    png = writePngText(png, {
      ...(existing[PARAMETERS_KEY] ? {} : { [PARAMETERS_KEY]: formatA1111Parameters(record) }),
      [LATENTRY_KEY]: JSON.stringify(record),
    })
    const name = await uniqueName(dir, fileNameFor(job.backend, image.seed, index, created))
    await writeAtomically(path.join(dir.path, name), png)
    invalidateListing(dir)
    if (autoTagEnabled()) void autoTag(dir, name, image.image_base64)
    return name
  } catch (error) {
    console.error('Saving to the gallery failed:', error)
    const reason = error instanceof Error && 'code' in error ? String((error as { code?: unknown }).code) : 'write'
    throw new Error(serverMessage('generate.saveFailed', { reason }))
  }
}

/**
 * GALLERY_AUTO_TAG=1 (or the setting): tags each saved image as it arrives. Off by default, since
 * it runs the tagger once per image on a backend that may be busy generating.
 */
async function autoTag(dir: GalleryDir, name: string, imageBase64: string): Promise<void> {
  try {
    const tagger = await getTagger()
    const result = await tagger?.tag(imageBase64)
    if (result?.ok) await writeTags(dir, name, result.value.tags)
  } catch (error) {
    console.error('Auto-tagging failed:', error)
  }
}

/**
 * Writes WD14 tags into a picture in the save folder. Only that folder is
 * ever written; the others are someone else's files.
 */
export async function writeTags(dir: GalleryDir, name: string, tags: ImageTag[]): Promise<boolean> {
  if (!dir.writable) return false
  const file = await resolveInDir(dir, name)
  if (!file || path.extname(file).toLowerCase() !== '.png') return false
  const png = await readFile(file)
  await writeAtomically(file, writePngText(png, { [TAGS_KEY]: JSON.stringify(tags) }))
  invalidateListing(dir)
  return true
}
