"use client"

import { useCallback, useSyncExternalStore } from "react"
import { isSecretMode } from "@/lib/secret-mode"

// A short text remembered in this browser (localStorage), shared live by every
// component that reads the same key: which part of a page is shown. For
// conveniences only: storage that throws (private mode, blocked site data)
// just means the default. In secret mode nothing is written; the choice then
// lasts for this page only.

const CHANGE_EVENT = "latentry-local-text"
// What this page chose while it could not, or would not, write.
const memory = new Map<string, string>()

function read(key: string, fallback: string): string {
  if (memory.has(key)) return memory.get(key)!
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function useLocalText(key: string, fallback: string): [string, (value: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const onChange = (event: Event) => {
        if ((event as CustomEvent).detail === key) listener()
      }
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) listener()
      }
      window.addEventListener(CHANGE_EVENT, onChange)
      window.addEventListener("storage", onStorage)
      return () => {
        window.removeEventListener(CHANGE_EVENT, onChange)
        window.removeEventListener("storage", onStorage)
      }
    },
    [key]
  )
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback
  )
  const set = useCallback(
    (next: string) => {
      memory.delete(key)
      try {
        if (isSecretMode()) memory.set(key, next)
        else localStorage.setItem(key, next)
      } catch {
        memory.set(key, next)
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }))
    },
    [key]
  )
  return [value, set]
}
