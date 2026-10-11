// Makes the engine's lock files, engine/locks/<platform>-<backend>.txt: every
// Python package the engine installs, at one version, with the SHA-256 of each
// file, for each machine and PyTorch build Latentry installs on (see
// lib/engine/locks.ts, which picks one, and lib/engine/install.ts, which
// installs it with `uv pip sync --require-hashes`).
//
//   npm run engine:lock                keep the pinned versions; add or drop only what changed
//   npm run engine:lock -- --upgrade   take the newest versions up to LOCKED_ON
//   npm run engine:lock -- --check     make them again in a temp folder and fail on any difference
//
// They are resolved for LOCKED_ON in lib/engine/locks.ts (uv's --exclude-newer)
// with the pinned uv (lib/engine/uv-release.ts): the runtime folder's, or the
// one LATENTRY_UV names, or `uv` on PATH, as long as it is that release.
// PyTorch's own index keeps no upload dates, so --exclude-newer cannot hold
// it back; keeping the versions already in the files is what makes a second
// run come out the same. To move to newer packages, set LOCKED_ON to today
// and run with --upgrade, then read the diff.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TARGETS = [
  ...['cpu', 'cu118', 'cu126', 'cu128', 'cu130'].flatMap((backend) => [
    { name: `windows-x86_64-${backend}`, platform: 'x86_64-pc-windows-msvc', backend },
    { name: `linux-x86_64-${backend}`, platform: 'x86_64-unknown-linux-gnu', backend },
  ]),
  // Apple silicon: PyTorch from PyPI, with Metal (MPS), for macOS LOCKED_MACOS
  // and later: uv otherwise assumes an older macOS, and current PyTorch wheels
  // are for 14 and later only.
  { name: 'macos-arm64', platform: 'aarch64-apple-darwin', backend: null, macos: true },
]
const PYTHON_VERSION = '3.12'
const LOCKS = 'engine/locks'

/** A string or number constant from a TypeScript module, read as text. */
function constant(file, name) {
  const match = new RegExp(`export const ${name} = '?([^'\\s]+)'?`).exec(readFileSync(file, 'utf8'))
  if (!match) throw new Error(`${name} not found in ${file}`)
  return match[1]
}

const lockedOn = constant('lib/engine/locks.ts', 'LOCKED_ON')
const lockedMacos = constant('lib/engine/locks.ts', 'LOCKED_MACOS')
const uvVersion = constant('lib/engine/uv-release.ts', 'UV_VERSION')
const args = process.argv.slice(2)
const check = args.includes('--check')
const upgrade = args.includes('--upgrade')

// Only what is said here reaches uv: no uv.toml, no UV_* settings of the
// user's, and a cache of its own that is deleted afterwards.
const cache = mkdtempSync(path.join(tmpdir(), 'latentry-uv-cache-'))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^UV_/i.test(name)))
env.UV_NO_CONFIG = '1'
env.UV_NO_PROGRESS = '1'
env.UV_CACHE_DIR = cache

function findUv() {
  const candidates = [
    process.env.LATENTRY_UV,
    path.join('.runtime', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv'),
    'uv',
  ].filter(Boolean)
  for (const uv of candidates) {
    if (uv !== 'uv' && !existsSync(uv)) continue
    const result = spawnSync(uv, ['--version'], { env, encoding: 'utf8' })
    const version = result.stdout?.trim().split(/\s+/)[1]
    if (version === uvVersion) return uv
    if (version) console.error(`Skipping ${uv}: uv ${version}, not ${uvVersion}`)
  }
  throw new Error(`No uv ${uvVersion} found: install the engine once, or set LATENTRY_UV to uv ${uvVersion}`)
}

function header(target) {
  return [
    `# The engine's Python packages for ${target.name}, resolved for ${lockedOn}.`,
    '# Made by scripts/lock-engine.mjs (npm run engine:lock); do not edit by hand.',
    '',
  ].join('\n')
}

function lock(uv, target, out) {
  const command = [
    'pip', 'compile', 'engine/pyproject.toml', `${LOCKS}/torch.in`,
    '--python-version', PYTHON_VERSION,
    '--python-platform', target.platform,
    ...(target.backend ? ['--torch-backend', target.backend] : []),
    '--generate-hashes',
    '--exclude-newer', lockedOn,
    '--no-header',
    '--quiet',
    ...(upgrade ? ['--upgrade'] : []),
    '--output-file', out,
  ]
  const targetEnv = target.macos ? { ...env, MACOSX_DEPLOYMENT_TARGET: `${lockedMacos}.0` } : env
  const result = spawnSync(uv, command, { env: targetEnv, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${target.name}: uv pip compile failed\n${result.stderr}`)
  const body = readFileSync(out, 'utf8').replace(/^(#[^\n]*\n)+\n?/, '')
  writeFileSync(out, header(target) + body)
}

try {
  const uv = findUv()
  const dir = check ? mkdtempSync(path.join(tmpdir(), 'latentry-locks-')) : LOCKS
  const stale = []
  try {
    for (const target of TARGETS) {
      const file = `${target.name}.txt`
      const out = path.join(dir, file)
      // The versions already pinned are kept unless --upgrade: uv prefers what
      // the output file holds. It would keep its hashes too, so a check gets
      // the versions alone and fetches every hash again to compare.
      if (check && existsSync(path.join(LOCKS, file))) {
        const pinned = readFileSync(path.join(LOCKS, file), 'utf8')
        writeFileSync(out, pinned.replace(/ \\\n(\s+--hash=sha256:[0-9a-f]{64}( \\)?\n)+/g, '\n'))
      }
      lock(uv, target, out)
      if (check && (!existsSync(path.join(LOCKS, file)) || readFileSync(out, 'utf8') !== readFileSync(path.join(LOCKS, file), 'utf8'))) {
        stale.push(file)
      }
      console.log(`${check ? 'checked' : 'wrote'} ${LOCKS}/${file}`)
    }
  } finally {
    if (check) rmSync(dir, { recursive: true, force: true })
  }
  if (stale.length) {
    console.error(`Out of date: ${stale.join(', ')}. Run npm run engine:lock and commit the result.`)
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  rmSync(cache, { recursive: true, force: true })
}
