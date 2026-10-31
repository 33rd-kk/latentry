// The mark proxy.ts puts on the 401 it answers an unpaired device's API
// request with, so the page can tell "this device is not paired (any more)"
// from any other 401, such as a backend's login (lib/backends/hints.ts).
// Kept apart from lib/security/pairing.ts, which needs Node's crypto, so the
// browser can import it (components/unpaired-guard.tsx).

export const UNPAIRED_HEADER = 'x-latentry-unpaired'
