import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // LATENTRY_DIST_DIR builds somewhere other than .next, so a second build
  // (to try a change) cannot pull the files out from under a running
  // `next start`.
  ...(process.env.LATENTRY_DIST_DIR ? { distDir: process.env.LATENTRY_DIST_DIR } : {}),
}

export default nextConfig
