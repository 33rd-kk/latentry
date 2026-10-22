"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import type { Translator } from "@/lib/i18n"
import type { GridAxis } from "@/lib/generate/grid"
import { useTabMemory } from "@/lib/generate/tab-memory"

// The X/Y grids this page queued (see lib/diffusion/run-queue.ts). As with
// any queued run, only this page was told a grid's id, so only it shows the
// grid's cells and may stop it. Held in this tab's memory only
// (tab-memory.ts): a reload forgets them here, though their cells still run
// and their pictures still reach the gallery. One stream per grid still going,
// which tells about its cells one after another.

export interface GridPicture {
  seed: number
  image_base64: string
  saved_name: string | null
}

export type GridCellStatus = "waiting" | "running" | "done" | "cancelled" | "error" | "gone"

export interface GridCellView {
  status: GridCellStatus
  images: GridPicture[]
  error: string | null
  /** While it runs: steps into the picture in flight, and pictures done. */
  progress: { completed: number; total: number; currentStep: number; stepsPerImage: number } | null
}

export type GridStatus = "queued" | "running" | "done" | "cancelled" | "error" | "gone"

export interface GridRunView {
  id: string
  backend: string
  /** The start of the prompt, to tell grids apart; null in secret mode. */
  label: string | null
  x: GridAxis
  y: GridAxis | null
  /** The seed every cell shares, unless the seed is an axis. */
  seed: number
  status: GridStatus
  /** Its place in the queue while it waits; whether the backend is busy with someone else's run. */
  position: number
  waiting: boolean
  cells: GridCellView[]
  error: string | null
}

export interface GridRuns {
  /** The selected backend's grids, newest first. */
  grids: GridRunView[]
  /** Grids of the selected backend still waiting in the queue: they count among its waiting runs. */
  waitingCount: number
  /** Ids of every grid still going, on any backend, so secret mode can reach them. */
  activeIds: string[]
  add: (grid: Omit<GridRunView, "status" | "cells" | "error" | "waiting">) => void
  cancel: (id: string) => Promise<void>
  remove: (id: string) => void
}

/** Finished grids kept on the page, besides any still going. */
const GRID_KEEP = 2

const isActive = (grid: GridRunView) => grid.status === "queued" || grid.status === "running"

export function useGridRuns(selectedId: string | null, t: Translator): GridRuns {
  const [all, setAll] = useTabMemory<GridRunView[]>("generate.grids", () => [])
  const sources = useRef(new Map<string, EventSource>())

  const edit = useCallback(
    (id: string, change: (grid: GridRunView) => GridRunView) => setAll((previous) => previous.map((grid) => (grid.id === id ? change(grid) : grid))),
    [setAll]
  )
  const editCell = useCallback(
    (id: string, index: number, change: (cell: GridCellView) => GridCellView) =>
      edit(id, (grid) => ({ ...grid, cells: grid.cells.map((cell, at) => (at === index ? change(cell) : cell)) })),
    [edit]
  )

  // One stream for each grid still going. A reconnect (or coming back to the
  // page) hears every cell again from the first, which overwrites in place.
  const active = useMemo(() => all.filter(isActive).map((grid) => `${grid.backend}\n${grid.id}`), [all])
  const activeKey = active.join("\n\n")
  useEffect(() => {
    const wanted = new Set(active.map((key) => key.split("\n")[1]))
    for (const [id, source] of sources.current) {
      if (!wanted.has(id)) {
        source.close()
        sources.current.delete(id)
      }
    }
    for (const key of active) {
      const [backend, id] = key.split("\n")
      if (sources.current.has(id)) continue
      const source = new EventSource(`/api/gen/${encodeURIComponent(backend)}/job/stream?id=${encodeURIComponent(id)}`)
      sources.current.set(id, source)
      let cell = -1
      const data = (event: Event) => JSON.parse((event as MessageEvent).data)
      source.addEventListener("queued", (event) => {
        const { position, waiting } = data(event)
        edit(id, (grid) => ({ ...grid, status: "queued", position, waiting }))
      })
      source.addEventListener("cell", (event) => {
        cell = data(event).index
        edit(id, (grid) => ({ ...grid, status: "running", waiting: false }))
        editCell(id, cell, (view) => ({ ...view, status: "running", error: null }))
      })
      source.addEventListener("snapshot", (event) => {
        const job = data(event)
        const at = cell
        editCell(id, at, (view) => ({
          ...view,
          images: (job.images ?? []).map(({ seed, image_base64, saved_name }: GridPicture) => ({ seed, image_base64, saved_name })),
          progress: { completed: job.completed, total: job.total, currentStep: job.currentStep, stepsPerImage: job.stepsPerImage },
        }))
      })
      source.addEventListener("image", (event) => {
        const { index, seed, image_base64, saved_name } = data(event)
        const at = cell
        editCell(id, at, (view) => {
          const images = [...view.images]
          images[index] = { seed, image_base64, saved_name }
          return { ...view, images }
        })
      })
      source.addEventListener("progress", (event) => {
        const { completed, total, currentStep, stepsPerImage, savedNames } = data(event)
        const at = cell
        editCell(id, at, (view) => ({
          ...view,
          progress: { completed, total, currentStep, stepsPerImage },
          images: view.images.map((image, index) => ({ ...image, saved_name: savedNames?.[index] ?? image.saved_name })),
        }))
      })
      source.addEventListener("cellEnd", (event) => {
        const { index, status, error } = data(event)
        editCell(id, index, (view) => ({ ...view, status, error: error ?? null, progress: null }))
      })
      source.addEventListener("end", (event) => {
        const { status, error } = data(event)
        source.close()
        sources.current.delete(id)
        edit(id, (grid) => ({
          ...grid,
          status,
          error: error ?? null,
          // Cells that never started stay as they were, said as not run.
          cells: grid.cells.map((view) => (view.status === "running" ? { ...view, status: "gone", progress: null } : view)),
        }))
        if (status === "error") toast.error(t("generate.failed"), { description: error ? t.server(error) : t("generate.serverError") })
      })
    }
    // Keyed by the set of grids going, not by their every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, edit, editCell, t])

  useEffect(
    () => () => {
      for (const source of sources.current.values()) source.close()
      sources.current.clear()
    },
    []
  )

  const add = useCallback<GridRuns["add"]>(
    (grid) => {
      const cells = grid.x.values.length * (grid.y?.values.length ?? 1)
      const view: GridRunView = {
        ...grid,
        status: "queued",
        waiting: false,
        error: null,
        cells: Array.from({ length: cells }, () => ({ status: "waiting", images: [], error: null, progress: null })),
      }
      setAll((previous) => {
        const finished = previous.filter((item) => !isActive(item)).slice(0, GRID_KEEP - 1)
        return [view, ...previous.filter(isActive), ...finished]
      })
    },
    [setAll]
  )

  const cancel = useCallback(
    async (id: string) => {
      const grid = all.find((item) => item.id === id)
      if (!grid) return
      try {
        const response = await fetch(`/api/gen/${encodeURIComponent(grid.backend)}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job: id }),
        })
        if (!response.ok && response.status !== 409) {
          const data = await response.json().catch(() => null)
          throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
        }
        // The stream says when it has stopped.
      } catch (error) {
        toast.error(t("generate.cancelFailed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
      }
    },
    [all, t]
  )

  const remove = useCallback((id: string) => setAll((previous) => previous.filter((grid) => grid.id !== id || isActive(grid))), [setAll])

  const grids = useMemo(() => all.filter((grid) => grid.backend === selectedId), [all, selectedId])
  const waitingCount = grids.filter((grid) => grid.status === "queued").length
  const activeIds = useMemo(() => all.filter(isActive).map((grid) => grid.id), [all])
  return { grids, waitingCount, activeIds, add, cancel, remove }
}
