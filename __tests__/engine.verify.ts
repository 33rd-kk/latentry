/**
 * Latentry's own engine (lib/engine): finding the GPU, choosing the PyTorch
 * build for it, the uv download, model ids and profiles, and its settings.
 *
 * Run with: npm test -- engine
 */
import { check, done, eq } from './assert'
import { CATALOG, catalogEntry, engineModelId } from '../lib/engine/catalog'
import { chooseTorch, parseNvidiaSmi, type Gpu } from '../lib/engine/gpus'
import { isSha256 } from '../lib/engine/download'
import { isPinnedUv, uvAsset } from '../lib/engine/install'
import { UV_SHA256, UV_VERSION, uvUrl } from '../lib/engine/uv-release'
import { profileFor } from '../lib/engine/supervisor'
import { EMPTY_SETTINGS, validateSettings } from '../lib/settings/schema'

// nvidia-smi
const smi = '0, NVIDIA GeForce RTX 5060 Ti, 16311, 581.29, 12.0\n1, NVIDIA GeForce RTX 3060, 12288, 581.29, 8.6\n'
const gpus = parseNvidiaSmi(smi)
eq(gpus.map((gpu) => [gpu.index, gpu.name, gpu.vramMiB, gpu.computeCap]), [
  [0, 'NVIDIA GeForce RTX 5060 Ti', 16311, '12.0'],
  [1, 'NVIDIA GeForce RTX 3060', 12288, '8.6'],
], 'two GPUs from nvidia-smi')
eq(parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.'), [], 'an error message is no GPU')
eq(parseNvidiaSmi('0, Old Card, 4096, 470.1, [N/A]')[0].computeCap, null, 'an old driver without compute_cap')

// PyTorch build
const gpu = (driver: string, computeCap: string | null): Gpu => ({ index: 0, vendor: 'nvidia', name: 'x', vramMiB: 8192, driver, computeCap })
eq(chooseTorch([gpu('581.29', '12.0')]).indexUrl, 'https://download.pytorch.org/whl/cu130', 'driver 580+: CUDA 13.0')
eq(chooseTorch([gpu('572.16', '12.0')]).indexUrl, 'https://download.pytorch.org/whl/cu128', 'driver 570: CUDA 12.8, enough for Blackwell')
eq(chooseTorch([gpu('561.09', '8.9')]).indexUrl, 'https://download.pytorch.org/whl/cu126', 'driver 560: CUDA 12.6')
eq(chooseTorch([gpu('536.0', '8.6')]).indexUrl, 'https://download.pytorch.org/whl/cu118', 'an older driver: CUDA 11.8')
check(chooseTorch([gpu('561.09', '12.0')]).label.startsWith('unsupported'), 'Blackwell on a driver too old for it is refused, not installed broken')
eq(chooseTorch([gpu('581.29', '8.9'), gpu('561.09', '8.6')]).indexUrl, 'https://download.pytorch.org/whl/cu126', 'the oldest driver decides')
eq(chooseTorch([]).indexUrl, 'https://download.pytorch.org/whl/cpu', 'no GPU: the CPU build')
eq(chooseTorch([{ index: 0, vendor: 'apple', name: 'Apple GPU', vramMiB: 0, driver: null, computeCap: null }]).indexUrl, null, 'Apple: the default index (MPS)')

// uv
eq(uvAsset('win32', 'x64'), 'uv-x86_64-pc-windows-msvc.zip', 'Windows')
eq(uvAsset('linux', 'arm64'), 'uv-aarch64-unknown-linux-gnu.tar.gz', 'Linux on ARM')
eq(uvAsset('darwin', 'arm64'), 'uv-aarch64-apple-darwin.tar.gz', 'macOS')
eq(uvAsset('freebsd', 'x64'), null, 'no build')
const everyUvBuild = ['win32', 'darwin', 'linux'].flatMap((platform) => ['x64', 'arm64'].map((arch) => uvAsset(platform as NodeJS.Platform, arch)!))
check(everyUvBuild.every((asset) => isSha256(UV_SHA256[asset])), 'every uv build Latentry may download has a pinned SHA-256')
eq(Object.keys(UV_SHA256).sort(), [...everyUvBuild].sort(), 'and nothing else is pinned')
check(uvUrl('uv-x86_64-pc-windows-msvc.zip') === `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`, 'uv comes from the pinned release, not "latest"')
check(isPinnedUv(`uv ${UV_VERSION} (46b84fd0b 2026-10-03 x86_64-pc-windows-msvc)`) && !isPinnedUv('uv 0.13.0 (abc)') && !isPinnedUv(''), 'an installed uv is kept only when it is the pinned release')

// Catalog
eq(new Set(CATALOG.map((entry) => entry.id)).size, CATALOG.length, 'catalog ids are unique')
check(CATALOG.every((entry) => entry.license && entry.licenseUrl.startsWith('https://') && entry.terms), 'every entry states its license')
check(CATALOG.filter((entry) => entry.kind === 'checkpoint').every((entry) => entry.family && entry.profile), 'every checkpoint has a family and profile')
check(CATALOG.filter((entry) => entry.kind === 'tagger').every((entry) => entry.files?.includes('model.onnx') && entry.files.includes('selected_tags.csv')), 'taggers fetch the model and its tags')
check(CATALOG.every((entry) => /^[0-9a-f]{40}$/.test(entry.revision)), 'every entry downloads a pinned commit')
check(
  CATALOG.every((entry) => [...(entry.filename ? [entry.filename] : []), ...(entry.files ?? [])].every((file) => isSha256(entry.sha256?.[file]))),
  'every single file has a pinned SHA-256'
)
check(CATALOG.every((entry) => entry.filename || entry.files || !entry.sha256), 'a whole folder is checked by its commit instead')
check(!catalogEntry('noobai-xl-1.1')!.commercialOutputs, 'NoobAI is marked non-commercial')
eq(engineModelId(catalogEntry('illustrious-xl-2.0')!), 'Illustrious-XL-v2.0.safetensors', 'a single file is its file name')
eq(engineModelId(catalogEntry('anima-base-1.0')!), 'Anima-Base-v1.0-Diffusers', 'a repository is its folder name')

// Profiles for running engines
eq(profileFor('Illustrious-XL-v2.0.safetensors', 'sdxl'), 'illustrious', 'a catalog model: its profile')
eq(profileFor('my-merge.safetensors', 'sdxl'), 'sdxl', 'an unknown SDXL model')
eq(profileFor('Anima-Base-v1.0-Diffusers', 'anima'), 'anima', 'Anima')
eq(profileFor(null, null), 'sdxl', 'nothing loaded yet')

// Settings
const ok = validateSettings({ engine: { autoStart: false, basePort: 7900, gpus: [0, 1, 1], model: 'x.safetensors', modelsDir: 'D:/models' } }, EMPTY_SETTINGS)
eq(ok.ok ? ok.settings.engine : null, { autoStart: false, modelsDir: 'D:/models', basePort: 7900, gpus: [0, 1], model: 'x.safetensors' }, 'engine settings')
const bad = validateSettings({ engine: { basePort: 80, gpus: 'all', model: '../../x', modelsDir: 'models' } }, EMPTY_SETTINGS)
eq(bad.ok ? null : Object.keys(bad.errors).sort(), ['engine.basePort', 'engine.gpus', 'engine.model', 'engine.modelsDir'], 'a low port, a non-list, a path as a model, a relative folder')
const kept = validateSettings({ gallery: { autoTag: true } }, { version: 1, engine: { model: 'a.safetensors' } })
eq(kept.ok ? kept.settings.engine : null, { model: 'a.safetensors' }, 'saving another part keeps the engine settings')

const merged = validateSettings({ engine: { autoStart: false } }, { version: 1, engine: { model: 'a.safetensors', modelsDir: 'D:/models' } })
eq(merged.ok ? merged.settings.engine : null, { model: 'a.safetensors', modelsDir: 'D:/models', autoStart: false }, 'one engine field at a time keeps the others')
const cleared = validateSettings({ engine: { modelsDir: null } }, { version: 1, engine: { model: 'a.safetensors', modelsDir: 'D:/models' } })
eq(cleared.ok ? cleared.settings.engine : null, { model: 'a.safetensors', modelsDir: null }, 'null goes back to the default folder')

done('engine')
