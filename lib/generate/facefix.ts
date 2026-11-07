// Face fix's options, shared by the page and the server: nothing here touches
// Node. The server reads them again from the request, field by field.

export const FACE_DETECTORS = ['photo', 'anime'] as const
export type FaceDetector = (typeof FACE_DETECTORS)[number]

export interface FaceFixOptions {
  /** Which detector finds the faces: YuNet for photos, a YOLO model for anime. */
  detector: FaceDetector
  /** How sure the detector must be, 0.1–0.95. */
  confidence: number
  /** At most this many faces, the surest first. */
  maxFaces: number
  /** How much of each face is redrawn (the inpaint's strength). */
  denoise: number
  /** What each face is drawn from; empty uses the run's prompt. */
  prompt: string
}

export const FACE_FIX_LIMITS = { minConfidence: 0.1, maxConfidence: 0.95, maxFaces: 8, minDenoise: 0.05, maxDenoise: 1, maxPrompt: 2000 } as const

/** Each detector's own default: the anime model's published best threshold, OpenCV's for YuNet. */
export const DETECTOR_CONFIDENCE: Record<FaceDetector, number> = { photo: 0.6, anime: 0.3 }

export const FACE_FIX_DEFAULTS: FaceFixOptions = { detector: 'anime', confidence: DETECTOR_CONFIDENCE.anime, maxFaces: 4, denoise: 0.4, prompt: '' }

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/** Face fix's options from an untrusted body; null when the request asks for none. */
export function faceFixOptions(value: unknown): FaceFixOptions | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const detector: FaceDetector = raw.detector === 'photo' ? 'photo' : 'anime'
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, FACE_FIX_LIMITS.maxPrompt) : ''
  return {
    detector,
    confidence: clamp(raw.confidence, DETECTOR_CONFIDENCE[detector], FACE_FIX_LIMITS.minConfidence, FACE_FIX_LIMITS.maxConfidence),
    maxFaces: Math.round(clamp(raw.maxFaces, FACE_FIX_DEFAULTS.maxFaces, 1, FACE_FIX_LIMITS.maxFaces)),
    denoise: clamp(raw.denoise, FACE_FIX_DEFAULTS.denoise, FACE_FIX_LIMITS.minDenoise, FACE_FIX_LIMITS.maxDenoise),
    prompt,
  }
}
