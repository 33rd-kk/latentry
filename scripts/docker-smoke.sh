#!/usr/bin/env bash
# The Docker image, checked as docs/install/docker.md says it behaves: every
# browser must pair, 127.0.0.1 inside the container is trusted no more than
# anyone, a code from `npm run owner-code` makes an owner who may change the
# settings, and the image holds none of a working copy's personal files.
#
#   scripts/docker-smoke.sh       (CI's docker job; needs Docker Compose)
#
# It builds and starts compose.yaml's service and removes it, with its data
# volume, when done.

set -euo pipefail

compose() { docker compose -p latentry-smoke "$@"; }
failed=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failed=1; fi; }
cleanup() {
  if [ "$failed" -ne 0 ]; then compose logs --no-color latentry | tail -50 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose up -d --build --wait --wait-timeout 180

base=http://127.0.0.1:3000
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# From the host, as a browser would come.
check 'an unpaired browser gets no API' '[ "$(status "$base/api/gen/backends")" = 401 ]'
check 'and is sent to the pairing page' '[ "$(status "$base/gallery")" = 307 ]'
check 'the pairing page itself is served' '[ "$(status "$base/pair")" = 200 ]'

# Inside the container, from 127.0.0.1 with a localhost Host.
inside() { compose exec -T latentry node -e "fetch('http://127.0.0.1:3000$1').then((r) => console.log(r.status))"; }
check '127.0.0.1 inside the container is not this computer' 'grep -qE "^40[13]$" <<<"$(inside /api/settings)"'

# The owner code, from a terminal in the container.
code=$(compose exec -T latentry npm run --silent owner-code | sed -n 's/^Owner code: \([A-Z0-9]\{4\}\)-\([A-Z0-9]\{4\}\)$/\1\2/p')
check 'owner-code prints a code' '[ -n "$code" ]'
jar=$(mktemp)
check 'the code pairs this browser' '[ "$(status -c "$jar" -H "Content-Type: application/json" -d "{\"code\":\"$code\"}" "$base/api/pair")" = 200 ]'
check 'the owner may change the settings' 'curl -s -b "$jar" "$base/api/settings" | grep -q "\"editable\":true"'
check 'the code works only once' '[ "$(status -H "Content-Type: application/json" -d "{\"code\":\"$code\"}" "$base/api/pair")" = 403 ]'
rm -f "$jar"

# What the image holds. (MSYS_NO_PATHCONV: Git Bash on Windows would
# rewrite the container paths.)
image() { MSYS_NO_PATHCONV=1 docker run --rm --entrypoint "$@"; }
files=$(image sh latentry:local -c 'cd /app && find . -path ./node_modules -prune -o -print')
check 'no .env file' '! grep -qE "/\.env" <<<"$files"'
check 'no settings file, pairing key or folder-name key' '! grep -qE "latentry\.(settings\.json|pairing-|folder-names-key)" <<<"$files"'
check 'no pictures, notes, audits, tests or docs' '! grep -qE "^\./(output|notes|audit|__tests__|e2e|docs|coverage|\.git)(/|$)" <<<"$files"'
check 'models points into the data volume' '[ "$(image readlink latentry:local /app/models)" = /data/models ]'
check 'it runs as an ordinary user' '[ "$(image id latentry:local -u)" != 0 ]'
check 'which cannot change the app' '! image sh latentry:local -c "touch /app/package.json" 2>/dev/null'

exit "$failed"
