// What the browser remembers between visits, all in localStorage.
//
// Free text the user typed (the generate form, saved characters) is not
// written while secret mode is on; see lib/secret-mode.ts. Every write is
// announced on STORAGE_EVENT_NAME so other components in the same tab can
// follow it — the native `storage` event only reaches *other* tabs.

import { isSecretMode, SECRET_MODE_STORAGE_KEY } from '@/lib/secret-mode'

export const STORAGE_EVENT_NAME = 'latentry-storage'

export const STORAGE_KEYS = {
  /** The generate form of one backend: `${FORM_PREFIX}${backendId}`. */
  FORM_PREFIX: 'latentry:form:',
  SELECTED_BACKEND: 'latentry:backend',
  CHARACTER_PRESETS: 'latentry:characters',
  HANDOFF: 'latentry:handoff',
  SECRET_MODE: SECRET_MODE_STORAGE_KEY,
} as const

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Full or disabled: the value lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME, { detail: { key, value } }))
}

/** A write of something the user typed: skipped in secret mode. */
function writeInput(key: string, value: unknown): void {
  if (isSecretMode()) return
  write(key, value)
}

export interface CharacterPreset {
  id: string
  name: string
  /** Comma-separated tags that make the character. */
  tags: string
  artist: string
  negativePrompt: string
  seed: number
  timestamp: number
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const preferences = {
  getForm: (backendId: string): Record<string, unknown> | null => read(STORAGE_KEYS.FORM_PREFIX + backendId, null),
  setForm: (backendId: string, form: Record<string, unknown>) => writeInput(STORAGE_KEYS.FORM_PREFIX + backendId, form),
  clearForm: (backendId: string) => write(STORAGE_KEYS.FORM_PREFIX + backendId, null),

  getSelectedBackend: (): string | null => read(STORAGE_KEYS.SELECTED_BACKEND, null),
  setSelectedBackend: (id: string) => write(STORAGE_KEYS.SELECTED_BACKEND, id),

  getCharacterPresets: (): CharacterPreset[] => read(STORAGE_KEYS.CHARACTER_PRESETS, []),
  addCharacterPreset: (preset: Omit<CharacterPreset, 'id' | 'timestamp'>): CharacterPreset[] => {
    const next = [{ ...preset, id: newId(), timestamp: Date.now() }, ...preferences.getCharacterPresets()]
    writeInput(STORAGE_KEYS.CHARACTER_PRESETS, next)
    return next
  },
  removeCharacterPreset: (id: string): CharacterPreset[] => {
    const next = preferences.getCharacterPresets().filter((preset) => preset.id !== id)
    write(STORAGE_KEYS.CHARACTER_PRESETS, next)
    return next
  },

  getSecretMode: (): boolean => isSecretMode(),
  setSecretMode: (on: boolean) => write(STORAGE_KEYS.SECRET_MODE, on),
}

// ── Gallery → generate handoff ──────────────────────────────────────────────
//
// The gallery and the form are separate pages, possibly in separate tabs, so
// what the gallery sends waits in localStorage until the form drains it: on
// mount, on the `storage` event from another tab, and on the same-tab event.

/** The settings a gallery picture was made with, as the form applies them. */
export interface HandoffSettings {
  backend?: string
  profile?: string
  prompt: string
  negativePrompt: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
}

export type HandoffItem =
  | { type: 'tag'; tag: string; target: 'positive' | 'negative' }
  | { type: 'settings'; settings: HandoffSettings }
  | { type: 'source'; url: string; as: 'variation' | 'pose' }

export function pushHandoff(item: HandoffItem): void {
  const queue = read<HandoffItem[]>(STORAGE_KEYS.HANDOFF, [])
  // Bounded: a form that is never opened must not let this grow forever.
  write(STORAGE_KEYS.HANDOFF, [...queue, item].slice(-50))
}

export function drainHandoff(): HandoffItem[] {
  const queue = read<HandoffItem[]>(STORAGE_KEYS.HANDOFF, [])
  if (queue.length) write(STORAGE_KEYS.HANDOFF, null)
  return queue
}
