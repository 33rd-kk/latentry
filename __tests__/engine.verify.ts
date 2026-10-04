/**
 * Latentry's own engine (lib/engine): finding the GPU, choosing the PyTorch
 * build for it, the uv download, model ids and profiles, and its settings.
 *
 * Run with: npm test -- engine
 */
import { check, done, eq } from './assert'
import { CATALOG, catalogEntry, engineModelId } from '../lib/engine/catalog'
import { chooseTorch, parseNvidiaSmi, type Gpu } from '../lib/engine/gpus'
import { uvAsset } from '../lib/engine/install'
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

// Catalog
eq(new Set(CATALOG.map((entry) => entry.id)).size, CATALOG.length, 'catalog ids are unique')
check(CATALOG.every((entry) => entry.license && entry.licenseUrl.startsWith('https://') && entry.terms), 'every entry states its license')
check(CATALOG.filter((entry) => entry.kind === 'checkpoint').every((entry) => entry.family && entry.profile), 'every checkpoint has a family and profile')
check(CATALOG.filter((entry) => entry.kind === 'tagger').every((entry) => entry.files?.includes('model.onnx') && entry.files.includes('selected_tags.csv')), 'taggers fetch the model and its tags')
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

done('engine')
