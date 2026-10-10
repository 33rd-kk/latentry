// Size limits shared by the server, the browser and next.config.ts, so the
// three agree on one number. Keep this file free of imports: next.config.ts
// loads it before anything else is set up.

/**
 * The largest request body Latentry accepts, in bytes. proxy.ts makes Next
 * buffer every body in memory, and Next cuts it off silently at
 * `proxyClientMaxBodySize` (10MB unless set), which broke img2img runs with a
 * detailed source as "Invalid JSON body". The worst real case is a generate
 * request: a source up to 2048px on its long side as a base64 PNG (about
 * 22MB at most), a mask of the same size (usually far smaller, being mostly
 * empty) and a small pose skeleton. This leaves room for that and still keeps
 * a bound on what one request can make the server hold.
 */
export const MAX_REQUEST_BODY_BYTES = 48 * 1024 * 1024

/**
 * The largest body for an /api route that carries no picture: settings, tags,
 * pairing, a cancel. The biggest real one is an auto-tag batch of 1000 file
 * names, well under this.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024

// The routes whose body is a picture: generate, the pose preview, tagging.
const PICTURE_ROUTES = /^\/api\/gen\/(?:tag|[^/]+\/(?:generate|pose))$/

/** The largest body the /api route at `pathname` accepts, in bytes. */
export function maxBodyBytes(pathname: string): number {
  return PICTURE_ROUTES.test(pathname) ? MAX_REQUEST_BODY_BYTES : MAX_JSON_BODY_BYTES
}
