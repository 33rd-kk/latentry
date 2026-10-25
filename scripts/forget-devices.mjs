// `npm run forget-devices -- --yes`: unpairs every device, owners included,
// and replaces the pairing key, from a terminal on the computer running
// Latentry. For when an owner device may be in the wrong hands, say a copied
// cookie: no browser is needed, so it works even after someone else, as an
// owner, removed yours. Then make a new owner code (npm run owner-code).
//
//   npm run forget-devices -- --yes [--port 3001]
//   docker compose exec latentry npm run forget-devices -- --yes

import { latentryPort, pairingAction } from './local-api.mjs'

if (!process.argv.includes('--yes')) {
  console.error('This unpairs every device, owners included. Run it again with --yes to go ahead.')
  process.exit(2)
}

await pairingAction(latentryPort(), { action: 'forget' })
console.log(`
Every paired device was forgotten, and the pairing key replaced: no device
cookie works any more. To manage Latentry from your browser again, run
npm run owner-code and enter the code on the pairing page.
`)
