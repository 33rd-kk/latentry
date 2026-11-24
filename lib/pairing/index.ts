// SPDX-License-Identifier: MIT
//
// lib/pairing: let devices on a LAN into a self-hosted app without accounts
// or a database. A short code shown on the host is typed on the device, which
// then carries a signed cookie; the host keeps a small sealed list of who is
// paired. Kept free of the app (see README.md) so it can become its own package.

export { CODE_ALPHABET, CODE_DEFAULTS, createCodeBook, normalizeCode, type CodeBook, type CodeOptions, type IssuedCode } from './codes'
export {
  cleanName,
  createPairing,
  MAX_NAME_LENGTH,
  readCookie,
  type IssuedDevice,
  type PairedDevice,
  type Pairing,
  type PairingOptions,
} from './devices'
export { restrictExistingToOwner, restrictToOwner } from './owner-only'
