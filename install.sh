#!/usr/bin/env sh
# Latentry on Linux and macOS: installs the web UI, then opens its setup page,
# which installs the generation engine for your GPU and downloads a model.
#
#   ./install.sh
#
# Needs Node.js 22.12 or newer (https://nodejs.org). Afterwards, start
# Latentry again with: npm start
# It listens on this computer only; set LATENTRY_HOST=0.0.0.0 in .env.local
# to use it from other devices on your network.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install 22.12 or newer from https://nodejs.org, then run this again." >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  echo "Node.js $(node --version) is too old; Latentry needs 22.12 or newer." >&2
  exit 1
fi

node scripts/logo.mjs

echo "== Installing the web UI"
npm ci
[ -f .env.local ] || cp .env.example .env.local

echo "== Building"
npm run build

echo "== Starting on http://localhost:$PORT (setup opens in your browser)"
(
  url="http://localhost:$PORT/setup"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"; elif command -v open >/dev/null 2>&1; then open "$url"; fi
      exit 0
    fi
    sleep 1
  done
) &
LATENTRY_NO_LOGO=1 exec npm start -- -p "$PORT"
