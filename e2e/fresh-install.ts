// A fresh install, for the first-run question: no backend and no mode chosen.
// The E2E backends are a list in the settings file (scripts/e2e.mjs), so this
// empties it and, after `run`, puts the same list back. The server is shared
// by every spec.

import { expect, type APIRequestContext } from './test'

async function put(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.put('/api/settings', { data })
  expect(response.status(), await response.text()).toBe(200)
}

export async function asFreshInstall(request: APIRequestContext, run: () => Promise<void>) {
  const view = await (await request.get('/api/settings')).json()
  // The view's backends, without the token field (none is set in these tests).
  const backends = (view.backends as Record<string, unknown>[]).map(({ token: _token, ...backend }) => backend)
  await put(request, { backends: [], mode: null })
  try {
    await run()
  } finally {
    await put(request, { backends, mode: null })
  }
}
