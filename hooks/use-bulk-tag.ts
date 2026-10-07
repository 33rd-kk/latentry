"use client"

import { useCallback, useRef, useState } from "react"
import type { ImageTag } from "@/lib/image-meta"

export interface BulkTagProgress {
  total: number
  done: number
  tagged: number
  skipped: number
  failed: number
  /** The last few failures, for saying why. */
  errors: { name: string; error: string }[]
}

type Line =
  | { name: string; status: "tagged"; tags: ImageTag[] }
  | { name: string; status: "skipped" }
  | { name: string; status: "failed"; error: string }
  | { done: true; tagged: number; skipped: number; failed: number; cancelled?: boolean }

/**
 * Runs /api/gallery/<dir>/autotag over a selection and reports each picture
 * as the server finishes it. `onTagged` lets the grid show the new tags
 * without reloading the folder.
 */
export function useBulkTag(onTagged: (name: string, tags: ImageTag[]) => void) {
  const [progress, setProgress] = useState<BulkTagProgress | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(
    async (dir: number, names: string[], skipTagged: boolean): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> => {
      const controller = new AbortController()
      abortRef.current = controller
      setRunning(true)
      setProgress({ total: names.length, done: 0, tagged: 0, skipped: 0, failed: 0, errors: [] })
      try {
        const response = await fetch(`/api/gallery/${dir}/autotag`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names, skipTagged }),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => null)
          return { ok: false, error: typeof data?.error === "string" ? data.error : String(response.status) }
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let finished = false
        while (!finished) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline: number
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (!raw) continue
            const line = JSON.parse(raw) as Line
            if ("done" in line) {
              finished = true
              break
            }
            if (line.status === "tagged") onTagged(line.name, line.tags)
            setProgress((current) =>
              current
                ? {
                    ...current,
                    done: current.done + 1,
                    tagged: current.tagged + (line.status === "tagged" ? 1 : 0),
                    skipped: current.skipped + (line.status === "skipped" ? 1 : 0),
                    failed: current.failed + (line.status === "failed" ? 1 : 0),
                    errors: line.status === "failed" ? [...current.errors, { name: line.name, error: line.error }].slice(-3) : current.errors,
                  }
                : current
            )
          }
        }
        return { ok: true }
      } catch (error) {
        if (controller.signal.aborted) return { ok: true, cancelled: true }
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        abortRef.current = null
        setRunning(false)
      }
    },
    [onTagged]
  )

  const cancel = useCallback(() => abortRef.current?.abort(), [])
  const reset = useCallback(() => setProgress(null), [])

  return { start, cancel, reset, running, progress }
}
