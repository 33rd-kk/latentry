import { networkInterfaces } from "node:os"
import type { NextConfig } from "next"
import { MAX_REQUEST_BODY_BYTES } from "./lib/limits"

/**
 * Under `next dev`, Next.js serves its scripts only to pages opened as
 * localhost; a phone opening http://192.168.x.x:3000 would get the page but
 * no JavaScript, so nothing on it works. Allow this machine's own
 * private-network addresses (the ones /api already answers on, see
 * lib/security/route-guard.ts) and any ALLOWED_HOSTS. `next start` does not
 * need this.
 */
function devOrigins(): string[] {
  const own = Object.values(networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => address!.address)
    .filter((ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip))
  const extra = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set([...own, ...extra])]
}

const nextConfig: NextConfig = {
  // LATENTRY_DIST_DIR builds somewhere other than .next, so a second build
  // (to try a change) cannot pull the files out from under a running
  // `next start`.
  ...(process.env.LATENTRY_DIST_DIR ? { distDir: process.env.LATENTRY_DIST_DIR } : {}),
  allowedDevOrigins: devOrigins(),
  // Nothing uses next/image: turn its /_next/image endpoint off (it answers
  // 404) rather than leave a fetch-and-resize service running.
  images: { unoptimized: true },
  experimental: {
    // proxy.ts makes Next buffer each body, cut off at this size; the
    // default 10MB is smaller than a detailed img2img request.
    proxyClientMaxBodySize: MAX_REQUEST_BODY_BYTES,
  },
}

export default nextConfig
