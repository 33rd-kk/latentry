"use client"

import { useSyncExternalStore } from "react"

// The gallery's column count by window width: 2, then 3 / 4 / 5 from
// Tailwind's sm / lg / xl.
const COLUMN_BREAKPOINTS: [string, number][] = [
  ["(min-width: 1280px)", 5],
  ["(min-width: 1024px)", 4],
  ["(min-width: 640px)", 3],
]

function subscribeToColumns(onChange: () => void) {
  const queries = COLUMN_BREAKPOINTS.map(([query]) => window.matchMedia(query))
  queries.forEach((query) => query.addEventListener("change", onChange))
  return () => queries.forEach((query) => query.removeEventListener("change", onChange))
}

function currentColumns() {
  return COLUMN_BREAKPOINTS.find(([query]) => window.matchMedia(query).matches)?.[1] ?? 2
}

export function useColumnCount() {
  return useSyncExternalStore(subscribeToColumns, currentColumns, () => 2)
}
