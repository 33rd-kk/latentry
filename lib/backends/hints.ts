// Why a backend cannot use a feature, worked out from what it reports, so the
// page can say what to change instead of only hiding the control.

import type { FeatureHint, HintedFeature } from './types'

/** Longest server-given reason kept; a reason is one sentence, not a log. */
export const MAX_HINT_DETAIL = 200

type Hints = Partial<Record<HintedFeature, FeatureHint>>

/** The health field each feature is announced by, on the diffusers-compatible API. */
const HEALTH_FLAG: Record<HintedFeature, string> = {
  img2img: 'img2img',
  inpaint: 'inpaint',
  pose: 'pose_control',
}

/** A server's own reason, as plain one-line text, or nothing usable. */
export function hintDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // Control characters (newlines included) would only garble a one-line hint.
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > MAX_HINT_DETAIL ? `${text.slice(0, MAX_HINT_DETAIL - 1)}…` : text
}

/**
 * Hints for a diffusers-compatible server from its /api/health body; none when
 * it did not answer (being down is shown on its own). img2img and inpaint are
 * on unless said otherwise, so only an explicit `false` hides them, while pose
 * needs an explicit `true`.
 */
export function diffusersHints(health: Record<string, unknown> | null): Hints {
  if (!health) return {}
  const reasons = health.unavailable && typeof health.unavailable === 'object' ? (health.unavailable as Record<string, unknown>) : {}
  const hints: Hints = {}
  for (const feature of Object.keys(HEALTH_FLAG) as HintedFeature[]) {
    const flag = health[HEALTH_FLAG[feature]]
    const on = feature === 'pose' ? flag === true : flag !== false
    if (on) continue
    const detail = hintDetail(reasons[feature])
    hints[feature] = flag === false || detail ? { reason: 'declined', ...(detail ? { detail } : {}) } : { reason: 'not-reported' }
  }
  return hints
}

/** An A1111 web UI: pose is not something Latentry can drive there. */
export function a1111Hints(alive: boolean): Hints {
  return alive ? { pose: { reason: 'kind' } } : {}
}
