// `npm run owner-code`: a one-time code that makes the browser it is typed
// into an owner device, which may change settings and Setup and pair other
// devices, as this computer may (see lib/security/pairing.ts).
//
//   npm run owner-code                       Latentry on port 3000 (or $PORT)
//   npm run owner-code -- --port 3001
//   docker compose exec latentry npm run owner-code
//
// It asks the running Latentry over 127.0.0.1, so only a terminal on the
// computer (or in the container) running it can make one: being able to run
// a command there is what makes an owner. The code is printed once, here
// only; Latentry writes it to no log. It works once, for 10 minutes.

import http from 'node:http'

function port() {
  const args = process.argv.slice(2)
  const at = args.findIndex((arg) => arg === '--port' || arg === '-p')
  const value = at === -1 ? process.env.PORT : args[at + 1]
  const number = Number(value || 3000)
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    console.error(`Not a port: ${value}`)
    process.exit(2)
  }
  return number
}

/** POSTs to the running Latentry on this computer; resolves with its status and JSON. */
function post(target, body) {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: target,
        path: '/api/settings/pairing',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10_000,
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (text += chunk))
        response.on('end', () => {
          let json = null
          try {
            json = JSON.parse(text)
          } catch {
            // Not JSON: reported below by status.
          }
          resolve({ status: response.statusCode ?? 0, json })
        })
      }
    )
    request.on('timeout', () => request.destroy(new Error('no answer')))
    request.on('error', reject)
    request.end(data)
  })
}

const target = port()
let answer
try {
  answer = await post(target, { action: 'owner-code' })
} catch (error) {
  console.error(`Latentry does not answer on 127.0.0.1:${target} (${error.message}). Start it first, or pass --port.`)
  process.exit(1)
}
const code = answer.json?.code
if (answer.status !== 200 || typeof code?.code !== 'string') {
  console.error(`Latentry refused: ${answer.json?.error ?? `HTTP ${answer.status}`}`)
  process.exit(1)
}

const shown = `${code.code.slice(0, 4)}-${code.code.slice(4)}`
const until = new Date(code.expiresAt).toLocaleTimeString()
console.log(`
Owner code: ${shown}

Open Latentry in your browser and enter this code on its pairing page.
That browser becomes an owner device: it may change settings and Setup,
and pair your other devices. The code works once, until ${until}.
`)
