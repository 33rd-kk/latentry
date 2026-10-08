"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import { toast } from "sonner"
import type { Translator } from "@/lib/i18n"

// Progress and results live on the server (see lib/diffusion/job-store.ts), not
// in this component: POST .../generate starts a run and answers with its id,
// and this page watches it through an EventSource. That indirection is what
// makes a reload — or a tab the browser backgrounded and disconnected — pick
// the run back up instead of going blank while the GPU keeps working.
export type JobStatus = "running" | "done" | "cancelled" | "error"

export interface JobProgress {
  completed: number
  total: number
  currentStep: number
  stepsPerImage: number
}

export interface GeneratedImage {
  seed: number
  image_base64: string
  saved_name: string | null
}

export interface JobWatch {
  results: GeneratedImage[]
  progress: JobProgress | null
  jobStatus: JobStatus | null
  jobError: string | null
  /** Separate from jobError: the run succeeded, saving it to the gallery did not. */
  saveWarning: string | null
  /** The run on screen, for what is tied to one run (secret mode's "Show"). */
  runId: string | null
  isGenerating: boolean
  isCancelling: boolean
  setIsCancelling: (cancelling: boolean) => void
  /** The backend whose run is on screen, for handlers that must not be rebuilt. */
  backendRef: MutableRefObject<string | null>
  /** Shows a run as starting before the server has answered (the first snapshot replaces it). */
  begin: (progress: JobProgress) => void
  /** Takes back `begin` when the run did not start. */
  abandon: () => void
  /** Watches run `id` of `backend`. */
  attach: (backend: string, id: string) => void
}

/**
 * Watches the selected backend's run: on choosing a backend, on a reload,
 * and again whenever the page comes back into view.
 */
export function useJobWatch(selectedId: string | null, refreshBackends: () => void, t: Translator): JobWatch {
  const [isCancelling, setIsCancelling] = useState(false)
  const [results, setResults] = useState<GeneratedImage[]>([])
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  // Refs rather than state: the handlers below must see the current values
  // without being rebuilt, which would drop the stream they are reading.
  const sourceRef = useRef<EventSource | null>(null)
  const watchedIdRef = useRef<string | null>(null)
  const statusRef = useRef<JobStatus | null>(null)
  const backendRef = useRef<string | null>(null)
  // refresh() and attach() need each other, so one goes through a ref.
  const refreshRef = useRef<() => void>(() => {})

  const applyStatus = useCallback((next: JobStatus | null) => {
    statusRef.current = next
    setJobStatus(next)
    if (next !== "running") setIsCancelling(false)
  }, [])

  const closeSource = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  /**
   * Subscribes to a run: the stream opens with a full snapshot (progress and
   * every image so far) and then sends only what is new, so this is both
   * "start watching" and "resume watching after a reload".
   */
  const attach = useCallback(
    (backend: string, id: string) => {
      closeSource()
      watchedIdRef.current = id
      setRunId(id)
      const source = new EventSource(`/api/gen/${encodeURIComponent(backend)}/job/stream?id=${encodeURIComponent(id)}`)
      sourceRef.current = source
      const mine = () => sourceRef.current === source && backendRef.current === backend

      source.addEventListener("snapshot", (event) => {
        if (!mine()) return
        const job = JSON.parse((event as MessageEvent).data)
        setProgress({ completed: job.completed, total: job.total, currentStep: job.currentStep, stepsPerImage: job.stepsPerImage })
        setResults(job.images ?? [])
        setJobError(job.error ?? null)
        setSaveWarning(job.saveError ?? null)
        applyStatus(job.status)
      })
      source.addEventListener("progress", (event) => {
        if (!mine()) return
        const { savedNames, ...numbers } = JSON.parse((event as MessageEvent).data)
        setProgress(numbers)
        if (Array.isArray(savedNames)) {
          setResults((previous) =>
            previous.map((image, index) =>
              savedNames[index] !== undefined && savedNames[index] !== image.saved_name
                ? { ...image, saved_name: savedNames[index] }
                : image
            )
          )
        }
      })
      source.addEventListener("image", (event) => {
        if (!mine()) return
        const image = JSON.parse((event as MessageEvent).data)
        // Placed by index so a reconnect that replays an image cannot duplicate it.
        setResults((previous) => {
          const next = previous.slice()
          next[image.index] = { seed: image.seed, image_base64: image.image_base64, saved_name: image.saved_name ?? null }
          return next
        })
      })
      source.addEventListener("end", (event) => {
        const { status: ended, error, saveError } = JSON.parse((event as MessageEvent).data)
        source.close()
        if (sourceRef.current === source) sourceRef.current = null
        if (backendRef.current !== backend) return

        // "gone": a newer run replaced this one (started from another tab), or
        // the server restarted and forgot it. Either way, ask what is current.
        if (ended === "gone") {
          watchedIdRef.current = null
          refreshRef.current()
          return
        }
        const wasRunning = statusRef.current === "running"
        // The backend is free again; say so now rather than at the next poll.
        refreshBackends()
        setJobError(error ?? null)
        setSaveWarning(saveError ?? null)
        setProgress((previous) => (previous ? { ...previous, currentStep: 0 } : previous))
        applyStatus(ended)
        // Only announce an ending this page watched happen.
        if (!wasRunning) return
        if (ended === "cancelled") toast(t("generate.cancelled"))
        else if (ended === "error") toast.error(t("generate.failed"), { description: error ? t.server(error) : t("generate.serverError") })
      })
      // No onerror handler: EventSource reconnects by itself, and the reconnect
      // re-sends the snapshot.
    },
    [applyStatus, closeSource, refreshBackends, t]
  )

  /** Asks the backend's job store what it is doing and attaches if that is not already on screen. */
  const refresh = useCallback(async () => {
    const backend = backendRef.current
    if (!backend) return
    try {
      const response = await fetch(`/api/gen/${encodeURIComponent(backend)}/job`, { cache: "no-store" })
      if (!response.ok || backendRef.current !== backend) return
      const job = (await response.json())?.job
      if (!job) {
        if (statusRef.current === "running") {
          closeSource()
          watchedIdRef.current = null
          setProgress(null)
          applyStatus(null)
        }
        return
      }
      const inSync = job.id === watchedIdRef.current && statusRef.current === job.status
      if (inSync && (sourceRef.current !== null || job.status !== "running")) return
      attach(backend, job.id)
    } catch {
      // Offline or down; the next visibility change tries again.
    }
  }, [applyStatus, attach, closeSource])

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  // Switching backend shows that backend's run (if any) and nothing else.
  /* eslint-disable react-hooks/set-state-in-effect -- clearing the previous backend's
     results is part of switching to another; refresh() then asks the server. */
  useEffect(() => {
    backendRef.current = selectedId
    closeSource()
    watchedIdRef.current = null
    setRunId(null)
    setResults([])
    setProgress(null)
    setJobError(null)
    setSaveWarning(null)
    applyStatus(null)
    if (selectedId) void refresh()
  }, [selectedId, applyStatus, closeSource, refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Again whenever the page comes back into view: a background tab can have its
  // stream cut without warning, and bfcache restores one whose socket is gone.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === "visible") void refreshRef.current()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recheck()
    }
    document.addEventListener("visibilitychange", recheck)
    window.addEventListener("pageshow", onPageShow)
    window.addEventListener("online", recheck)
    return () => {
      document.removeEventListener("visibilitychange", recheck)
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("online", recheck)
    }
  }, [])

  useEffect(() => closeSource, [closeSource])

  const begin = useCallback(
    (next: JobProgress) => {
      // A new run, not yet known by its id: nothing shown carries over.
      setRunId(null)
      setResults([])
      setJobError(null)
      setSaveWarning(null)
      setProgress(next)
      applyStatus("running")
    },
    [applyStatus]
  )

  const abandon = useCallback(() => {
    setProgress(null)
    applyStatus(null)
  }, [applyStatus])

  return {
    results,
    progress,
    jobStatus,
    jobError,
    saveWarning,
    runId,
    isGenerating: jobStatus === "running",
    isCancelling,
    setIsCancelling,
    backendRef,
    begin,
    abandon,
    attach,
  }
}
