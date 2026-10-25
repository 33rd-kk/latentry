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

The manual's
[What Latentry protects against](https://33rd-kk.github.io/latentry/guide/threat-model/)
goes through the same ground by who could try to misuse it. Latentry
conforms to the
[Local Image Generation Security Profile (LIGSP)](https://github.com/33rd-kk/local-image-gen-security)
0.1, level 2; see its
[conformance table](https://33rd-kk.github.io/latentry/reference/ligsp/).

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
- **Stopping someone else's run**: a run is stopped only by naming its id.
  A device that is not paired never gets one. Paired devices are told the
  id of an ordinary run, so a page that reloads on any of them can pick it
  up again; a secret run's id is never handed out, so only its own page can
  stop it.
- **Model files**: the engine reads weights only from `.safetensors` files,
  which cannot run code; a model folder whose weights come only in a pickle
  format (`.bin`, `.ckpt`, `.pt`) is refused.
- **Private files**: the settings file, the pairing key, the paired-device
  list and the folder-name key are written with mode 600; on Windows, where
  that mode does nothing, each gets an access list with only the current
  user and SYSTEM.
- **Settings from the network**: by default only this machine may change
  settings (which decide the folders read and written, and where prompts
  are sent). This goes by the address the connection really comes from, not
  only by headers. An owner device may too: a device paired with an owner
  code, which only a request from this machine can make (`npm run
  owner-code`, run in a terminal there), so an owner device cannot make
  another owner. `SETTINGS_EDIT` changes the default; see the README. With
  `SETTINGS_EDIT=lan`, anyone on the LAN can point a backend at their own
  server and receive the prompts and pictures sent to it from then on.
- **Network folders**: the Settings page refuses `\\server\share` folders
  unless `LATENTRY_ALLOW_UNC=1`, since checking one makes Windows sign in to
  that server as you. Folders set in `.env.local` are not affected.
- **Gallery files**: only pictures directly inside a configured folder are
  served, tagged or opened. A link leading out of the folder, or to a file
  that is not a picture, is refused, and files are read through the handle
  that was checked.
- **Backend tokens** are only sent to the server they were set up for (same
  scheme, host and port), whoever edits the settings. Latentry does not
  follow a backend's redirects, so prompts, pictures and tokens go only to
  the address in Settings. A backend reached over plain `http://` on another
  machine sends its prompts, pictures and token unencrypted.
- **Request size and load**: requests that carry no picture are capped at
  1 MB, the others at 48 MB; tagging and pose previews run at most two at a
  time.
- **Pages** are sent with `Cache-Control: no-store`, a Content-Security-Policy
  that forbids framing and plugins, and a Permissions-Policy that turns off
  the camera, microphone and location.
- **The engine** listens on 127.0.0.1 with a random token only Latentry
  holds, and answers only requests addressed to a loopback name, so a web
  page that re-resolves its hostname to this machine cannot drive it. Run by
  hand, it refuses to listen beyond loopback without `LATENTRY_ENGINE_TOKEN`.
- **Releases** come with their source as `.tar.gz` and `.zip`, made by a
  workflow from the release's commit (`.github/workflows/release.yml`),
  with `SHA256SUMS` and a build provenance attestation for each file
  (`gh attestation verify <file> --repo 33rd-kk/latentry --source-ref refs/tags/vX.Y.Z`;
  0.8.0's files were added later from `main`, so check those without `--source-ref`).
- **Downloads** are pinned. The engine install uses a fixed uv release,
  checked against its SHA-256 before it runs. Models and taggers from the
  Setup page come from a fixed commit of their repository, and each file is
  checked against its SHA-256 before it is kept. So are the pose models
  fetched on first use: the engine's SDXL ControlNet and Anima pose adapter,
  and poseorbit's pose detectors. So are the engine's Python packages: each
  machine and PyTorch build has a lock in `engine/locks/` (every package at
  one version, with the SHA-256 of each file), installed with
  `uv pip sync --require-hashes`, so a file that does not match is never
  installed and nothing outside the lock stays in the environment.
  - Pinned also means security fixes arrive only with a new lock (a
    Latentry update; one is proposed every month, and the weekly audit
    checks the locks). Setup says when the lock is over six months old.
  - Where Latentry has no lock (another machine, macOS before 14, a GPU
    newer than the locked PyTorch knows, or a pinned file its index no
    longer offers), the engine is installed unpinned, as before, and the
    log and Setup say so. `LATENTRY_ENGINE_PACKAGES=latest` does the same
    by choice, for when Latentry is not updated and a pinned package has a
    known vulnerability. A file whose hash does not match never falls back:
    the install stops.
  - PyTorch no longer publishes current releases for CUDA 11.8 and 12.8;
    machines that need those builds (older NVIDIA drivers) get an older
    PyTorch with known vulnerabilities, and Setup asks for a driver update.
- **Secret mode** is a privacy aid for this browser, not a security
  boundary: it keeps typed text out of browser storage, gallery pictures out
  of the browser cache, and secret runs from other pages. By design, saved
  pictures still carry their prompt, and the gallery shows them, prompt
  included, to anyone who can reach Latentry.

What is out of scope: anyone already on this machine, a paired device, and
exposing Latentry to the internet. To do that, put an authenticating reverse
proxy on this machine in front of it that overwrites `X-Forwarded-For`.

Dependencies are watched by Dependabot and audited weekly (`npm audit` of
what ships, pip-audit); the engine's Python packages are pinned in
`engine/locks/` and refreshed once a month by a workflow, not by Dependabot.
The code is scanned by CodeQL. `npm ci` may still
report advisories in development tools (the lint config and the shadcn CLI
that the stylesheet imports from) that have no fixed release yet; none of
them runs inside Latentry.
