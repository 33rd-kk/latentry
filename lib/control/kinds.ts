// The kinds of control picture Latentry makes (annotators.ts) and sends with
// a run beside pose. Apart from annotators.ts so the request and backend
// types can name them without loading sharp or onnxruntime.

export const CONTROL_KINDS = ['canny', 'depth', 'lineart'] as const
export type ControlKind = (typeof CONTROL_KINDS)[number]

export function isControlKind(value: unknown): value is ControlKind {
  return typeof value === 'string' && (CONTROL_KINDS as readonly string[]).includes(value)
}

/** How strongly a backend follows the control picture, 0–2; 1 by default, as pose. */
export const CONTROL_STRENGTH = { min: 0, max: 2, default: 0.8 } as const
