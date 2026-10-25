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
// only; Latentry writes it to no log. It works once, for 10 minutes, and the
// owner device stays one for 7 days.

import { latentryPort, pairingAction } from './local-api.mjs'

const { code } = await pairingAction(latentryPort(), { action: 'owner-code' })
if (typeof code?.code !== 'string') {
  console.error('Latentry did not send a code.')
  process.exit(1)
}

const shown = `${code.code.slice(0, 4)}-${code.code.slice(4)}`
const until = new Date(code.expiresAt).toLocaleTimeString()
console.log(`
Owner code: ${shown}

Open Latentry in your browser and enter this code on its pairing page.
That browser becomes an owner device for 7 days: it may change settings
and Setup, and pair your other devices. The code works once, until ${until}.
`)
