// For the scripts that act as this computer (owner-code.mjs,
// forget-devices.mjs): the running Latentry's port, and a POST to its
// pairing API over 127.0.0.1. Only a request from this machine may make an
// owner code or forget every device, so these work from a terminal here (or
// in the container) and nowhere else.

import http from 'node:http'

/** --port / -p, else $PORT, else 3000. */
export function latentryPort(args = process.argv.slice(2)) {
  const at = args.findIndex((arg) => arg === '--port' || arg === '-p')
  const value = at === -1 ? process.env.PORT : args[at + 1]
  const number = Number(value || 3000)
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    console.error(`Not a port: ${value}`)
    process.exit(2)
  }
  return number
}

/** POSTs `body` to /api/settings/pairing; resolves with the answer's JSON, or exits with a message. */
export async function pairingAction(port, body) {
  let answer
  try {
    answer = await post(port, body)
  } catch (error) {
    console.error(`Latentry does not answer on 127.0.0.1:${port} (${error.message}). Start it first, or pass --port.`)
    process.exit(1)
  }
  if (answer.status !== 200 || !answer.json) {
    console.error(`Latentry refused: ${answer.json?.error ?? `HTTP ${answer.status}`}`)
    process.exit(1)
  }
  return answer.json
}

function post(port, body) {
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
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
            // Not JSON: reported by status.
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
