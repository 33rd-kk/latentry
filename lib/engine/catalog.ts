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
  /**
   * The repository commit downloaded, never a branch: what was checked is
   * what arrives, even if the repository changes later.
   */
  revision: string
  /** One file in the repository; absent for a whole diffusers folder. */
  filename?: string
  /** For a tagger: the files it needs from the repository. */
  files?: string[]
  /**
   * SHA-256 of `filename` or of each of `files`, checked before the file is
   * kept. A whole folder is checked against the commit's own hashes instead
   * (engine/latentry_engine/models.py). Pins come from
   * `node scripts/pin-downloads.mjs hf <repo> <files...>`.
   */
  sha256?: Record<string, string>
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
    revision: '69459c1fe6f46db41ab31e6114f05acc0e06bcaa',
    filename: 'Illustrious-XL-v2.0.safetensors',
    sha256: { 'Illustrious-XL-v2.0.safetensors': 'c2a1a3eaa13d4c107dc7e00c3fe830cab427aa026362740ea094745b3422a331' },
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
    revision: '2b7c1b397761bf5bd3cc42e5b39ec99314a75a96',
    filename: 'animagine-xl-4.0.safetensors',
    sha256: { 'animagine-xl-4.0.safetensors': '1d5b43ff75b6ab598502d4c779d2fbfa3dceca51c60c3b609640a60772333916' },
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
    revision: '814a274af2b8097c0828819d561ec74c7d0c6cea',
    filename: 'NoobAI-XL-v1.1.safetensors',
    sha256: { 'NoobAI-XL-v1.1.safetensors': '6681e8e4b134c81f16533acedb0d406d7e5e366e1624b4105178c64d00b05d51' },
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
    revision: '462165984030d82259a11f4367a4eed129e94a7b',
    filename: 'sd_xl_base_1.0.safetensors',
    sha256: { 'sd_xl_base_1.0.safetensors': '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b' },
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
    revision: '073c3a9db359c31ad0e8aa268d15775473c2176c',
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
    revision: '7f6b584d0bd3f55c4531f14ba3d4761b2bccdc0f',
    files: ['model.onnx', 'selected_tags.csv'],
    sha256: {
      'model.onnx': '35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6',
      'selected_tags.csv': '298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217',
    },
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
    revision: 'b25b82a03f7282e41aa2f257a52c7583b710bd1c',
    files: ['model.onnx', 'selected_tags.csv'],
    sha256: {
      'model.onnx': '9e768793060c7939b277ccb382783e8670e8a042d29d77aa736be0c8cc898bfc',
      'selected_tags.csv': '298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217',
    },
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
