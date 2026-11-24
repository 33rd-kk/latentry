# pairing

Lets devices on a LAN into a self-hosted app without accounts or a
database. The host shows a short code; the device that wants in types it,
and from then on carries a signed cookie. The host keeps a small sealed
list of who is paired, and can unpair one device or all of them. It is part
of Latentry for now, kept separate so it can become its own package.

- **Codes** (`createCodeBook`): 8 characters from an alphabet without
  0/O and 1/I/L, good for 10 minutes and one use, 100 wrong tries in all.
  An owner code (12 characters) is kept apart: which one a typed code is
  tried against is told by its length, and the owner code has no count of
  tries to use up, so nobody on the network can spend it. Codes live only
  in the process's memory.
- **Cookie**: `v1.<device id>.<expires at>.<HMAC-SHA256>` (`o1` for an
  owner). It holds nothing secret and verifies only while its device is on
  the list, so removing one device unpairs that device alone.
- **List** (`createPairing`): id, the name the device gave itself, a number
  in pairing order, when it was paired and when that ends, and whether it is
  an owner. Nothing about its use. Sealed with AES-256-GCM under a key
  derived from the signing key, so the file alone shows no names.
- **Key**: 32 random bytes in a file written with mode 0o600, and made
  owner-only on Windows too (`restrictToOwner`, through `icacls`), or handed
  in from a keychain so it is never on disk. A new key forgets every device.
- **No dependencies**: only node's built-ins (`node:crypto`, `node:fs`,
  `node:path`, `node:child_process` for `icacls` and `whoami` on Windows,
  run without a shell).

```ts
import { createCodeBook, createPairing, readCookie } from './lib/pairing'

const codes = createCodeBook()
const pairing = createPairing({ keyFile: 'data/pairing-key', devicesFile: 'data/pairing-devices.json' })

// On the host, for its owner to read out:
const { code } = codes.create()
// When a device sends that code:
if (codes.redeem(typed) === 'device') {
  const { value, maxAgeSeconds } = pairing.issue(Date.now(), 'My phone')
  // Set-Cookie: device=<value>; HttpOnly; SameSite=Strict; Max-Age=<maxAgeSeconds>
}
// On every request from another device:
const device = pairing.device(readCookie(request.headers.get('cookie'), 'device'))
```

## What it does not do

- **Tell where a request comes from.** Whether a request is from the host
  itself, which needs no cookie, is the app's to decide, and so is what an
  owner may do. Latentry does it in `lib/settings/access.ts`.
- **Limit tries per address.** 100 wrong tries in all end an ordinary code,
  but the rate per address (Latentry allows 5 a minute) is the app's.
- **Set the cookie.** The app sets it, HttpOnly and SameSite=Strict, and
  never puts a code in a URL or a log.
- **Protect against whoever can read the key file.** They can read the list
  and sign cookies. That is what the folder's permissions are for.

## Rules for this folder

- Import only `node:` built-ins and files in this folder. eslint enforces
  this (`eslint.config.mjs`).
- Every file starts with `// SPDX-License-Identifier: MIT`.
- The file and cookie formats are what paired devices carry: change them
  only with a way to read the old ones. `__tests__/pairing-core.verify.ts`
  holds files written by the first version.
