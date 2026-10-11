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
import { isPinnedUv, uvAsset, uvEnvironment, venvOnOtherPython } from '../lib/engine/install'
import { UV_SHA256, UV_VERSION, uvUrl } from '../lib/engine/uv-release'
import { LOCKED_BACKENDS, LOCKED_ON, lockAgeDays, lockFailure, lockIsStale, lockName, torchRunsOn, wantsLatest } from '../lib/engine/locks'
import { loraAccess } from '../lib/engine/lora-access'
import { readdirSync, readFileSync } from 'node:fs'
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
eq(chooseTorch([gpu('572.16', '8.9')]).backend, 'cu126', 'driver 570 without Blackwell: CUDA 12.6, which PyTorch still publishes')
eq(chooseTorch([gpu('572.16', '10.0')]).backend, 'cu128', 'a data-centre Blackwell (10.0) needs CUDA 12.8 too')
check(chooseTorch([gpu('572.16', '12.0')]).outdated === true, 'CUDA 12.8 is marked outdated')
check(chooseTorch([gpu('536.0', '8.6')]).outdated === true, 'CUDA 11.8 is marked outdated')
check(!chooseTorch([gpu('581.29', '12.0')]).outdated && !chooseTorch([gpu('561.09', '8.9')]).outdated, 'CUDA 13.0 and 12.6 are current')
eq(chooseTorch([gpu('561.09', '8.9')]).indexUrl, 'https://download.pytorch.org/whl/cu126', 'driver 560: CUDA 12.6')
eq(chooseTorch([gpu('536.0', '8.6')]).indexUrl, 'https://download.pytorch.org/whl/cu118', 'an older driver: CUDA 11.8')
check(chooseTorch([gpu('561.09', '12.0')]).label.startsWith('unsupported'), 'Blackwell on a driver too old for it is refused, not installed broken')
eq(chooseTorch([gpu('581.29', '8.9'), gpu('561.09', '8.6')]).indexUrl, 'https://download.pytorch.org/whl/cu126', 'the oldest driver decides')
eq(chooseTorch([]).indexUrl, 'https://download.pytorch.org/whl/cpu', 'no GPU: the CPU build')
eq(chooseTorch([{ index: 0, vendor: 'apple', name: 'Apple GPU', vramMiB: 0, driver: null, computeCap: null }]).indexUrl, null, 'Apple: the default index (MPS)')
eq(chooseTorch([gpu('581.29', '12.0')]).backend, 'cu130', 'the backend names the CUDA build')
eq(chooseTorch([]).backend, 'cpu', 'no GPU: the cpu backend')
eq(chooseTorch([{ index: 0, vendor: 'apple', name: 'Apple GPU', vramMiB: 0, driver: null, computeCap: null }]).backend, null, 'Apple: no backend (PyPI build)')

// The pinned packages (lib/engine/locks.ts, engine/locks/)
eq(lockName('win32', 'x64', 'cu130'), 'windows-x86_64-cu130', 'lock: Windows with CUDA 13.0')
eq(lockName('linux', 'x64', 'cpu'), 'linux-x86_64-cpu', 'lock: Linux on the CPU')
eq(lockName('darwin', 'arm64', null, '23.6.0'), 'macos-arm64', 'lock: Apple silicon on macOS 14 (Darwin 23)')
eq(lockName('darwin', 'arm64', null, '25.0.0'), 'macos-arm64', 'lock: Apple silicon on a later macOS')
eq(lockName('darwin', 'arm64', null, '22.6.0'), null, "no lock: macOS 13, older than the lock's PyTorch")
eq(lockName('darwin', 'arm64', null), null, 'no lock: a macOS version not known')
eq(lockName('darwin', 'x64', null, '23.6.0'), null, 'no lock: Intel Mac')
eq(lockName('linux', 'arm64', 'cu130'), null, 'no lock: Linux on ARM')
eq(lockName('win32', 'x64', 'cu132'), null, 'no lock: a CUDA build without one')
eq(lockName('win32', 'x64', null), null, 'no lock: Windows without a backend')
const lockFiles = readdirSync('engine/locks').filter((file) => file.endsWith('.txt'))
eq(
  lockFiles.sort(),
  [...LOCKED_BACKENDS.flatMap((backend) => [`linux-x86_64-${backend}.txt`, `windows-x86_64-${backend}.txt`]), 'macos-arm64.txt'].sort(),
  'a lock file for every name lockName gives, and no other'
)
for (const file of lockFiles) {
  const text = readFileSync(`engine/locks/${file}`, 'utf8')
  const pins = text.split('\n').filter((line) => /^[A-Za-z0-9]/.test(line))
  check(pins.length > 40, `${file}: holds the packages (${pins.length})`)
  check(pins.every((line) => /^[A-Za-z0-9._-]+==[^ ]+ \\$/.test(line)), `${file}: every package at one version, with hashes after it`)
  const blocks = text.split(/\n(?=[A-Za-z0-9])/).filter((block) => /^[A-Za-z0-9]/.test(block))
  check(blocks.every((block) => /--hash=sha256:[0-9a-f]{64}/.test(block)), `${file}: every package has a SHA-256`)
  check(text.includes(`resolved for ${LOCKED_ON}.`), `${file}: resolved for LOCKED_ON (run npm run engine:lock)`)
  check(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), `${file}: no control characters`)
  check(/^torch==/m.test(text) && /^poseorbit==/m.test(text), `${file}: holds torch and poseorbit`)
}
check(readFileSync('engine/locks/windows-x86_64-cu130.txt', 'utf8').includes('+cu130 \\'), 'the CUDA lock holds the CUDA build of torch')
check(!readFileSync('engine/locks/macos-arm64.txt', 'utf8').includes('+cpu'), "macOS's lock holds PyPI's torch")

// Ways out of the lock
check(wantsLatest({ LATENTRY_ENGINE_PACKAGES: 'latest' }), 'LATENTRY_ENGINE_PACKAGES=latest')
check(wantsLatest({ LATENTRY_ENGINE_PACKAGES: ' Latest ' }), 'latest, any case')
check(!wantsLatest({}), 'pinned unless asked')
check(!wantsLatest({ LATENTRY_ENGINE_PACKAGES: 'newest' }), 'only "latest" turns it off')
eq(lockAgeDays(new Date('2026-10-22T12:00:00Z'), '2026-10-12'), 10, 'lock age in days')
check(!lockIsStale(new Date('2027-04-10T00:00:00Z'), '2026-10-12'), 'under 180 days: not stale')
check(lockIsStale(new Date('2027-04-11T00:00:00Z'), '2026-10-12'), 'over 180 days: stale')
eq(lockFailure('error: No solution found\n  cause: Because there is no version of zipp==999.0.0 and you require it'), 'missing', 'a version no longer offered: retry unpinned')
eq(lockFailure('Failed to download `torch==2.14.1+cu130`\n  HTTP status client error (404 Not Found)'), 'missing', 'a file gone (404): retry unpinned')
eq(lockFailure('  cause: Hash mismatch for `zipp==4.1.1`\n  Expected: ...'), 'stop', 'a hash mismatch: stop')
eq(lockFailure('Hash mismatch for `torch`, and 404 Not Found elsewhere'), 'stop', 'a hash mismatch stops even beside a 404')
eq(lockFailure('error: Failed to fetch: connection reset'), 'stop', 'anything not recognised: stop')
check(torchRunsOn(['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_120'], [12, 0]), 'a kernel for the GPU')
check(!torchRunsOn(['sm_75', 'sm_80', 'sm_86', 'sm_90'], [12, 0]), 'no kernel for a newer GPU')
check(torchRunsOn(['sm_80', 'sm_90', 'compute_90'], [12, 0]), 'PTX for an earlier one the driver can compile')
check(!torchRunsOn(['sm_80', 'compute_120'], [9, 0]), 'PTX only for a later one does not run')

// uv
eq(uvAsset('win32', 'x64'), 'uv-x86_64-pc-windows-msvc.zip', 'Windows')
eq(uvAsset('linux', 'arm64'), 'uv-aarch64-unknown-linux-gnu.tar.gz', 'Linux on ARM')
eq(uvAsset('darwin', 'arm64'), 'uv-aarch64-apple-darwin.tar.gz', 'macOS')
eq(uvAsset('freebsd', 'x64'), null, 'no build')
const everyUvBuild = ['win32', 'darwin', 'linux'].flatMap((platform) => ['x64', 'arm64'].map((arch) => uvAsset(platform as NodeJS.Platform, arch)!))
check(everyUvBuild.every((asset) => isSha256(UV_SHA256[asset])), 'every uv build Latentry may download has a pinned SHA-256')
eq(Object.keys(UV_SHA256).sort(), [...everyUvBuild].sort(), 'and nothing else is pinned')
check(uvUrl('uv-x86_64-pc-windows-msvc.zip') === `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`, 'uv comes from the pinned release, not "latest"')
check(isPinnedUv(`uv ${UV_VERSION} (46b84fd0b 2026-10-03 x86_64-pc-windows-msvc)`), 'an installed uv of the pinned release is kept')
check(!isPinnedUv('uv 0.12.23 (46b84fd0b 2026-10-03 x86_64-pc-windows-msvc)') && !isPinnedUv('uv 0.13.1 (abc)') && !isPinnedUv(''), 'any other release is replaced, older or newer')

// uv runs apart from the user's own uv setup, on its own Python
const runtime = { uvCache: 'R:/rt/cache', uvPython: 'R:/rt/python' }
const uvEnv = uvEnvironment(runtime, { PATH: 'P', HF_TOKEN: 'h', UV_INDEX_URL: 'https://mirror.example', uv_python: '3.9', UV_CACHE_DIR: 'C:/elsewhere' })
eq(
  Object.keys(uvEnv).filter((name) => /^uv_/i.test(name)).sort(),
  ['UV_CACHE_DIR', 'UV_MANAGED_PYTHON', 'UV_NO_CONFIG', 'UV_NO_PROGRESS', 'UV_PYTHON_INSTALL_DIR'],
  "the user's own UV_* settings (any case) are dropped; only Latentry's are set"
)
eq([uvEnv.UV_CACHE_DIR, uvEnv.UV_PYTHON_INSTALL_DIR, uvEnv.UV_MANAGED_PYTHON, uvEnv.UV_NO_CONFIG], ['R:/rt/cache', 'R:/rt/python', '1', '1'], 'cache and Python in the runtime folder; uv-managed Python only; no uv.toml')
eq([uvEnv.PATH, uvEnv.HF_TOKEN], ['P', 'h'], 'everything else is passed on')
const cfg = (home: string) => `home = ${home}\nimplementation = CPython\nversion_info = 3.12.10\n`
check(venvOnOtherPython(cfg('C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python312'), 'C:/app/.runtime/python', 'win32'), 'a venv on a Python installed elsewhere is made again')
check(!venvOnOtherPython(cfg('C:\\app\\.runtime\\python\\cpython-3.12.10-windows-x86_64-none'), 'C:/APP/.runtime/python', 'win32'), "one on Latentry's own Python is kept (case-insensitive on Windows)")
check(venvOnOtherPython(cfg('C:\\app\\.runtime\\python-other\\cpython-3.12'), 'C:/app/.runtime/python', 'win32'), 'a folder that only starts with the same name is not inside it')
check(venvOnOtherPython('implementation = CPython\n', 'C:/app/.runtime/python', 'win32'), 'a pyvenv.cfg without a home is made again')
check(!venvOnOtherPython(cfg('/app/.runtime/python/cpython-3.12-linux-x86_64-gnu/bin'), '/app/.runtime/python', 'linux'), 'on Linux too')
check(venvOnOtherPython(cfg('/usr/bin'), '/app/.runtime/python', 'linux') && venvOnOtherPython(cfg('/APP/.runtime/python/x'), '/app/.runtime/python', 'linux'), 'where case counts')

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

// The LoRA list: this machine, or paired devices only when sharing is on
const share = (value: unknown) => {
  const result = validateSettings({ engine: { shareLoras: value } }, { version: 1, engine: { autoStart: false } })
  return result.ok ? result.settings.engine : null
}
eq([share(true), share('yes')], [{ autoStart: false, shareLoras: true }, { autoStart: false, shareLoras: false }], 'sharing LoRAs is on only for true, and keeps the other engine fields')
const local = new Headers({ host: 'localhost:3000' })
const phone = new Headers({ host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' })
const sharing = { version: 1, engine: { shareLoras: true } } as const
eq(
  [loraAccess(local, EMPTY_SETTINGS, {}), loraAccess(phone, EMPTY_SETTINGS, {}), loraAccess(phone, sharing, {})],
  ['edit', null, 'shared'],
  'this machine always; a paired device only with sharing on'
)
eq(loraAccess(phone, EMPTY_SETTINGS, { SETTINGS_EDIT: 'lan' }), 'edit', 'SETTINGS_EDIT=lan already lets the LAN edit')

done('engine')
