// Control pictures made inside Latentry, on the CPU, so every backend gets
// the same one and the reference picture never leaves this computer: Canny
// edges in plain TypeScript (canny.ts), and a depth map and line art from
// small ONNX models run with onnxruntime-node.
//
// The models are not shipped: Setup downloads them on request, pinned to a
// commit and checked against their SHA-256 (lib/engine/catalog.ts, kind
// 'annotator'), into <models>/annotators/<id>. Nothing is fetched until then,
// and nothing is written while a picture is made.

import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { catalogEntry } from '@/lib/engine/catalog'
import { localModelDir } from '@/lib/engine/tagger-download'
import { cannyEdges, CANNY_DEFAULTS } from './canny'

export const CONTROL_KINDS = ['canny', 'depth', 'lineart'] as const
export type ControlKind = (typeof CONTROL_KINDS)[number]

/** The catalog entry each model-made kind is downloaded from. */
export const ANNOTATOR_ENTRY: Record<Exclude<ControlKind, 'canny'>, string> = {
  depth: 'depth-anything-v2-small',
  lineart: 'informative-drawings-lineart',
}

/** The control picture's longest side at most: as large as any backend draws at, and quick on a CPU. */
export const CONTROL_MAX_EDGE = 1024
/** Depth Anything's own input size (its shorter side) and the grid its sides must sit on. */
const DEPTH_SIDE = 518
const DEPTH_MULTIPLE = 14
const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD = [0.229, 0.224, 0.225]
/** Line art at this longest side; the network is fully convolutional, its sides on an 8-pixel grid. */
const LINEART_EDGE = 768

export interface ControlOptions {
  /** Canny's two thresholds, 1–255 each. */
  low?: number
  high?: number
}

export class AnnotatorMissingError extends Error {
  constructor(readonly kind: ControlKind) {
    super(`The ${kind} model is not downloaded`)
  }
}

/** The model file a kind runs, when it has been downloaded. */
export function annotatorFile(kind: Exclude<ControlKind, 'canny'>): string | null {
  const entry = catalogEntry(ANNOTATOR_ENTRY[kind])
  const file = entry?.files?.[0]
  if (!entry || !file) return null
  const target = path.join(localModelDir(entry), path.basename(file))
  return existsSync(/*turbopackIgnore: true*/ target) ? target : null
}

type Session = import('onnxruntime-node').InferenceSession

// Sessions stay loaded across requests and hot reloads; one picture at a time.
const globalForControl = globalThis as typeof globalThis & {
  __latentryControl?: { sessions: Map<string, Promise<Session>>; queue: Promise<unknown> }
}
const state = (globalForControl.__latentryControl ??= { sessions: new Map(), queue: Promise.resolve() })

function session(file: string): Promise<Session> {
  let loading = state.sessions.get(file)
  if (!loading) {
    loading = import('onnxruntime-node').then((ort) => ort.InferenceSession.create(file, { executionProviders: ['cpu'] }))
    loading.catch(() => state.sessions.delete(file))
    state.sessions.set(file, loading)
  }
  return loading
}

/** One at a time: a CPU is busy enough with one picture. */
function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = state.queue.then(work, work)
  state.queue = run.catch(() => null)
  return run
}

/** Sides on a `multiple` grid, at least one cell each. */
function onGrid(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

/** The size a picture is made at: its own, the longest side at most `edge`. */
export function fitWithin(width: number, height: number, edge: number = CONTROL_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * The control picture for `kind` from a picture (PNG, JPEG or WebP bytes): a
 * PNG, greyscale, white on black, at the picture's aspect ratio with its
 * longest side at most CONTROL_MAX_EDGE. Throws AnnotatorMissingError before
 * Setup has downloaded depth's or lineart's model.
 */
export async function controlPicture(kind: ControlKind, picture: Buffer, options: ControlOptions = {}): Promise<Buffer> {
  const meta = await sharp(picture).metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read the picture')
  const target = fitWithin(meta.width, meta.height)
  if (kind === 'canny') return canny(picture, target, options)
  const file = annotatorFile(kind)
  if (!file) throw new AnnotatorMissingError(kind)
  return queued(() => (kind === 'depth' ? depth(file, picture, target) : lineart(file, picture, target)))
}

async function canny(picture: Buffer, target: { width: number; height: number }, options: ControlOptions): Promise<Buffer> {
  const low = clampThreshold(options.low, CANNY_DEFAULTS.low)
  const high = Math.max(low, clampThreshold(options.high, CANNY_DEFAULTS.high))
  // A light blur first, as OpenCV's users (and ControlNet's preprocessor) do.
  const { data, info } = await sharp(picture).rotate().resize(target.width, target.height, { fit: 'fill' }).greyscale().blur(1).raw().toBuffer({ resolveWithObject: true })
  const edges = cannyEdges(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height, low, high)
  return sharp(Buffer.from(edges), { raw: { width: info.width, height: info.height, channels: 1 } }).toColourspace('b-w').png().toBuffer()
}

function clampThreshold(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(255, Math.max(1, Math.round(value))) : fallback
}

/** RGB pixels as a (1, 3, h, w) tensor's data, each channel through `map`. */
function planes(data: Buffer, width: number, height: number, map: (value: number, channel: number) => number): Float32Array {
  const size = width * height
  const out = new Float32Array(3 * size)
  for (let index = 0; index < size; index++) {
    for (let channel = 0; channel < 3; channel++) out[channel * size + index] = map(data[index * 3 + channel], channel)
  }
  return out
}

/** A single-channel float map as a PNG at `target`, scaled so `low`..`high` spans black to white. */
async function greyPng(values: Float32Array, width: number, height: number, target: { width: number; height: number }, low: number, high: number, invert = false): Promise<Buffer> {
  const span = high - low || 1
  const bytes = new Uint8Array(width * height)
  for (let index = 0; index < bytes.length; index++) {
    const level = Math.min(1, Math.max(0, (values[index] - low) / span))
    bytes[index] = Math.round((invert ? 1 - level : level) * 255)
  }
  return sharp(Buffer.from(bytes), { raw: { width, height, channels: 1 } }).resize(target.width, target.height, { fit: 'fill' }).toColourspace('b-w').png().toBuffer()
}

async function depth(file: string, picture: Buffer, target: { width: number; height: number }): Promise<Buffer> {
  // Depth Anything's own preprocessing: shorter side 518, both on a 14-pixel grid, ImageNet's normalisation.
  const scale = DEPTH_SIDE / Math.min(target.width, target.height)
  const width = onGrid(target.width * scale, DEPTH_MULTIPLE)
  const height = onGrid(target.height * scale, DEPTH_MULTIPLE)
  const { data } = await sharp(picture).rotate().removeAlpha().resize(width, height, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true })
  const ort = await import('onnxruntime-node')
  const model = await session(file)
  const input = new ort.Tensor('float32', planes(data, width, height, (value, channel) => (value / 255 - IMAGENET_MEAN[channel]) / IMAGENET_STD[channel]), [1, 3, height, width])
  const output = (await model.run({ [model.inputNames[0]]: input }))[model.outputNames[0]]
  const [, outHeight, outWidth] = output.dims as number[]
  const values = output.data as Float32Array
  // Relative depth, larger for nearer: near is white.
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  return greyPng(values, outWidth, outHeight, target, low, high)
}

async function lineart(file: string, picture: Buffer, target: { width: number; height: number }): Promise<Buffer> {
  const sized = fitWithin(target.width, target.height, LINEART_EDGE)
  const width = onGrid(sized.width, 8)
  const height = onGrid(sized.height, 8)
  const { data } = await sharp(picture).rotate().removeAlpha().resize(width, height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const ort = await import('onnxruntime-node')
  const model = await session(file)
  const input = new ort.Tensor('float32', planes(data, width, height, (value) => value / 255), [1, 3, height, width])
  const output = (await model.run({ [model.inputNames[0]]: input }))[model.outputNames[0]]
  const dims = output.dims as number[]
  // A drawing, dark lines on white (0–1): turned to white lines on black.
  return greyPng(output.data as Float32Array, dims[3], dims[2], target, 0, 1, true)
}
