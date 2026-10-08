// The generate page's form: its shape, its defaults, reading it back from
// storage, and laying a gallery picture's settings over it. No React here, so
// the verify scripts can pin it down.

import { formatForProfile, getProfile, isProfileId, type Profile, type ProfileId } from '@/lib/profiles'
import { preferences, type HandoffSettings } from '@/lib/storage'

export const DEFAULT = 'Default'
// Shown once any preset-driven control is changed by hand, so the picker never
// claims settings that are not the ones in the boxes.
export const CUSTOM_PRESET = 'custom'

/**
 * The part of the form that outlives the page, kept per backend: what the
 * user typed and the knobs they set, not results or progress. An Anima server
 * and an SDXL web UI want different sizes, steps and negatives, so switching
 * between them swaps forms instead of dragging one's settings into the other.
 * Secret mode makes the write a no-op (see lib/secret-mode.ts).
 */
export interface FormState {
  profile: ProfileId
  artist: string
  prompt: string
  negativePrompt: string
  /** Put the profile's quality tags in front of the prompt. */
  quality: boolean
  width: number
  height: number
  seed: number
  imageCount: number
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  presetName: string
}

export function defaultForm(profile: Profile): FormState {
  return {
    profile: profile.id,
    artist: '',
    prompt: '',
    negativePrompt: profile.defaults.negativePrompt,
    quality: Boolean(profile.qualityTags),
    width: profile.defaults.width,
    height: profile.defaults.height,
    seed: -1,
    imageCount: 1,
    sampler: DEFAULT,
    scheduler: DEFAULT,
    steps: profile.defaults.steps,
    cfg: profile.defaults.cfg,
    presetName: CUSTOM_PRESET,
  }
}

// A stored blob can predate the current shape of the form (or have been edited
// by hand), so every field is checked and falls back instead of being trusted.
export function readStoredForm(backendId: string, fallbackProfile: ProfileId): FormState | null {
  const raw = preferences.getForm(backendId)
  if (!raw) return null
  const profile = getProfile(isProfileId(raw.profile) ? raw.profile : fallbackProfile)
  const base = defaultForm(profile)
  const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
  const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
  return {
    profile: profile.id,
    artist: text(raw.artist, base.artist),
    prompt: text(raw.prompt, base.prompt),
    negativePrompt: text(raw.negativePrompt, base.negativePrompt),
    quality: typeof raw.quality === 'boolean' ? raw.quality : base.quality,
    width: number(raw.width, base.width),
    height: number(raw.height, base.height),
    seed: number(raw.seed, base.seed),
    imageCount: number(raw.imageCount, base.imageCount),
    sampler: text(raw.sampler, base.sampler),
    scheduler: text(raw.scheduler, base.scheduler),
    steps: number(raw.steps, base.steps),
    cfg: number(raw.cfg, base.cfg),
    presetName: text(raw.presetName, base.presetName),
  }
}

/** A form with the shared prompt over its own, when the prompt is shared. */
export function withSharedPrompt(form: FormState): FormState {
  if (preferences.getPromptScope() !== 'shared') return form
  const shared = preferences.getSharedPrompt()
  return shared ? { ...form, prompt: shared.prompt, artist: shared.artist } : form
}

/**
 * Whether a prompt calls a LoRA as `<lora:name:weight>` or `<lyco:…>`. Only an
 * A1111 web UI loads those; other backends read the tag as plain words. The
 * same pattern as lorasInPrompt in lib/image-meta, which the browser cannot
 * import (it brings node:zlib along).
 */
export function callsLora(prompt: string): boolean {
  return /<(?:lora|lyco):[^:>]+(?::[^>]*)?>/i.test(prompt)
}

/** `value` if the backend accepts it, else what it does accept first. */
export function accepted(value: string, options: string[]): string {
  return options.length === 0 || options.includes(value) ? value : options[0]
}

/** A gallery picture's settings over a form: what it says replaces, what it does not say stays. */
export function applySettings(form: FormState, settings: HandoffSettings, sameBackend: boolean): FormState {
  // The words are respelled for the model they are going to: the profile the
  // picture brings along when it comes with its settings, the form's otherwise.
  const profile = getProfile(sameBackend && isProfileId(settings.profile) ? settings.profile : form.profile)
  const words = {
    prompt: formatForProfile(settings.prompt, profile),
    // The prompt as saved already carries its artist and quality tags.
    artist: '',
    quality: false,
    ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
  }
  // From another backend only the words and the seed carry over: its size,
  // steps, CFG and sampler were tuned for a different model.
  if (!sameBackend) return { ...form, ...words }
  return {
    ...form,
    ...words,
    ...(settings.profile && isProfileId(settings.profile) ? { profile: settings.profile } : {}),
    negativePrompt: formatForProfile(settings.negativePrompt, profile),
    ...(settings.width ? { width: settings.width } : {}),
    ...(settings.height ? { height: settings.height } : {}),
    ...(settings.steps ? { steps: settings.steps } : {}),
    ...(settings.cfg !== undefined ? { cfg: settings.cfg } : {}),
    ...(settings.sampler ? { sampler: settings.sampler } : {}),
    ...(settings.scheduler ? { scheduler: settings.scheduler } : {}),
    presetName: CUSTOM_PRESET,
  }
}
