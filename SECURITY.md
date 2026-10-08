# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/33rd-kk/latentry/security/advisories/new)**
(the Security tab, "Report a vulnerability"). Do not open a public issue.

Say what is affected, how to reproduce it, and what an attacker could do.
You will get an answer within a week; a fix and an advisory follow when the
report is confirmed, crediting you unless you would rather not be.

Only the latest release gets fixes.

## What Latentry protects, and what it does not

Latentry is meant for your own machine or a LAN you trust. It has no
accounts or passwords. This machine can always use it; any other device must
be paired first, and once paired it can generate images, read the configured
gallery folders and drive the GPU.

What it does guard against:

- **The network**: it listens on 127.0.0.1 unless `LATENTRY_HOST` opens it
  to the LAN.
- **Devices that are not paired**: every request that does not come from
  this machine needs a device cookie, which a device gets by typing a code
  shown on this machine's Settings page (8 characters, one use, 10 minutes,
  10 tries, 5 tries a minute per device). The cookie is HMAC-signed,
  HttpOnly, SameSite=Strict and good for 30 days, and verifies only while
  its device is on the list of paired devices kept next to the settings
  file (its name, when it was paired and when that ends; nothing about its
  use). That list is encrypted (AES-256-GCM) with a key derived from the
  signing key, so it does not show device names on its own, in a backup for
  example; whoever can read the whole folder can read it. **Remove** unpairs
  one device; **Forget all devices** replaces the signing key and empties
  the list, which unpairs them all. The key can instead come from the
  system keychain at launch (`LATENTRY_PAIRING_KEY`; see the network
  guide), so it is not on disk. Over plain `http://` the
  cookie travels unencrypted, so someone who can watch your LAN traffic could
  copy it. `LATENTRY_PAIRING=off` turns pairing off, for a reverse proxy on
  this machine that does its own login.
- **Other websites** (CSRF): `/api` only answers same-origin requests.
- **DNS rebinding**: `/api` only answers for `localhost`, private-network
  addresses and hosts listed in `ALLOWED_HOSTS`.
- **Floods**: per-IP request budgets, counted by the address the connection
  comes from; `X-Forwarded-For` is believed only from this machine (a
  reverse proxy here).
- **Stopping someone else's run**: a run is stopped only by naming its id,
  which only the page watching it has (and a secret run's id is never
  handed out).
- **Settings from the network**: by default only this machine may change
  settings (which decide the folders read and written, and where prompts
  are sent). This goes by the address the connection really comes from, not
  only by headers. `SETTINGS_EDIT` changes that; see the README. With
  `SETTINGS_EDIT=lan`, anyone on the LAN can point a backend at their own
  server and receive the prompts and pictures sent to it from then on.
- **Backend tokens** are only sent to the server they were set up for (same
  scheme, host and port), whoever edits the settings. A backend reached over
  plain `http://` on another machine sends its prompts, pictures and token
  unencrypted.
- **The engine** listens on 127.0.0.1 with a random token only Latentry
  holds, and answers only requests addressed to a loopback name, so a web
  page that re-resolves its hostname to this machine cannot drive it. Run by
  hand, it refuses to listen beyond loopback without `LATENTRY_ENGINE_TOKEN`.
- **Secret mode** is a privacy aid for this browser, not a security
  boundary: it keeps typed text out of browser storage, gallery pictures out
  of the browser cache, and secret runs from other pages. By design, saved
  pictures still carry their prompt, and the gallery shows them, prompt
  included, to anyone who can reach Latentry.

What is out of scope: anyone already on this machine, a paired device, and
exposing Latentry to the internet. To do that, put an authenticating reverse
proxy on this machine in front of it that overwrites `X-Forwarded-For`.

Dependencies are watched by Dependabot and audited weekly (`npm audit` of
what ships, pip-audit); the code is scanned by CodeQL. `npm ci` may still
report advisories in development tools (the lint config and the shadcn CLI
that the stylesheet imports from) that have no fixed release yet; none of
them runs inside Latentry.
