// Makes the upgrade fixtures (__tests__/fixtures/upgrade/<version>/) for
// released versions, each with that release's own code: its lib/ is taken
// from the Git tag into a temp folder, and scripts/upgrade-fixture-make.ts
// runs against it. __tests__/upgrade.verify.ts then reads them with today's
// code.
//
//   node scripts/upgrade-fixture.mjs 0.13.0      one release, after tagging it
//   node scripts/upgrade-fixture.mjs --all       every release in RECORD_FIELDS
//
// A fixture is made once and then kept as it is: making an old one again
// with new code would hide the very break it is there to catch. When a
// release adds a field to the `latentry` record, add it to RECORD_FIELDS.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT = path.join(ROOT, '__tests__', 'fixtures', 'upgrade')

// The record fields each release added, oldest first.
const RECORD_FIELDS = [
  ['0.5.0', 'schema backend kind profile model mode prompt negative_prompt seed width height sampler scheduler steps cfg strength created'],
  ['0.6.0', 'loras'],
  ['0.7.0', 'workflow'],
  ['0.8.0', ''],
  ['0.9.0', 'hires'],
  ['0.10.0', 'prompt_template'],
  ['0.11.0', ''],
  ['0.12.0', 'grid'],
]

function fieldsOf(version) {
  const fields = []
  for (const [release, added] of RECORD_FIELDS) {
    fields.push(...added.split(' ').filter(Boolean))
    if (release === version) return fields
  }
  // A release after the table adds nothing until the table says so.
  return fields
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

function make(version) {
  const target = path.join(OUT, version)
  if (existsSync(target)) {
    console.log(`${version}: already there, kept`)
    return
  }
  const temp = mkdtempSync(path.join(tmpdir(), 'latentry-upgrade-fixture-'))
  try {
    const archive = path.join(temp, 'lib.tar')
    run('git', ['archive', '--output', archive, `v${version}`, 'lib'], { cwd: ROOT })
    // A relative name: GNU tar takes "C:" in a path for a remote host.
    run('tar', ['-xf', 'lib.tar'], { cwd: temp })
    writeFileSync(
      path.join(temp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'commonjs',
          target: 'es2022',
          esModuleInterop: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          types: ['node'],
          // The old lib/ is in the temp folder and the maker in this repo: one root for both.
          rootDir: path.parse(ROOT).root,
          paths: { '@/*': ['./*'] },
        },
      })
    )
    run(
      process.execPath,
      [
        path.join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js'),
        '-r',
        path.join(ROOT, 'node_modules', 'tsconfig-paths', 'register'),
        path.join(ROOT, 'scripts', 'upgrade-fixture-make.ts'),
        version,
        path.join(temp, 'lib'),
        target,
        fieldsOf(version).join(','),
      ],
      { cwd: temp, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1', TS_NODE_PROJECT: path.join(temp, 'tsconfig.json'), NODE_PATH: path.join(ROOT, 'node_modules') } }
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

const args = process.argv.slice(2)
const versions = args.includes('--all') ? RECORD_FIELDS.map(([release]) => release) : args
if (!versions.length) {
  console.error('Usage: node scripts/upgrade-fixture.mjs <version> | --all')
  process.exit(1)
}
for (const version of versions) make(version)
