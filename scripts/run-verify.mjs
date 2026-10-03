// Runs every __tests__/*.verify.ts in turn. Each one is a plain script that
// prints its own tally and exits non-zero on a failure, so there is no test
// framework to install: ts-node and the path aliases are all it needs.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = '__tests__'
const only = process.argv.slice(2)
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.verify.ts'))
  .filter((name) => only.length === 0 || only.some((part) => name.includes(part)))
  .sort()

let failed = 0
for (const file of files) {
  const result = spawnSync(
    process.execPath,
    [
      join('node_modules', 'ts-node', 'dist', 'bin.js'),
      '-r',
      'tsconfig-paths/register',
      '--project',
      join(dir, 'tsconfig.json'),
      join(dir, file),
    ],
    { stdio: 'inherit', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' } }
  )
  if (result.status !== 0) {
    failed += 1
    console.error(`✗ ${file}`)
  }
}

console.log(`\n${files.length - failed} / ${files.length} verify scripts passed`)
process.exit(failed ? 1 : 0)
