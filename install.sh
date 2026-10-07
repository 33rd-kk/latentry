#!/usr/bin/env sh
# Latentry on Linux and macOS: installs and starts the web UI. Its setup page
# (http://localhost:3000/setup) then installs the generation engine for your
# GPU and downloads a model.
#
#   ./install.sh
#
# Needs Node.js 22.19 or newer (https://nodejs.org). Afterwards, start
# Latentry again with: npm start
# It listens on this computer only; set LATENTRY_HOST=0.0.0.0 in .env.local
# to use it from other devices on your network.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install 22.19 or newer from https://nodejs.org, then run this again." >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=19)?0:1)'; then
  echo "Node.js $(node --version) is too old; Latentry needs 22.19 or newer." >&2
  exit 1
fi

node scripts/logo.mjs

echo "== Installing the web UI"
npm ci
[ -f .env.local ] || cp .env.example .env.local

echo "== Building"
npm run build

echo "== Starting"
echo
echo "   When it says Ready, open http://localhost:$PORT/setup in your browser."
echo "   (Ctrl+C stops Latentry; start it again later with: npm start)"
echo
LATENTRY_NO_LOGO=1 exec npm start -- -p "$PORT"
