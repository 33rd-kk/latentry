// Runs once when the server starts: brings up Latentry's own engine if it is
// installed (see lib/engine). LATENTRY_ENGINE=off, or turning auto-start off
// on the setup page, leaves it to be started by hand.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { autoStart } = await import('./lib/engine/supervisor')
  await autoStart()
}
