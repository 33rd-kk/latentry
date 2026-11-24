// SPDX-License-Identifier: MIT
//
// One-use pairing codes: shown on the machine the app runs on, typed on the
// device that wants in. Kept only in this process's memory, never written
// anywhere, and never put in a URL or a log by this module.
//
// Two kinds, kept apart: an ordinary code (8 characters by default) that
// takes a limited number of wrong tries in all, and an owner code (12 by
// default) that has no such count, so nobody on the network can use it up
// and keep the owner from pairing. Which one a typed code is tried against
// is told by its length alone, so tries at one never touch the other.

import { randomInt, timingSafeEqual } from 'node:crypto'

/** No 0/O, 1/I/L: read off one screen and typed on another. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export interface CodeOptions {
  /** Codes are kept apart per scope; an app usually needs only one. */
  scope?: string
  /** Characters in an ordinary code. Default 8. */
  length?: number
  /** Characters in an owner code; must differ from `length`. Default 12. */
  ownerLength?: number
  /** How long a code is good for, in milliseconds. Default 10 minutes. */
  ttlMs?: number
  /** Wrong tries an ordinary code takes before it is gone. Default 100. */
  tries?: number
  /** Told when an ordinary code is used up by wrong tries; never the code or who tried. */
  onUsedUp?: (tries: number) => void
}

export interface IssuedCode {
  code: string
  expiresAt: number
}

/** triesLeft is Infinity for an owner code, which only time or use ends. */
type PendingCode = IssuedCode & { triesLeft: number }
type Book = { device: PendingCode | null; owner: PendingCode | null }

// On globalThis, so every module instance in the process (a framework may
// load one per route) and a hot reload see the same codes.
const globalForCodes = globalThis as typeof globalThis & { __pairingCodeBooks?: Map<string, Book> }

export const CODE_DEFAULTS = { length: 8, ownerLength: 12, ttlMs: 10 * 60 * 1000, tries: 100 } as const

/** "abcd-efgh" as typed -> "ABCDEFGH". */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export interface CodeBook {
  /** A fresh ordinary code, replacing any earlier one. */
  create(now?: number): IssuedCode
  /** A fresh owner code, replacing any earlier one; the ordinary code is left as it is. */
  createOwner(now?: number): IssuedCode
  /** The ordinary code waiting to be used, if any. */
  current(now?: number): IssuedCode | null
  /**
   * Which code `input` is: 'owner', 'device' (the ordinary one) or null for
   * neither. A match uses that code up; a wrong try counts against the
   * ordinary code's tries, never the owner code's.
   */
  redeem(input: string, now?: number): 'owner' | 'device' | null
  /** Drops both codes. */
  forget(): void
}

export function createCodeBook(options: CodeOptions = {}): CodeBook {
  const { length, ownerLength, ttlMs, tries } = { ...CODE_DEFAULTS, ...options }
  if (length === ownerLength) throw new Error('An owner code must have another length than an ordinary one')
  const scope = options.scope ?? 'default'
  const books = (globalForCodes.__pairingCodeBooks ??= new Map())
  const book = (): Book => {
    let found = books.get(scope)
    if (!found) books.set(scope, (found = { device: null, owner: null }))
    return found
  }

  const fresh = (now: number, size: number, triesLeft: number): PendingCode => {
    let code = ''
    for (let i = 0; i < size; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
    return { code, expiresAt: now + ttlMs, triesLeft }
  }
  const shown = ({ code, expiresAt }: PendingCode): IssuedCode => ({ code, expiresAt })
  /** The code in `slot` if it has not expired; an expired one is dropped. */
  const waiting = (slot: keyof Book, now: number): PendingCode | null => {
    const current = book()[slot]
    if (current && current.expiresAt <= now) book()[slot] = null
    return book()[slot]
  }
  const matches = (code: PendingCode, input: string): boolean => {
    const sent = Buffer.from(normalizeCode(input).padEnd(code.code.length).slice(0, 64))
    const expected = Buffer.from(code.code)
    return sent.length === expected.length && timingSafeEqual(sent, expected)
  }

  return {
    create: (now = Date.now()) => shown((book().device = fresh(now, length, tries))),
    createOwner: (now = Date.now()) => shown((book().owner = fresh(now, ownerLength, Infinity))),
    current: (now = Date.now()) => {
      const current = book().device
      return current && current.expiresAt > now ? shown(current) : null
    },
    redeem: (input, now = Date.now()) => {
      const owner = normalizeCode(input).length === ownerLength
      const slot = owner ? 'owner' : 'device'
      const code = waiting(slot, now)
      if (!code) return null
      if (matches(code, input)) {
        book()[slot] = null
        return owner ? 'owner' : 'device'
      }
      if (--code.triesLeft <= 0) {
        book()[slot] = null
        options.onUsedUp?.(tries)
      }
      return null
    },
    forget: () => {
      book().device = null
      book().owner = null
    },
  }
}
