"use client"

import { useCallback, useSyncExternalStore } from "react"

// A yes/no remembered in this browser (localStorage), shared live by every
// component that reads the same key. For conveniences only: storage that
// throws (private mode, blocked site data) just means the default.

const CHANGE_EVENT = "latentry-local-flag"

function read(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === "1"
  } catch {
    return fallback
  }
}

export function useLocalFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
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
    (next: boolean) => {
      try {
        localStorage.setItem(key, next ? "1" : "0")
      } catch {
        // Not remembered; lasts for this page only through the event below.
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }))
    },
    [key]
  )
  return [value, set]
}
