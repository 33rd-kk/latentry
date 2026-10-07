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
  /** Whether the prompt is kept per backend or shared by all (PromptScope). */
  PROMPT_SCOPE: 'latentry:prompt-scope',
  /** The prompt every backend's form shows while the scope is "shared". */
  SHARED_PROMPT: 'latentry:shared-prompt',
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

/**
 * Where the generate form keeps its words. Per backend, an Anima server and an
 * SDXL web UI each remember their own prompt; shared, switching backends
 * carries the prompt along and only the settings swap (the tag spelling is
 * fixed per model when it is sent, see lib/profiles). The negative prompt is
 * always per backend: what a family should avoid is the family's.
 */
export type PromptScope = 'backend' | 'shared'

/** What the scope covers: the prompt and the artist that leads it. */
export interface SharedPrompt {
  prompt: string
  artist: string
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

  getPromptScope: (): PromptScope => (read<string>(STORAGE_KEYS.PROMPT_SCOPE, 'backend') === 'shared' ? 'shared' : 'backend'),
  setPromptScope: (scope: PromptScope) => write(STORAGE_KEYS.PROMPT_SCOPE, scope),
  getSharedPrompt: (): SharedPrompt | null => {
    const raw = read<Record<string, unknown> | null>(STORAGE_KEYS.SHARED_PROMPT, null)
    if (!raw || typeof raw !== 'object') return null
    return { prompt: typeof raw.prompt === 'string' ? raw.prompt : '', artist: typeof raw.artist === 'string' ? raw.artist : '' }
  },
  setSharedPrompt: (shared: SharedPrompt) => writeInput(STORAGE_KEYS.SHARED_PROMPT, shared),

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
// In secret mode it waits in this tab's memory instead — prompts and tags are
// what the user typed — so it reaches the form in this tab only.

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
  /** A whole section at once; one item, so a long list cannot overflow the queue. */
  | { type: 'tags'; tags: string[]; target: 'positive' | 'negative' }
  | { type: 'settings'; settings: HandoffSettings }
  | { type: 'source'; url: string; as: 'variation' | 'pose' }

let memoryHandoff: HandoffItem[] = []

// Bounded: a form that is never opened must not let this grow forever.
const HANDOFF_LIMIT = 50

export function pushHandoff(item: HandoffItem): void {
  if (isSecretMode()) {
    memoryHandoff = [...memoryHandoff, item].slice(-HANDOFF_LIMIT)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT_NAME, { detail: { key: STORAGE_KEYS.HANDOFF, value: memoryHandoff } }))
    }
    return
  }
  const queue = read<HandoffItem[]>(STORAGE_KEYS.HANDOFF, [])
  write(STORAGE_KEYS.HANDOFF, [...queue, item].slice(-HANDOFF_LIMIT))
}

export function drainHandoff(): HandoffItem[] {
  const stored = read<HandoffItem[]>(STORAGE_KEYS.HANDOFF, [])
  if (stored.length) write(STORAGE_KEYS.HANDOFF, null)
  const queue = [...stored, ...memoryHandoff]
  memoryHandoff = []
  return queue
}
