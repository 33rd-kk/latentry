// What the settings page is shown: the values in effect, where each comes
// from, and the built-in profiles to compare against. Tokens never appear;
// only whether one is set, and where.

import { backendsSource, getBackends, hasEnvToken, taggerPreference } from '@/lib/backends/config'
import { getGalleryDirs, autoTagEnabled } from '@/lib/gallery/dirs'
import { getBuiltinProfile, PROFILE_IDS, type ProfileId } from '@/lib/profiles'
import { wd14Config } from '@/lib/tagger'
import { DEFAULT_THRESHOLDS, hasModel } from '@/lib/tagger/wd14'
import type { BackendKind } from '@/lib/backends/types'
import { getSettings, settingsPath } from './store'
import type { ProfileOverride, Settings } from './schema'

type Source = 'settings' | 'env'

export interface SettingsView {
  editable: true
  file: string
  backends: { id: string; kind: BackendKind; url: string; profile: ProfileId; token: Source | null }[]
  tagger: string | null
  wd14: { modelDir: string | null; general: number; character: number; found: boolean; defaults: { general: number; character: number } }
  gallery: { saveDir: string | null; dirs: string[]; autoTag: boolean }
  profiles: Partial<Record<ProfileId, ProfileOverride>>
  sources: { backends: Source; tagger: Source; wd14: Source; saveDir: Source; dirs: Source; autoTag: Source }
  builtinProfiles: {
    id: ProfileId
    label: string
    sizeMultiple: number
    width: number
    height: number
    steps: number
    cfg: number
    negativePrompt: string
    qualityTags: string
    artistTemplate: string | null
  }[]
}

export function settingsView(settings: Settings = getSettings()): SettingsView {
  const dirs = getGalleryDirs()
  const stored = new Map((settings.backends ?? []).map((backend) => [backend.id, backend]))
  return {
    editable: true,
    file: settingsPath(),
    backends: getBackends(process.env, settings).map(({ id, kind, url, profile }) => ({
      id,
      kind,
      url,
      profile,
      token: stored.get(id)?.token ? 'settings' : hasEnvToken(id) ? 'env' : null,
    })),
    tagger: taggerPreference(process.env, settings),
    wd14: (() => {
      const config = wd14Config(process.env, settings)
      return { modelDir: config.modelDir, ...config.thresholds, found: hasModel(config.modelDir), defaults: DEFAULT_THRESHOLDS }
    })(),
    gallery: {
      saveDir: dirs.find((dir) => dir.writable)?.path ?? null,
      dirs: dirs.filter((dir) => !dir.writable).map((dir) => dir.path),
      autoTag: autoTagEnabled(process.env, settings),
    },
    profiles: settings.profiles ?? {},
    sources: {
      backends: backendsSource(settings),
      tagger: settings.tagger !== undefined ? 'settings' : 'env',
      wd14: settings.wd14 !== undefined ? 'settings' : 'env',
      saveDir: settings.gallery?.saveDir !== undefined ? 'settings' : 'env',
      dirs: settings.gallery?.dirs !== undefined ? 'settings' : 'env',
      autoTag: settings.gallery?.autoTag !== undefined ? 'settings' : 'env',
    },
    builtinProfiles: PROFILE_IDS.map((id) => {
      const profile = getBuiltinProfile(id)
      return {
        id,
        label: profile.label,
        sizeMultiple: profile.sizeMultiple,
        ...profile.defaults,
        qualityTags: profile.qualityTags,
        artistTemplate: profile.artistTemplate,
      }
    }),
  }
}
