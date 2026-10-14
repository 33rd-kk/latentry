/**
 * The settings page's form (lib/settings/draft.ts): the settings view as a
 * draft of typed strings, and the JSON sent back for the parts that changed.
 *
 * Run with: npm test -- settings-draft
 */
import { check, done, eq } from './assert'
import { AUTO, autoLabel, emptyBackend, emptyProfile, toDraft, toInput, type Draft, type Part } from '../lib/settings/draft'
import type { SettingsView } from '../lib/settings/view'

const builtin = {
  label: 'SDXL',
  sizeMultiple: 8,
  width: 1024,
  height: 1024,
  steps: 28,
  cfg: 6,
  negativePrompt: 'lowres',
  qualityTags: 'masterpiece',
  artistTemplate: 'by {artist}',
  tagStyle: 'underscore' as const,
  keepTags: '',
}

const view: SettingsView = {
  editable: true,
  version: '0.0.0',
  file: '/config/settings.json',
  backends: [
    { id: 'box', kind: 'a1111', url: 'http://127.0.0.1:7860/', profile: 'sdxl', token: 'settings', model: null, controlnet: null, workflowsDir: null, shareWorkflows: false },
    { id: 'comfy', kind: 'comfyui', url: 'http://127.0.0.1:8188/', profile: 'anima', token: null, model: 'base.safetensors', controlnet: 'sdxl/openpose.safetensors', workflowsDir: '/workflows', shareWorkflows: true },
  ],
  tagger: null,
  wd14: { modelDir: '/models/wd14', general: 0.35, character: 0.9, found: true, defaults: { general: 0.35, character: 0.85 } },
  gallery: {
    saveDir: '/pictures/out',
    dirs: ['/pictures/comfy', '/pictures/webui'],
    autoTag: true,
    loraHashes: false,
    labels: {
      '/pictures/out': { label: 'Olive Sparrow', auto: true },
      '/pictures/comfy': { label: 'ComfyUI', auto: false },
      '/pictures/webui': { label: 'Amber Fox', auto: true },
    },
  },
  profiles: { sdxl: { steps: 30, artistTemplate: null, keepTags: '' }, anima: { negativePrompt: ' blurry ' } },
  sources: { backends: 'settings', tagger: 'env', wd14: 'settings', saveDir: 'settings', dirs: 'settings', autoTag: 'env' },
  builtinProfiles: [
    { id: 'sdxl', ...builtin },
    { id: 'anima', ...builtin, label: 'Anima' },
  ],
}

const draft = toDraft(view)
const all = new Set<Part>(['backends', 'tagger', 'wd14', 'gallery', 'profiles'])

// ── From the view to the draft ──
eq(
  draft.backends.map((b) => [b.id, b.token, b.clearToken, b.tokenSource, b.model, b.workflowsDir, b.shareWorkflows]),
  [
    ['box', '', false, 'settings', '', '', false],
    ['comfy', '', false, null, 'base.safetensors', '/workflows', true],
  ],
  'backends: tokens are never shown, only where one comes from'
)
check(new Set(draft.backends.map((b) => b.key)).size === 2, 'each backend has its own key')
eq(draft.tagger, AUTO, 'no tagger set reads as automatic')
eq([draft.wd14Dir, draft.wd14General, draft.wd14Character], ['/models/wd14', '', '0.9'], 'a threshold shows only where it differs from the default')
eq([draft.saveLabel, draft.dirLabels], ['', ['ComfyUI', '']], 'only display names set here are typed in; made-up ones are not')
eq([autoLabel(view, '/pictures/out'), autoLabel(view, ' /pictures/webui '), autoLabel(view, '/pictures/comfy')], ['Olive Sparrow', 'Amber Fox', undefined], 'an empty name shows the made-up one')
eq(
  [draft.profiles.sdxl!.steps, draft.profiles.sdxl!.artistTemplate, draft.profiles.sdxl!.keepTags, draft.profiles.sdxl!.width],
  ['30', '-', '-', ''],
  'profiles: "-" stands for no artist field and no tags kept'
)

// ── Only what changed is sent ──
eq(toInput(draft, new Set()), {}, 'nothing changed, nothing sent')
eq(Object.keys(toInput(draft, new Set<Part>(['tagger']))), ['tagger'], 'only the changed part')
eq(Object.keys(toInput(draft, all)), ['backends', 'tagger', 'wd14', 'gallery', 'profiles'], 'every part when all changed')

// ── Backends ──
const backends = (d: Draft) => toInput(d, new Set<Part>(['backends'])).backends as Record<string, unknown>[]
const sent = backends(draft)
check(!('token' in sent[0]), 'an untouched token is kept, not sent')
eq(sent[1], { id: 'comfy', kind: 'comfyui', url: 'http://127.0.0.1:8188/', profile: 'anima', model: 'base.safetensors', controlnet: 'sdxl/openpose.safetensors', workflowsDir: '/workflows', shareWorkflows: true }, 'comfyui sends its model, pose ControlNet and workflows folder')
const typed = { ...draft, backends: [{ ...draft.backends[0], token: 'secret' }, { ...draft.backends[1], clearToken: true, token: '' }] }
eq([backends(typed)[0].token, backends(typed)[1].token], ['secret', ''], 'a typed token is set, a cleared one emptied')
const asA1111 = { ...draft, backends: [{ ...draft.backends[1], kind: 'a1111' as const }] }
eq(Object.keys(backends(asA1111)[0]), ['id', 'kind', 'url', 'profile'], 'model and workflows only for comfyui')
const noFolder = { ...draft, backends: [{ ...draft.backends[1], model: '  ', controlnet: ' ', workflowsDir: ' ' }] }
eq(Object.keys(backends(noFolder)[0]), ['id', 'kind', 'url', 'profile'], 'blank model, ControlNet and folder are left out, and so is sharing')
const added = emptyBackend()
eq([added.kind, added.profile, added.id, added.tokenSource], ['a1111', 'sdxl', '', null], 'a new backend starts as an empty a1111 row')
check(added.key !== draft.backends[0].key && added.key !== draft.backends[1].key, 'with a key of its own')

// ── Tagger and WD14 ──
eq(toInput({ ...draft, tagger: 'box' }, new Set<Part>(['tagger'])).tagger, 'box', 'a picked tagger is sent')
eq(toInput(draft, new Set<Part>(['tagger'])).tagger, null, 'automatic is sent as null')
eq(toInput(draft, new Set<Part>(['wd14'])).wd14, { modelDir: '/models/wd14', character: 0.9 }, 'thresholds left at the default are not sent')
eq(toInput({ ...draft, wd14Dir: ' ', wd14General: '0.4' }, new Set<Part>(['wd14'])).wd14, { modelDir: null, general: 0.4, character: 0.9 }, 'an empty folder turns WD14 off')

// ── Gallery ──
const gallery = (d: Draft) => toInput(d, new Set<Part>(['gallery'])).gallery
eq(
  gallery({ ...draft, saveLabel: ' Mine ', dirs: [' /pictures/comfy ', '', '/pictures/webui'], dirLabels: ['ComfyUI', 'orphan', ''] }),
  { saveDir: '/pictures/out', dirs: ['/pictures/comfy', '/pictures/webui'], autoTag: true, loraHashes: false, labels: { '/pictures/out': 'Mine', '/pictures/comfy': 'ComfyUI' } },
  'folders trimmed, empty ones dropped; names only for folders that have one typed'
)
eq((gallery({ ...draft, saveDir: '  ' }) as { saveDir: unknown }).saveDir, null, 'an empty save folder turns saving off')

// ── Profiles ──
const profiles = (d: Draft) => toInput(d, new Set<Part>(['profiles'])).profiles
eq(profiles(draft), { sdxl: { steps: 30, artistTemplate: null, keepTags: '' }, anima: { negativePrompt: ' blurry ' } }, 'the draft sends back what the view held')
const edited = {
  ...draft,
  profiles: { ...draft.profiles, sdxl: { ...emptyProfile(), width: '832', cfg: '4.5', qualityTags: ' best ', artistTemplate: '@{artist}', tagStyle: 'space', keepTags: 'a_b ' } },
}
eq(
  (profiles(edited) as Record<string, unknown>).sdxl,
  { width: 832, cfg: 4.5, qualityTags: ' best ', artistTemplate: '@{artist}', tagStyle: 'space', keepTags: 'a_b ' },
  'numbers as numbers; text kept as typed'
)
eq(profiles({ ...draft, profiles: { sdxl: emptyProfile(), anima: emptyProfile() } }), {}, 'a profile back to built-in sends nothing')

done('settings-draft')
