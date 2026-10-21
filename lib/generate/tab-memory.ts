"use client"

import { useCallback, useRef, useState } from "react"
import { isSecretMode, SECRET_MODE_STORAGE_KEY } from "@/lib/secret-mode"
import { STORAGE_EVENT_NAME } from "@/lib/storage"

// State that outlives the Generate page within one browser tab: going to the
// gallery and back keeps the runs this page queued and the pictures it moved
// below, so neither is lost (nor a queued run left with no way to cancel it).
// It is the tab's memory only: nothing is written to browser storage, and a
// reload or a closed tab clears it. In secret mode nothing is kept beyond the
// page, as a secret run belongs to the page that started it.
const memory = new Map<string, unknown>()

// Turning secret mode on, in this tab or another, forgets what was kept.
if (typeof window !== "undefined") {
  const forgetIfSecret = () => {
    if (isSecretMode()) memory.clear()
  }
  window.addEventListener(STORAGE_EVENT_NAME, (event) => {
    if ((event as CustomEvent).detail?.key === SECRET_MODE_STORAGE_KEY) forgetIfSecret()
  })
  window.addEventListener("storage", (event) => {
    if (event.key === SECRET_MODE_STORAGE_KEY) forgetIfSecret()
  })
}

type Update<T> = T | ((previous: T) => T)

/** Like useState, but kept for the tab under `key` while secret mode is off. */
export function useTabMemory<T>(key: string, initial: () => T): [T, (next: Update<T>) => void] {
  const [value, setValue] = useState<T>(() =>
    typeof window !== "undefined" && !isSecretMode() && memory.has(key) ? (memory.get(key) as T) : initial()
  )
  // The latest value, so a write from a page that is going away still lands.
  const valueRef = useRef(value)
  const set = useCallback(
    (next: Update<T>) => {
      const updated = typeof next === "function" ? (next as (previous: T) => T)(valueRef.current) : next
      valueRef.current = updated
      if (isSecretMode()) memory.delete(key)
      else memory.set(key, updated)
      setValue(updated)
    },
    [key]
  )
  return [value, set]
}
