// Finding faces inside Latentry: a small ONNX detector run on the CPU with
// onnxruntime-node, so Face fix works the same on every backend. The models
// are not shipped: Setup downloads them on request, pinned to a commit and
// checked against their SHA-256 (lib/engine/catalog.ts), into
// <models>/detectors/<id>. Nothing is fetched until then, and a picture
// never leaves this computer to be looked at.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { decodeImage, fitsDecode } from '@/lib/images/decode'
import type { FaceDetector } from '@/lib/generate/facefix'
import { catalogEntry } from '@/lib/engine/catalog'
import { detectorDir } from '@/lib/engine/tagger-download'
import { decodeYolo, decodeYunet, letterbox, suppress, toChw, type FaceBox } from './decode'

/** The catalog entry each detector is downloaded from. */
export const DETECTOR_ENTRY: Record<FaceDetector, string> = { photo: 'yunet-2023mar', anime: 'anime-face-v1.4n' }

/** YuNet takes a fixed square; the anime model is run at the size it was trained at. */
const INPUT_SIZE = 640
/** Boxes that overlap more than this are one face. */
const NMS_IOU = 0.4

/** The model file a detector runs, when it has been downloaded. */
export function detectorFile(detector: FaceDetector): string | null {
  const entry = catalogEntry(DETECTOR_ENTRY[detector])
  const file = entry?.files?.[0]
  if (!entry || !file) return null
  const target = path.join(detectorDir(entry), path.basename(file))
  return existsSync(/*turbopackIgnore: true*/ target) ? target : null
}

type Session = import('onnxruntime-node').InferenceSession

// Sessions stay loaded across requests and hot reloads; one detection at a time.
const globalForFaces = globalThis as typeof globalThis & {
  __latentryFaces?: { sessions: Map<string, Promise<Session>>; queue: Promise<unknown> }
}
const state = (globalForFaces.__latentryFaces ??= { sessions: new Map(), queue: Promise.resolve() })

function session(file: string): Promise<Session> {
  let loading = state.sessions.get(file)
  if (!loading) {
    loading = import('onnxruntime-node').then((ort) => ort.InferenceSession.create(file, { executionProviders: ['cpu'] }))
    loading.catch(() => state.sessions.delete(file))
    state.sessions.set(file, loading)
  }
  return loading
}

export class DetectorMissingError extends Error {
  constructor(readonly detector: FaceDetector) {
    super(`The ${detector} face detector is not downloaded`)
  }
}

/**
 * The faces in a picture (base64), surest first, at most `max`, in the
 * picture's own pixels. Throws DetectorMissingError before Setup has
 * downloaded the detector.
 */
export async function detectFaces(imageBase64: string, detector: FaceDetector, options: { confidence: number; max: number }): Promise<FaceBox[]> {
  const file = detectorFile(detector)
  if (!file) throw new DetectorMissingError(detector)
  const run = state.queue.then(async () => {
    const source = decodeImage(Buffer.from(imageBase64, 'base64'))
    // A picture too large to decode (sharp refuses even its header) has no faces to find.
    const { width = 0, height = 0 } = await source.metadata().catch(() => ({ width: 0, height: 0 }))
    if (!fitsDecode({ width, height })) return []
    const fit = letterbox(width, height, INPUT_SIZE)
    // Letterboxed onto grey, as both models were trained.
    const rgb = await source
      .clone()
      .flatten({ background: '#727272' })
      .resize(Math.round(width * fit.scale), Math.round(height * fit.scale))
      .extend({
        left: fit.padX,
        top: fit.padY,
        right: INPUT_SIZE - fit.padX - Math.round(width * fit.scale),
        bottom: INPUT_SIZE - fit.padY - Math.round(height * fit.scale),
        background: '#727272',
      })
      .removeAlpha()
      .raw()
      .toBuffer()
    const ort = await import('onnxruntime-node')
    const model = await session(file)
    const input = new ort.Tensor('float32', toChw(rgb, INPUT_SIZE, detector === 'photo' ? 'bgr255' : 'rgb01'), [1, 3, INPUT_SIZE, INPUT_SIZE])
    const outputs = await model.run({ [model.inputNames[0]]: input })
    let faces: FaceBox[]
    if (detector === 'photo') {
      faces = decodeYunet(Object.fromEntries(Object.entries(outputs).map(([name, tensor]) => [name, tensor.data as Float32Array])), fit, options.confidence)
    } else {
      const output = outputs[model.outputNames[0]]
      faces = decodeYolo(output.data as Float32Array, output.dims[2] ?? 0, fit, options.confidence)
    }
    return suppress(faces, NMS_IOU, options.max)
  })
  state.queue = run.catch(() => undefined)
  return run
}
