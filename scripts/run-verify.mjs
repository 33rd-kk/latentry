// Runs every __tests__/*.verify.ts, several at a time. Each one is a plain
// script that prints its own tally and exits non-zero on a failure, so there
// is no test framework to install: ts-node and the path aliases are all it
// needs. Each script keeps to its own temp folder and port, so they can run
// side by side. Their output is held back and printed whole, in name order.
//
//   npm test -- gallery     only the scripts whose name contains "gallery"
//   VERIFY_JOBS=1 npm test  one at a time, e.g. to rule out a clash
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'

const dir = '__tests__'
const only = process.argv.slice(2)
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.verify.ts'))
  .filter((name) => only.length === 0 || only.some((part) => name.includes(part)))
  .sort()

const asked = Number.parseInt(process.env.VERIFY_JOBS ?? '', 10)
const jobs = Math.max(1, Math.min(asked > 0 ? asked : availableParallelism(), files.length))

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join('node_modules', 'ts-node', 'dist', 'bin.js'),
        '-r',
        'tsconfig-paths/register',
        '--project',
        join(dir, 'tsconfig.json'),
        join(dir, file),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' } }
    )
    // stdout and stderr in the order they came, as a terminal would show them.
    const output = []
    child.stdout.on('data', (chunk) => output.push([process.stdout, chunk]))
    child.stderr.on('data', (chunk) => output.push([process.stderr, chunk]))
    child.on('error', (error) => output.push([process.stderr, `${error.message}\n`]))
    child.on('close', (code) => resolve({ ok: code === 0, output }))
  })
}

const started = Date.now()
const results = []
let failed = 0
let printed = 0

// Print each script's output as soon as it and every one before it are done.
function flush() {
  for (; printed < files.length && results[printed]; printed++) {
    const { ok, output } = results[printed]
    for (const [stream, chunk] of output) stream.write(chunk)
    if (!ok) {
      failed += 1
      console.error(`✗ ${files[printed]}`)
    }
  }
}

// `jobs` lanes, each taking the next file when its own script ends.
let taken = 0
async function lane() {
  while (taken < files.length) {
    const index = taken++
    results[index] = await run(files[index])
    flush()
  }
}
await Promise.all(Array.from({ length: jobs }, lane))

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\n${files.length - failed} / ${files.length} verify scripts passed (${seconds} s, ${jobs} at a time)`)
// exitCode rather than exit(): a pipe may still be taking the output above.
process.exitCode = failed ? 1 : 0
