// Model profiles: what a model family expects of a prompt and a canvas.

import { formatTags, tagKey, type TagStyle } from '@/lib/tags'
//
// A profile is not a backend. The backend says how to talk to a server (see
// lib/backends); the profile says what to ask it for — the starting size and
// step count, how an artist is written, which quality tags the family was
// trained to respond to. Any backend can be paired with any profile, so an
// SDXL checkpoint on a diffusers-API server and one on Forge share the same
// defaults, and switching profile on the form never touches the connection.
//
// Nothing here is binding: every value only seeds the form, and the user can
// change it. That is also why there is no per-checkpoint table — a profile
// describes a family, and a checkpoint that disagrees is one edit away.

export const PROFILE_IDS = ['generic', 'sdxl', 'illustrious', 'pony', 'anima'] as const
export type ProfileId = (typeof PROFILE_IDS)[number]

export interface ProfileDefaults {
  width: number
  height: number
  steps: number
  cfg: number
  negativePrompt: string
}

export interface Profile {
  id: ProfileId
  label: string
  defaults: ProfileDefaults
  /**
   * What a width or height must be a multiple of. The latent is 1/8 of the
   * image, and some transformers patch it further (2x2 patches make it 16).
   */
  sizeMultiple: number
  /** Common canvases for the family, all near its training area. */
  resolutions: ReadonlyArray<readonly [number, number]>
  /**
   * How an artist name goes into the prompt, `{artist}` standing for the name;
   * null when the family has no convention and the field is hidden.
   */
  artistTemplate: string | null
  /** Tags the family was trained to read as "good", offered as a toggle. */
  qualityTags: string
  /** How the family spells a tag's word breaks: `long_hair` or `long hair`. */
  tagStyle: TagStyle
  /** Tags never respelled (comma-separated, `*` a wildcard): `score_9` is a token, not two words. */
  keepTags: string
  /** Where the img2img strength slider starts. */
  defaultStrength: number
  /** Where it starts when the source is a pose reference rather than a picture to edit. */
  defaultPoseStrength: number
}

// About one megapixel in the aspect ratios SDXL-era models were bucketed on.
// Every value is a multiple of 64, so they suit a 16-multiple model as well.
const MEGAPIXEL_BUCKETS = [
  [1024, 1024],
  [1152, 896],
  [896, 1152],
  [1216, 832],
  [832, 1216],
  [1344, 768],
  [768, 1344],
  [1536, 640],
  [640, 1536],
] as const

// Pony's score tags are single tokens with their underscores; so is any
// family's copy of them.
const KEEP_TAGS = 'score_*'

// Danbooru-trained SDXL checkpoints learned tags with their underscores;
// Anima's captions were written with spaces. Generic leaves the prompt alone.
const PROFILES: Record<ProfileId, Profile> = {
  generic: {
    id: 'generic',
    label: 'Generic',
    defaults: { width: 1024, height: 1024, steps: 28, cfg: 6, negativePrompt: 'low quality, blurry, watermark' },
    sizeMultiple: 8,
    resolutions: MEGAPIXEL_BUCKETS,
    artistTemplate: null,
    qualityTags: '',
    tagStyle: 'asis',
    keepTags: KEEP_TAGS,
    defaultStrength: 0.6,
    defaultPoseStrength: 0.85,
  },
  sdxl: {
    id: 'sdxl',
    label: 'SDXL',
    defaults: {
      width: 1024,
      height: 1024,
      steps: 28,
      cfg: 6.5,
      negativePrompt: 'low quality, worst quality, blurry, watermark, text',
    },
    sizeMultiple: 8,
    resolutions: MEGAPIXEL_BUCKETS,
    artistTemplate: 'by {artist}',
    qualityTags: 'masterpiece, best quality',
    tagStyle: 'underscore',
    keepTags: KEEP_TAGS,
    defaultStrength: 0.6,
    defaultPoseStrength: 0.85,
  },
  illustrious: {
    id: 'illustrious',
    label: 'Illustrious / NoobAI',
    defaults: {
      width: 832,
      height: 1216,
      steps: 28,
      cfg: 5.5,
      negativePrompt: 'worst quality, low quality, bad anatomy, bad hands, watermark, signature',
    },
    sizeMultiple: 8,
    resolutions: MEGAPIXEL_BUCKETS,
    // Danbooru-trained: an artist is just their tag.
    artistTemplate: '{artist}',
    qualityTags: 'masterpiece, best quality, amazing quality, very aesthetic',
    tagStyle: 'underscore',
    keepTags: KEEP_TAGS,
    defaultStrength: 0.6,
    defaultPoseStrength: 0.85,
  },
  pony: {
    id: 'pony',
    label: 'Pony',
    defaults: {
      width: 832,
      height: 1216,
      steps: 25,
      cfg: 7,
      negativePrompt: 'score_4, score_5, score_6, worst quality, low quality',
    },
    sizeMultiple: 8,
    resolutions: MEGAPIXEL_BUCKETS,
    // Pony's artist knowledge was deliberately obfuscated; a name does little.
    artistTemplate: null,
    qualityTags: 'score_9, score_8_up, score_7_up',
    tagStyle: 'underscore',
    keepTags: KEEP_TAGS,
    defaultStrength: 0.6,
    defaultPoseStrength: 0.85,
  },
  anima: {
    id: 'anima',
    label: 'Anima',
    defaults: {
      width: 1216,
      height: 832,
      steps: 50,
      cfg: 4.5,
      negativePrompt: 'low quality, blurry, distorted, watermark',
    },
    // The transformer works on 2x2 patches of the 1/8 latent.
    sizeMultiple: 16,
    resolutions: MEGAPIXEL_BUCKETS,
    // Anima reads "@name" as an artist style.
    artistTemplate: '@{artist}',
    qualityTags: '',
    tagStyle: 'space',
    keepTags: KEEP_TAGS,
    defaultStrength: 0.6,
    defaultPoseStrength: 0.85,
  },
}

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === 'string' && (PROFILE_IDS as readonly string[]).includes(value)
}

/** The fields of a profile that can be changed from the settings page. */
export interface ProfileChanges {
  width?: number
  height?: number
  steps?: number
  cfg?: number
  negativePrompt?: string
  qualityTags?: string
  artistTemplate?: string | null
  tagStyle?: TagStyle
  keepTags?: string
}

// Overrides from the settings page, laid over the built-in profiles. Held at
// module level because this file runs on both sides: the page sets them from
// /api/gen/backends, and nothing on the server depends on them.
let overrides: Partial<Record<ProfileId, ProfileChanges>> = {}

export function setProfileOverrides(next: Partial<Record<ProfileId, ProfileChanges>> | null | undefined): void {
  overrides = next ?? {}
}

/** A built-in profile with `changes` applied. */
export function applyProfileChanges(base: Profile, changes: ProfileChanges | undefined): Profile {
  if (!changes) return base
  return {
    ...base,
    defaults: {
      width: changes.width ?? base.defaults.width,
      height: changes.height ?? base.defaults.height,
      steps: changes.steps ?? base.defaults.steps,
      cfg: changes.cfg ?? base.defaults.cfg,
      negativePrompt: changes.negativePrompt ?? base.defaults.negativePrompt,
    },
    qualityTags: changes.qualityTags ?? base.qualityTags,
    tagStyle: changes.tagStyle ?? base.tagStyle,
    keepTags: changes.keepTags ?? base.keepTags,
    artistTemplate: changes.artistTemplate !== undefined ? changes.artistTemplate : base.artistTemplate,
  }
}

/** The profile as built in, without the settings page's changes. */
export function getBuiltinProfile(id: string | null | undefined): Profile {
  return isProfileId(id) ? PROFILES[id] : PROFILES.generic
}

export function getProfile(id: string | null | undefined): Profile {
  const base = getBuiltinProfile(id)
  return applyProfileChanges(base, overrides[base.id])
}

export function listProfiles(): Profile[] {
  return PROFILE_IDS.map((id) => getProfile(id))
}

/** `text` with every tag spelled the way `profile`'s family reads it. */
export function formatForProfile(text: string, profile: Profile): string {
  return formatTags(text, profile.tagStyle, profile.keepTags)
}

/**
 * The prompt as it is sent: its tags in the profile's spelling, the artist in
 * the profile's notation and the quality tags in front, skipping either when
 * it is empty or already there. The artist is left as written: `by {artist}`
 * is words around a name, not a tag.
 */
export function composePrompt(
  prompt: string,
  options: { profile: Profile; artist?: string; quality?: boolean }
): string {
  const { profile } = options
  const body = formatForProfile(prompt, profile)
  const parts: string[] = []
  const present = new Set(
    body
      .split(',')
      .map(tagKey)
      .filter(Boolean)
  )

  if (options.quality && profile.qualityTags) {
    for (const tag of formatForProfile(profile.qualityTags, profile).split(',').map((t) => t.trim())) {
      if (tag && !present.has(tagKey(tag))) parts.push(tag)
    }
  }

  const template = profile.artistTemplate
  const name = (options.artist ?? '').trim().replace(/^@+/, '').trim()
  if (template && name) {
    const artist = template.replace('{artist}', name)
    if (!present.has(tagKey(artist))) parts.push(artist)
  }

  const rest = body.trim()
  if (rest) parts.push(rest)
  return parts.join(', ')
}

/**
 * The output size an img2img run gets for `source`: the source's aspect at
 * the requested pixel area, snapped to the profile's multiple. Sizing to the
 * source keeps it from being stretched; the client needs the same answer as
 * the backend so a pose skeleton is drawn at the size the run will have.
 */
export function fitToImage(
  source: { width: number; height: number },
  width: number,
  height: number,
  multiple: number
): { width: number; height: number } {
  const area = Math.max(256 * 256, width * height)
  const aspect = source.width / source.height
  const fittedHeight = Math.sqrt(area / aspect)
  const snap = (value: number) => Math.max(256, Math.min(2048, Math.round(value / multiple) * multiple))
  return { width: snap(fittedHeight * aspect), height: snap(fittedHeight) }
}

/** `value` rounded to the nearest multiple, never below one multiple. */
export function snapSize(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}
