"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import type { Translator } from "@/lib/i18n"
import { useTabMemory } from "@/lib/generate/tab-memory"

// Runs this page put in a backend's queue (see lib/diffusion/run-queue.ts).
// Only this page was told their ids, so only it lists them and may cancel
// them; they are held in this tab's memory and nowhere else (tab-memory.ts),
// so a reload forgets them here (they still run, and their pictures still
// reach the gallery). One stream at a time, on the first of them: the rest wait behind
// it, and the browser's connections are few.
export interface QueuedItem {
  id: string
  /** The start of the prompt, to tell runs apart; null in secret mode. */
  label: string | null
  /** Its place in the backend's queue, as the server last said; only kept current for the first. */
  position: number
  /** The backend is busy with a run this server did not start. */
  waiting: boolean
}

export interface RunQueue {
  items: QueuedItem[]
  add: (backend: string, item: QueuedItem) => void
  cancel: (id: string) => Promise<void>
}

/**
 * `onStarted` is told when the first waiting run starts, so the page watches
 * it as it would a run it had just started.
 */
export function useRunQueue(selectedId: string | null, onStarted: (backend: string, id: string) => void, t: Translator): RunQueue {
  // Per backend, so switching away and back still lists them.
  const [queues, setQueues] = useTabMemory<Record<string, QueuedItem[]>>("generate.queued", () => ({}))
  const sourceRef = useRef<{ id: string; source: EventSource } | null>(null)
  const onStartedRef = useRef(onStarted)
  useEffect(() => {
    onStartedRef.current = onStarted
  }, [onStarted])

  const remove = useCallback((backend: string, id: string) => {
    setQueues((previous) => ({ ...previous, [backend]: (previous[backend] ?? []).filter((item) => item.id !== id) }))
  }, [setQueues])

  const items = selectedId ? (queues[selectedId] ?? []) : []
  const head = items[0]?.id ?? null

  // Watches the selected backend's first waiting run until it starts or ends.
  useEffect(() => {
    if (!selectedId || !head) return
    const backend = selectedId
    const source = new EventSource(`/api/gen/${encodeURIComponent(backend)}/job/stream?id=${encodeURIComponent(head)}`)
    sourceRef.current = { id: head, source }
    const done = () => {
      source.close()
      if (sourceRef.current?.source === source) sourceRef.current = null
    }
    source.addEventListener("queued", (event) => {
      const { position, waiting } = JSON.parse((event as MessageEvent).data)
      setQueues((previous) => ({
        ...previous,
        [backend]: (previous[backend] ?? []).map((item) => (item.id === head ? { ...item, position, waiting } : item)),
      }))
    })
    // Started: from here it is an ordinary run, watched by the page.
    source.addEventListener("snapshot", () => {
      done()
      remove(backend, head)
      onStartedRef.current(backend, head)
    })
    source.addEventListener("end", (event) => {
      const { status, error } = JSON.parse((event as MessageEvent).data)
      done()
      remove(backend, head)
      if (status === "error") toast.error(t("generate.failed"), { description: error ? t.server(error) : t("generate.serverError") })
    })
    return () => {
      if (sourceRef.current?.source === source) {
        source.close()
        sourceRef.current = null
      }
    }
  }, [selectedId, head, remove, setQueues, t])

  const add = useCallback((backend: string, item: QueuedItem) => {
    setQueues((previous) => ({ ...previous, [backend]: [...(previous[backend] ?? []), item] }))
  }, [setQueues])

  const cancel = useCallback(
    async (id: string) => {
      const backend = selectedId
      if (!backend) return
      try {
        const response = await fetch(`/api/gen/${encodeURIComponent(backend)}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: id }),
        })
        // Not waiting any more either way: it has started (and the page now
        // watches it) or it is gone.
        if (!response.ok && response.status !== 409) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
        }
        remove(backend, id)
      } catch (error) {
        toast.error(t("generate.cancelFailed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
      }
    },
    [selectedId, remove, t]
  )

  useEffect(
    () => () => {
      sourceRef.current?.source.close()
      sourceRef.current = null
    },
    []
  )

  return { items, add, cancel }
}
