// Why a backend cannot use a feature, worked out from what it reports, so the
// page can say what to change instead of only hiding the control.

import { errorMessage, REDIRECT_REFUSED } from './http'
import type { BackendProblem, FeatureHint, HintedFeature } from './types'

/** Longest server-given reason kept; a reason is one sentence, not a log. */
export const MAX_HINT_DETAIL = 200

type Hints = Partial<Record<HintedFeature, FeatureHint>>

/** The health field each feature is announced by, on the diffusers-compatible API. */
const HEALTH_FLAG: Record<HintedFeature, string> = {
  img2img: 'img2img',
  inpaint: 'inpaint',
  pose: 'pose_control',
  hires: 'hires',
}

/** Features a diffusers-compatible server must announce; the others are on unless it says no. */
const OPT_IN: readonly HintedFeature[] = ['pose', 'hires']

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
 * and hires fix need an explicit `true`.
 */
export function diffusersHints(health: Record<string, unknown> | null): Hints {
  if (!health) return {}
  const reasons = health.unavailable && typeof health.unavailable === 'object' ? (health.unavailable as Record<string, unknown>) : {}
  const hints: Hints = {}
  for (const feature of Object.keys(HEALTH_FLAG) as HintedFeature[]) {
    const flag = health[HEALTH_FLAG[feature]]
    const on = OPT_IN.includes(feature) ? flag === true : flag !== false
    if (on) continue
    const detail = hintDetail(reasons[feature])
    hints[feature] = flag === false || detail ? { reason: 'declined', ...(detail ? { detail } : {}) } : { reason: 'not-reported' }
  }
  return hints
}

/**
 * Why a backend's health call failed, from its answer (null: nothing
 * answered); null while it answers 2xx. A login in front of it (401 / 403)
 * is told apart, and the server's own words come along, on one line and
 * without paths.
 */
export function problemOf(answer: { status: number; body: unknown } | null): BackendProblem | null {
  if (!answer) return { reason: 'unreachable' }
  const { status, body } = answer
  if (status >= 200 && status < 300) return null
  if ((body as { error?: unknown } | null)?.error === REDIRECT_REFUSED) return { reason: 'redirect' }
  const detail = hintDetail(errorMessage(body, ''))
  return { reason: status === 401 || status === 403 ? 'auth' : 'http', status, ...(detail ? { detail } : {}) }
}

/** An A1111 web UI: pose is not something Latentry can drive there. */
export function a1111Hints(alive: boolean): Hints {
  return alive ? { pose: { reason: 'kind' } } : {}
}

/**
 * A ComfyUI server: pose needs a running engine to draw the skeleton, and for
 * the built-in graph its core ControlNet nodes and a ControlNet chosen for the
 * backend. The first one missing is named, the engine first: a workflow with
 * its own pose nodes needs only that, so the page can tell from the hint.
 */
export function comfyHints(alive: boolean, pose: { nodes: boolean; controlnet: boolean; engine: boolean }): Hints {
  if (!alive) return {}
  const need = !pose.engine ? 'engine' : !pose.nodes ? 'nodes' : !pose.controlnet ? 'controlnet' : null
  return need ? { pose: { reason: 'setup', need } } : {}
}
