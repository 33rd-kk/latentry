#!/usr/bin/env sh
# Latentry on Linux and macOS: installs and starts the web UI. Its setup page
# (http://localhost:3000/setup) then installs the generation engine for your
# GPU and downloads a model.
#
#   ./install.sh
#   ./install.sh --no-engine   # only use servers you already run (A1111, Forge, ...)
#
# Needs Node.js 22.19 or newer (https://nodejs.org). Afterwards, start
# Latentry again with: npm start
# It listens on this computer only; set LATENTRY_HOST=0.0.0.0 in .env.local
# to use it from other devices on your network.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
NO_ENGINE=
for arg in "$@"; do
  case "$arg" in
    --no-engine) NO_ENGINE=1 ;;
    *) echo "Unknown option: $arg (usage: ./install.sh [--no-engine])" >&2; exit 1 ;;
  esac
done

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
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  if [ -n "$NO_ENGINE" ]; then
    printf '
# Set by install.sh --no-engine
LATENTRY_ENGINE=off
' >> .env.local
  fi
fi

echo "== Building"
npm run build

echo "== Starting"
echo
if [ -n "$NO_ENGINE" ]; then
  echo "   When it says Ready, open http://localhost:$PORT/settings in your browser"
  echo "   and add your server under Backends."
else
  echo "   When it says Ready, open http://localhost:$PORT/setup in your browser."
fi
echo "   (Ctrl+C stops Latentry; start it again later with: npm start)"
echo
LATENTRY_NO_LOGO=1 exec npm start -- -p "$PORT"
