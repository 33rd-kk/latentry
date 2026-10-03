/**
 * Locale-independent i18n plumbing: the message lookup, `{name}` interpolation
 * and `<tag>…</tag>` markup, and the locale the non-React code (hooks'
 * toasts, lib/ error messages) reads when it has no hook to ask.
 *
 * English (locales/en.json) is the source catalog. Every other catalog in
 * locales/ is optional and may be partial: a key it lacks shows in English.
 * See scripts/i18n-translate.mjs for generating one.
 *
 * No React here, so the verify scripts can load it under ts-node.
 */
import en from "../../locales/en.json"
import { catalogs, SOURCE_LOCALE } from "../../locales"

/** A catalog's id, as its file is named: "en", "de", "pt-BR"… */
export type Locale = string

/** Every locale that has a catalog, the source first. */
export const LOCALES: readonly Locale[] = [SOURCE_LOCALE, ...Object.keys(catalogs).filter((code) => code !== SOURCE_LOCALE).sort()]

export type Messages = typeof en

/** Every dotted path to a string in the message tree, e.g. "generate.cancel". */
type Paths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>
}[keyof T & string]
export type MessageKey = Paths<Messages>

export type MessageVars = Record<string, string | number>

export const LOCALE_STORAGE_KEY = "locale"

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value)
}

/**
 * The locale a first visit gets: the first browser language with a catalog,
 * matched exactly ("pt-BR") or by its base language ("pt"), else English.
 */
export function detectLocale(languages: readonly string[] | undefined, available: readonly Locale[] = LOCALES): Locale {
  const lower = available.map((code) => code.toLowerCase())
  for (const language of languages ?? []) {
    const wanted = language.toLowerCase()
    const exact = lower.indexOf(wanted)
    if (exact !== -1) return available[exact]
    const base = lower.indexOf(wanted.split("-")[0])
    if (base !== -1) return available[base]
  }
  return SOURCE_LOCALE
}

function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === "string" ? node : undefined
}

/** `{name}` in the message is replaced by `vars.name`; unknown names are left as written. */
export function interpolate(message: string, vars?: MessageVars): string {
  if (!vars) return message
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  // English is the fallback; the key itself shows only if both are missing.
  const message = lookup(catalogs[locale], key) ?? lookup(en, key) ?? key
  return interpolate(message, vars)
}

// Server code has no locale to ask, so where its text reaches the page it
// writes a key instead, and the page translates it.
const SERVER_MESSAGE_PREFIX = "i18n:"

export function serverMessage(key: MessageKey, vars?: MessageVars): string {
  return SERVER_MESSAGE_PREFIX + key + (vars ? "|" + JSON.stringify(vars) : "")
}

/** Translates text written by `serverMessage`; anything else passes through. */
export function localizeServerText(locale: Locale, text: string): string {
  if (!text.startsWith(SERVER_MESSAGE_PREFIX)) return text
  const body = text.slice(SERVER_MESSAGE_PREFIX.length)
  const bar = body.indexOf("|")
  const key = (bar === -1 ? body : body.slice(0, bar)) as MessageKey
  let vars: MessageVars | undefined
  if (bar !== -1) {
    try {
      vars = JSON.parse(body.slice(bar + 1))
    } catch {
      vars = undefined
    }
  }
  return translate(locale, key, vars)
}

export type RichPart = string | { tag: string; children: RichPart[] }

/** Splits `a <b>bold</b> c` into text and tagged parts; tags may nest. */
export function parseRich(message: string): RichPart[] {
  const root: RichPart[] = []
  const stack: { tag: string; children: RichPart[] }[] = []
  const pattern = /<(\/?)(\w+)>/g
  let last = 0
  let match: RegExpExecArray | null
  const current = () => (stack.length ? stack[stack.length - 1].children : root)
  while ((match = pattern.exec(message))) {
    if (match.index > last) current().push(message.slice(last, match.index))
    const [, closing, tag] = match
    if (closing) {
      const open = stack.pop()
      if (open) current().push(open)
    } else {
      stack.push({ tag, children: [] })
    }
    last = pattern.lastIndex
  }
  if (last < message.length) current().push(message.slice(last))
  // An unclosed tag keeps its text.
  while (stack.length) {
    const open = stack.pop()!
    current().push(...open.children)
  }
  return root
}

// The locale the provider last settled on, for code outside React.
let activeLocale: Locale = "en"

export function setActiveLocale(locale: Locale) {
  activeLocale = locale
}

export function getActiveLocale(): Locale {
  return activeLocale
}

/** For code that has no hook to ask: toasts from plain functions, lib/ error text. */
export function tStatic(key: MessageKey, vars?: MessageVars): string {
  return translate(activeLocale, key, vars)
}
