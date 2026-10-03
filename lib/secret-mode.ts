/**
 * Secret mode: while it is on, nothing the user *types* is written to storage,
 * and the gallery blurs thumbnails and hides prompts.
 *
 * The flag itself is a normal persisted preference (so the mode survives a
 * reload — turning it off has to be deliberate); what it suppresses are the
 * generate form and the saved characters (see lib/storage.ts). Those values
 * still live in React state for the session, they just never reach
 * localStorage.
 *
 * Read directly rather than through lib/storage.ts: the setters there call
 * isSecretMode(), so importing back the other way would be a cycle.
 */
export const SECRET_MODE_STORAGE_KEY = 'latentry:secret-mode'

export function isSecretMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(SECRET_MODE_STORAGE_KEY) === 'true'
  } catch {
    // Private browsing / storage disabled — nothing is being persisted anyway.
    return false
  }
}
