// The kinds of control picture Latentry makes (annotators.ts) and sends with
// a run beside pose. Apart from annotators.ts so the request and backend
// types can name them without loading sharp or onnxruntime.

export const CONTROL_KINDS = ['canny', 'depth', 'lineart'] as const
export type ControlKind = (typeof CONTROL_KINDS)[number]

export function isControlKind(value: unknown): value is ControlKind {
  return typeof value === 'string' && (CONTROL_KINDS as readonly string[]).includes(value)
}

/**
 * How strongly a backend follows the control picture, 0–2. 0.5 by default:
 * the layout holds, and the picture stays as crisp as without one (at 0.8 the
 * engine's union ControlNet left Illustrious pictures hazy).
 */
export const CONTROL_STRENGTH = { min: 0, max: 2, default: 0.5 } as const

/**
 * How much of a reference picture's look a run takes (IP-Adapter), 0-1. 0.3 by
 * default: on Illustrious, 0.15-0.3 took the reference's light, hair and
 * clothes cleanly, and 0.6 broke the picture into streaks.
 */
export const IP_ADAPTER_SCALE = { min: 0, max: 1, default: 0.3 } as const
