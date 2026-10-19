// The settings page's form: what it edits (a draft of the settings view, all
// strings as typed), and the JSON the API takes back for the parts that
// changed. No React here, so the verify scripts can pin it down.

import type { BackendKind } from '@/lib/backends/types'
import type { ProfileId } from '@/lib/profiles'
import type { SettingsView } from './view'

export type Source = 'settings' | 'env'
export type Part = 'backends' | 'tagger' | 'wd14' | 'gallery' | 'profiles' | 'wildcards'

export interface BackendDraft {
  /** Stable React key; the id itself is editable. */
  key: string
  id: string
  kind: BackendKind
  url: string
  profile: ProfileId
  /** What is typed; "" with `clearToken` false means "keep the current one". */
  token: string
  clearToken: boolean
  tokenSource: Source | null
  /** comfyui: the checkpoint, "" for ComfyUI's first. */
  model: string
  /** comfyui: the pose ControlNet, "" for no pose on the built-in graph. */
  controlnet: string
  /** comfyui: a folder of workflows, "" for none; and whether paired devices see them. */
  workflowsDir: string
  shareWorkflows: boolean
}

export type ProfileDraft = Record<'width' | 'height' | 'steps' | 'cfg' | 'negativePrompt' | 'qualityTags' | 'artistTemplate' | 'tagStyle' | 'keepTags', string>

export interface Draft {
  backends: BackendDraft[]
  tagger: string
  wd14Dir: string
  wd14General: string
  wd14Character: string
  saveDir: string
  /** Display names, "" for a made-up one; dirLabels runs alongside dirs. */
  saveLabel: string
  dirs: string[]
  dirLabels: string[]
  autoTag: boolean
  loraHashes: boolean
  profiles: Partial<Record<ProfileId, ProfileDraft>>
  wildcardsDir: string
  wildcardsShare: boolean
}

/** Edits one part of the draft, marking that part as changed. */
export type ChangeDraft = (part: Part, update: (draft: Draft) => Draft) => void

export const AUTO = '__auto__'
export const BUILTIN = 'builtin'
export const PROFILE_FIELDS: (keyof ProfileDraft)[] = ['width', 'height', 'steps', 'cfg', 'negativePrompt', 'qualityTags', 'artistTemplate', 'tagStyle', 'keepTags']

let nextKey = 0
export const newKey = () => `b${(nextKey += 1)}`

/** A row for "Add backend". */
export function emptyBackend(): BackendDraft {
  return { key: newKey(), id: '', kind: 'a1111', url: '', profile: 'sdxl', token: '', clearToken: false, tokenSource: null, model: '', controlnet: '', workflowsDir: '', shareWorkflows: false }
}

/** A profile with every field back to the built-in value. */
export function emptyProfile(): ProfileDraft {
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, ''])) as ProfileDraft
}

/** A folder's display name as set on this page; "" when it has a made-up one. */
function setLabel(view: SettingsView, folder: string | null): string {
  const entry = folder ? view.gallery.labels[folder] : undefined
  return entry && !entry.auto ? entry.label : ''
}

/** What an empty display name shows as: the folder's made-up name, once it has one. */
export function autoLabel(view: SettingsView, folder: string): string | undefined {
  const entry = view.gallery.labels[folder.trim()]
  return entry?.auto ? entry.label : undefined
}

export function toDraft(view: SettingsView): Draft {
  const profiles: Draft['profiles'] = {}
  for (const builtin of view.builtinProfiles) {
    const override = view.profiles[builtin.id] ?? {}
    profiles[builtin.id] = Object.fromEntries(
      PROFILE_FIELDS.map((field) => {
        const value = override[field]
        // "-" stands for "none": no artist field, or no tags kept from respelling.
        return [field, value === undefined ? '' : value === null || (field === 'keepTags' && value === '') ? '-' : String(value)]
      })
    ) as ProfileDraft
  }
  return {
    backends: view.backends.map((backend) => ({
      key: newKey(),
      id: backend.id,
      kind: backend.kind,
      url: backend.url,
      profile: backend.profile,
      token: '',
      clearToken: false,
      tokenSource: backend.token,
      model: backend.model ?? '',
      controlnet: backend.controlnet ?? '',
      workflowsDir: backend.workflowsDir ?? '',
      shareWorkflows: backend.shareWorkflows,
    })),
    tagger: view.tagger ?? AUTO,
    wd14Dir: view.wd14.modelDir ?? '',
    // Thresholds show as typed only when they differ from the defaults.
    wd14General: view.wd14.general === view.wd14.defaults.general ? '' : String(view.wd14.general),
    wd14Character: view.wd14.character === view.wd14.defaults.character ? '' : String(view.wd14.character),
    saveDir: view.gallery.saveDir ?? '',
    saveLabel: setLabel(view, view.gallery.saveDir),
    dirs: view.gallery.dirs,
    dirLabels: view.gallery.dirs.map((dir) => setLabel(view, dir)),
    autoTag: view.gallery.autoTag,
    loraHashes: view.gallery.loraHashes,
    profiles,
    wildcardsDir: view.wildcards.dir ?? '',
    wildcardsShare: view.wildcards.share,
  }
}

/** The JSON the API takes for the parts that changed. */
export function toInput(draft: Draft, dirty: Set<Part>) {
  const body: Record<string, unknown> = {}
  if (dirty.has('backends')) {
    body.backends = draft.backends.map((backend) => ({
      id: backend.id,
      kind: backend.kind,
      url: backend.url,
      profile: backend.profile,
      // Write-only: a typed value sets it, "clear" empties it, nothing keeps it.
      ...(backend.clearToken ? { token: '' } : backend.token ? { token: backend.token } : {}),
      ...(backend.kind === 'comfyui' && backend.model.trim() ? { model: backend.model.trim() } : {}),
      ...(backend.kind === 'comfyui' && backend.controlnet.trim() ? { controlnet: backend.controlnet.trim() } : {}),
      ...(backend.kind === 'comfyui' && backend.workflowsDir.trim() ? { workflowsDir: backend.workflowsDir.trim(), shareWorkflows: backend.shareWorkflows } : {}),
    }))
  }
  if (dirty.has('tagger')) body.tagger = draft.tagger === AUTO ? null : draft.tagger
  if (dirty.has('wd14')) {
    body.wd14 = {
      modelDir: draft.wd14Dir.trim() || null,
      ...(draft.wd14General.trim() ? { general: Number(draft.wd14General) } : {}),
      ...(draft.wd14Character.trim() ? { character: Number(draft.wd14Character) } : {}),
    }
  }
  if (dirty.has('gallery')) {
    const labels: Record<string, string> = {}
    if (draft.saveDir.trim() && draft.saveLabel.trim()) labels[draft.saveDir.trim()] = draft.saveLabel.trim()
    draft.dirs.forEach((dir, index) => {
      if (dir.trim() && draft.dirLabels[index]?.trim()) labels[dir.trim()] = draft.dirLabels[index].trim()
    })
    body.gallery = {
      saveDir: draft.saveDir.trim() || null,
      dirs: draft.dirs.map((dir) => dir.trim()).filter(Boolean),
      autoTag: draft.autoTag,
      loraHashes: draft.loraHashes,
      labels,
    }
  }
  if (dirty.has('profiles')) {
    const profiles: Record<string, Record<string, unknown>> = {}
    for (const [id, fields] of Object.entries(draft.profiles)) {
      const out: Record<string, unknown> = {}
      for (const field of PROFILE_FIELDS) {
        const value = fields![field].trim()
        if (!value) continue
        if (field === 'artistTemplate') out[field] = value === '-' ? null : value
        else if (field === 'keepTags') out[field] = value === '-' ? '' : fields![field]
        else if (field === 'tagStyle') out[field] = value
        else if (field === 'negativePrompt' || field === 'qualityTags') out[field] = fields![field]
        else out[field] = Number(value)
      }
      if (Object.keys(out).length) profiles[id] = out
    }
    body.profiles = profiles
  }
  if (dirty.has('wildcards')) body.wildcards = { dir: draft.wildcardsDir.trim() || null, share: draft.wildcardsShare }
  return body
}
