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

Latentry is meant for your own machine or a LAN you trust. It has **no
login**: whoever can reach it can generate images, read the configured
gallery folders and drive the GPU.

What it does guard against:

- **Other websites** (CSRF): `/api` only answers same-origin requests.
- **DNS rebinding**: `/api` only answers for `localhost`, private-network
  addresses and hosts listed in `ALLOWED_HOSTS`.
- **Floods**: per-IP request budgets.
- **Settings from the network**: by default only this machine may change
  settings (which decide the folders read and written). `SETTINGS_EDIT`
  changes that; see the README.
- **The engine** listens on 127.0.0.1 with a random token only Latentry
  holds.

What is out of scope: anyone already on your LAN or machine, and exposing
Latentry to the internet. To do that, put an authenticating reverse proxy in
front that overwrites `X-Forwarded-For`.

Dependencies are watched by Dependabot and audited weekly (`npm audit` of
what ships, pip-audit); the code is scanned by CodeQL. `npm ci` may still
report advisories in development tools (the lint config and the shadcn CLI
that the stylesheet imports from) that have no fixed release yet; none of
them runs inside Latentry.
