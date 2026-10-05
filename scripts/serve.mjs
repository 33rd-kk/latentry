// `npm start` and `npm run dev`: Next.js, listening on this machine only
// unless told otherwise.
//
//   node scripts/serve.mjs start|dev [next's own options...]
//
// Next.js listens on every network interface by default, which on Windows
// also brings up a firewall prompt on the first run. Latentry has no login,
// so it starts on 127.0.0.1; to use it from a phone or another computer, set
//
//   LATENTRY_HOST=0.0.0.0
//
// in .env.local (read here too) or the environment, and allow Node.js through
// the firewall on private networks when asked. An explicit -H/--hostname wins.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const [mode, ...rest] = process.argv.slice(2)
if (mode !== 'start' && mode !== 'dev') {
  console.error('usage: node scripts/serve.mjs start|dev [next options]')
  process.exit(2)
}

/** LATENTRY_HOST from the environment, else from .env.local. */
function configuredHost() {
  if (process.env.LATENTRY_HOST?.trim()) return process.env.LATENTRY_HOST.trim()
  const file = path.resolve('.env.local')
  if (!existsSync(file)) return null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*LATENTRY_HOST\s*=\s*["']?([^"'#\s]+)/.exec(line)
    if (match) return match[1]
  }
  return null
}

const args = [mode, ...rest]
if (!rest.some((arg) => arg === '-H' || arg === '--hostname' || arg.startsWith('--hostname='))) {
  args.push('-H', configuredHost() ?? '127.0.0.1')
}

const next = createRequire(import.meta.url).resolve('next/dist/bin/next')
const child = spawn(process.execPath, [next, ...args], { stdio: 'inherit' })
// Ctrl+C reaches Next.js directly (same console); passing it on as well
// would, on Windows, end it abruptly instead of letting it shut down.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (process.platform !== 'win32') child.kill(signal)
  })
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
