// WD14 tagging inside Latentry: a SmilingWolf WD tagger (ONNX) run on the
// CPU with onnxruntime-node, so pictures can be tagged without any backend
// offering a tagger.
//
// The model is not shipped. Download one into a folder of its own:
//
//   https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3   (best, ~1.2 GB)
//   https://huggingface.co/SmilingWolf/wd-vit-tagger-v3           (smaller, ~0.4 GB)
//
// taking model.onnx and selected_tags.csv (all v2/v3 models are Apache-2.0),
// then point WD14_MODEL_DIR or the settings page at the folder.
//
// Preprocessing follows SmilingWolf's reference: the picture flattened onto
// white, padded to a square, resized to the model's input, as BGR floats 0-255.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import type { WdTag } from '@/lib/backends/types'

export const CATEGORY_GENERAL = 0
export const CATEGORY_CHARACTER = 4
export const CATEGORY_RATING = 9

const DEFAULT_INPUT_SIZE = 448

export interface Wd14Thresholds {
  /** For general tags (SmilingWolf's demo uses 0.35). */
  general: number
  /** For named characters, which want more certainty (demo: 0.85). */
  character: number
}

export const DEFAULT_THRESHOLDS: Wd14Thresholds = { general: 0.35, character: 0.85 }

export function modelFiles(dir: string): { model: string; tags: string } {
  return { model: path.join(dir, 'model.onnx'), tags: path.join(dir, 'selected_tags.csv') }
}

/** Whether a folder holds a WD tagger: model.onnx and selected_tags.csv. */
export function hasModel(dir: string | null | undefined): boolean {
  if (!dir) return false
  const files = modelFiles(dir)
  return existsSync(/*turbopackIgnore: true*/ files.model) && existsSync(/*turbopackIgnore: true*/ files.tags)
}

/** selected_tags.csv: tag_id,name,category,count. Pure, for the verify script. */
export function parseSelectedTags(csv: string): { names: string[]; categories: number[] } {
  const lines = csv.replace(/\r\n?/g, '\n').split('\n').filter(Boolean)
  const header = lines.shift()?.split(',') ?? []
  const nameAt = header.indexOf('name')
  const categoryAt = header.indexOf('category')
  if (nameAt === -1) throw new Error('selected_tags.csv has no "name" column')
  const names: string[] = []
  const categories: number[] = []
  for (const line of lines) {
    // Tag names never contain commas, so a plain split is enough.
    const cells = line.split(',')
    names.push(cells[nameAt])
    categories.push(Number(cells[categoryAt] ?? CATEGORY_GENERAL) || CATEGORY_GENERAL)
  }
  return { names, categories }
}

/** Interleaved RGB bytes (size x size) to the model's NHWC BGR float input. Pure. */
export function toBgrTensor(rgb: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size * size * 3)
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    out[pixel * 3] = rgb[pixel * 3 + 2]
    out[pixel * 3 + 1] = rgb[pixel * 3 + 1]
    out[pixel * 3 + 2] = rgb[pixel * 3]
  }
  return out
}

/** Scores to tags: ratings dropped, each category against its threshold, best first. Pure. */
export function selectTags(
  scores: ArrayLike<number>,
  names: string[],
  categories: number[],
  thresholds: Wd14Thresholds
): WdTag[] {
  const tags: WdTag[] = []
  for (let index = 0; index < names.length && index < scores.length; index += 1) {
    const category = categories[index]
    if (category === CATEGORY_RATING) continue
    const threshold = category === CATEGORY_CHARACTER ? thresholds.character : thresholds.general
    const score = scores[index]
    if (score >= threshold) tags.push({ name: names[index], score: Math.round(score * 10000) / 10000, category })
  }
  return tags.sort((a, b) => b.score - a.score)
}

type Ort = typeof import('onnxruntime-node')

interface Loaded {
  dir: string
  ort: Ort
  session: import('onnxruntime-node').InferenceSession
  inputName: string
  size: number
  names: string[]
  categories: number[]
}

// One model in memory at a time, kept across requests and hot reloads.
const globalForWd14 = globalThis as typeof globalThis & {
  __wd14?: { loading: Promise<Loaded> | null; dir: string | null; queue: Promise<unknown> }
}
const state = (globalForWd14.__wd14 ??= { loading: null, dir: null, queue: Promise.resolve() })

async function load(dir: string): Promise<Loaded> {
  // Imported on first use: a native module, and most requests never tag.
  const ort = await import('onnxruntime-node')
  const files = modelFiles(dir)
  const { names, categories } = parseSelectedTags(readFileSync(/*turbopackIgnore: true*/ files.tags, 'utf8'))
  const session = await ort.InferenceSession.create(files.model, { executionProviders: ['cpu'] })
  const inputName = session.inputNames[0]
  // NHWC: [batch, height, width, channels]. Older runtimes do not expose shapes.
  let size = DEFAULT_INPUT_SIZE
  const metadata = (session as unknown as { inputMetadata?: { shape?: unknown[] }[] }).inputMetadata?.[0]
  const height = metadata?.shape?.[1]
  if (typeof height === 'number' && height > 0) size = height
  return { dir, ort, session, inputName, size, names, categories }
}

function loaded(dir: string): Promise<Loaded> {
  if (state.dir !== dir || !state.loading) {
    state.dir = dir
    state.loading = load(dir).catch((error) => {
      state.loading = null
      throw error
    })
  }
  return state.loading
}

/**
 * WD14 tags for a picture (base64, bare or a data: URL). Runs one picture at a
 * time: a second request waits rather than doubling the CPU and memory load.
 */
export async function tagImage(dir: string, imageBase64: string, thresholds: Wd14Thresholds = DEFAULT_THRESHOLDS): Promise<WdTag[]> {
  const run = async () => {
    const model = await loaded(dir)
    const bytes = Buffer.from(imageBase64.startsWith('data:') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64, 'base64')
    const { data } = await sharp(bytes)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(model.size, model.size, { fit: 'contain', background: '#ffffff', kernel: 'cubic' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const input = new model.ort.Tensor('float32', toBgrTensor(data, model.size), [1, model.size, model.size, 3])
    const output = await model.session.run({ [model.inputName]: input })
    const scores = output[model.session.outputNames[0]].data as Float32Array
    return selectTags(scores, model.names, model.categories, thresholds)
  }
  const result = state.queue.then(run, run)
  state.queue = result.catch(() => {})
  return result
}
