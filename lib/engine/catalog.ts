// Models the setup page offers to download. Latentry ships none of them:
// each is fetched from its own Hugging Face repository when the user picks
// it, after the page has shown its license.
//
// `terms` is a plain summary for the page; the license itself (`licenseUrl`)
// is what applies. Anything not "commercial use allowed" is said up front.

import type { ProfileId } from '@/lib/profiles'

export type CatalogKind = 'checkpoint' | 'tagger'

export interface CatalogEntry {
  id: string
  kind: CatalogKind
  name: string
  repo: string
  /** One file in the repository; absent for a whole diffusers folder. */
  filename?: string
  /** For a tagger: the files it needs from the repository. */
  files?: string[]
  /** Download size in bytes, for the page. */
  bytes: number
  family?: 'sdxl' | 'anima'
  /** The profile a backend running this model starts with. */
  profile?: ProfileId
  license: string
  licenseUrl: string
  /** Whether the license lets you use the pictures commercially. */
  commercialOutputs: boolean
  terms: string
  /** Shown first when several are offered for the same purpose. */
  recommended?: boolean
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'illustrious-xl-2.0',
    kind: 'checkpoint',
    name: 'Illustrious XL 2.0',
    repo: 'OnomaAIResearch/Illustrious-XL-v2.0',
    filename: 'Illustrious-XL-v2.0.safetensors',
    bytes: 6938040674,
    family: 'sdxl',
    profile: 'illustrious',
    license: 'CreativeML Open RAIL-M',
    licenseUrl: 'https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0',
    commercialOutputs: true,
    terms: 'The license lists uses that are not allowed.',
    recommended: true,
  },
  {
    id: 'animagine-xl-4.0',
    kind: 'checkpoint',
    name: 'Animagine XL 4.0',
    repo: 'cagliostrolab/animagine-xl-4.0',
    filename: 'animagine-xl-4.0.safetensors',
    bytes: 6938434056,
    family: 'sdxl',
    profile: 'illustrious',
    license: 'CreativeML Open RAIL++-M',
    licenseUrl: 'https://huggingface.co/cagliostrolab/animagine-xl-4.0',
    commercialOutputs: true,
    terms: 'The license lists uses that are not allowed.',
  },
  {
    id: 'noobai-xl-1.1',
    kind: 'checkpoint',
    name: 'NoobAI XL 1.1',
    repo: 'Laxhar/noobai-XL-1.1',
    filename: 'NoobAI-XL-v1.1.safetensors',
    bytes: 7105349958,
    family: 'sdxl',
    profile: 'illustrious',
    license: 'Fair AI Public License 1.0-SD',
    licenseUrl: 'https://huggingface.co/Laxhar/noobai-XL-1.1',
    commercialOutputs: false,
    terms: 'Models derived from it must be shared under the same license.',
  },
  {
    id: 'sdxl-base-1.0',
    kind: 'checkpoint',
    name: 'Stable Diffusion XL base 1.0',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0',
    filename: 'sd_xl_base_1.0.safetensors',
    bytes: 6938078334,
    family: 'sdxl',
    profile: 'sdxl',
    license: 'CreativeML Open RAIL++-M',
    licenseUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0',
    commercialOutputs: true,
    terms: 'The license lists uses that are not allowed.',
  },
  {
    id: 'anima-base-1.0',
    kind: 'checkpoint',
    name: 'Anima Base 1.0',
    repo: 'circlestone-labs/Anima-Base-v1.0-Diffusers',
    bytes: 5642034551,
    family: 'anima',
    profile: 'anima',
    license: 'CircleStone Labs Non-Commercial License',
    licenseUrl: 'https://huggingface.co/circlestone-labs/Anima-Base-v1.0-Diffusers/blob/main/LICENSE.md',
    commercialOutputs: true,
    terms: 'The model itself is for non-commercial use; its outputs may not be used to train a competing model.',
  },
  {
    id: 'wd-vit-tagger-v3',
    kind: 'tagger',
    name: 'WD ViT Tagger v3',
    repo: 'SmilingWolf/wd-vit-tagger-v3',
    files: ['model.onnx', 'selected_tags.csv'],
    bytes: 378536310 + 308468,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/SmilingWolf/wd-vit-tagger-v3',
    commercialOutputs: true,
    terms: 'Permissive.',
    recommended: true,
  },
  {
    id: 'wd-eva02-large-tagger-v3',
    kind: 'tagger',
    name: 'WD EVA02-Large Tagger v3',
    repo: 'SmilingWolf/wd-eva02-large-tagger-v3',
    files: ['model.onnx', 'selected_tags.csv'],
    bytes: 1260435999 + 308468,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3',
    commercialOutputs: true,
    terms: 'Permissive. More accurate, three times the size.',
  },
]

export function catalogEntry(id: string): CatalogEntry | null {
  return CATALOG.find((entry) => entry.id === id) ?? null
}

/**
 * The id the engine gives a model once it is in the models folder (see
 * engine/latentry_engine/models.py): a single file's name, or a
 * repository's folder name.
 */
export function engineModelId(entry: CatalogEntry): string {
  return entry.filename ?? entry.repo.split('/')[1]
}
