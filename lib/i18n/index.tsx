"use client"

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react"
import {
  LOCALE_STORAGE_KEY,
  detectLocale,
  isLocale,
  parseRich,
  setActiveLocale,
  translate,
  interpolate,
  localizeServerText,
  type Locale,
  type MessageKey,
  type MessageVars,
  type RichPart,
} from "./core"

export { tStatic, getActiveLocale, serverMessage, LOCALES, type Locale, type MessageKey } from "./core"

type RichTags = Record<string, (children: ReactNode) => ReactNode>

export interface Translator {
  (key: MessageKey, vars?: MessageVars): string
  /** For messages with markup: `t.rich("key", { b: (c) => <b>{c}</b> })`. */
  rich(key: MessageKey, tags: RichTags, vars?: MessageVars): ReactNode
  /** Text from the server: translated if it was written with `serverMessage`. */
  server(text: string): string
}

interface I18nValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translator
}

// The locale lives in localStorage, read through a store so every tab and
// every provider agree, and a change in one tab reaches the others.
const listeners = new Set<() => void>()

function readLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // Storage unavailable — fall through to the browser's language.
  }
  return detectLocale(typeof navigator === "undefined" ? undefined : navigator.languages)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

function writeLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage unavailable — the choice lasts until the page is reloaded.
    memoryLocale = locale
  }
  setActiveLocale(locale)
  listeners.forEach((listener) => listener())
}

let memoryLocale: Locale | null = null
const getSnapshot = () => memoryLocale ?? readLocale()
// Server-rendered markup is English; the client switches right after
// hydration.
const getServerSnapshot = (): Locale => "en"

function renderRich(parts: RichPart[], tags: RichTags): ReactNode {
  return parts.map((part, i) => {
    if (typeof part === "string") return <Fragment key={i}>{part}</Fragment>
    const render = tags[part.tag]
    const children = renderRich(part.children, tags)
    return <Fragment key={i}>{render ? render(children) : children}</Fragment>
  })
}

function makeTranslator(locale: Locale): Translator {
  const t = ((key: MessageKey, vars?: MessageVars) => translate(locale, key, vars)) as Translator
  t.rich = (key, tags, vars) => {
    // Interpolate first, so a variable may sit inside a tag.
    const message = interpolate(translate(locale, key), vars)
    return renderRich(parseRich(message), tags)
  }
  t.server = (text) => localizeServerText(locale, text)
  return t
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  setActiveLocale(locale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => writeLocale(next), [])
  const value = useMemo(() => ({ locale, setLocale, t: makeTranslator(locale) }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

const fallback: I18nValue = { locale: "en", setLocale: writeLocale, t: makeTranslator("en") }

export function useI18n(): I18nValue {
  // Outside the provider (a portal torn from the tree, a test) English still works.
  return useContext(I18nContext) ?? fallback
}

export function useT(): Translator {
  return useI18n().t
}
