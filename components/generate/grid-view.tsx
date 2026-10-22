"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Eye, EyeOff, Loader2, Save, X } from "lucide-react"
import { useSecretMode, useShownInSecret } from "@/components/app-header"
import { Button } from "@/components/ui/button"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { Progress } from "@/components/ui/progress"
import { PromptLabel } from "@/components/generate/results-panel"
import type { GridRunView, GridRuns } from "@/hooks/use-grid-runs"
import { gridCells } from "@/lib/generate/grid"
import { isSecretMode } from "@/lib/secret-mode"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/** The grids this page queued, each as a table of its cells. */
export function GridList({ grids }: { grids: Pick<GridRuns, "grids" | "cancel" | "remove"> }) {
  if (grids.grids.length === 0) return null
  return (
    <div className="mb-4 space-y-4">
      {grids.grids.map((grid) => (
        <GridView key={grid.id} grid={grid} onCancel={() => void grids.cancel(grid.id)} onRemove={() => grids.remove(grid.id)} />
      ))}
    </div>
  )
}

function GridView({ grid, onCancel, onRemove }: { grid: GridRunView; onCancel: () => void; onRemove: () => void }) {
  const t = useT()
  const secret = useSecretMode()
  const [shownRun, setShownRun] = useShownInSecret<string>()
  const veiled = secret && shownRun !== grid.id
  const [preview, setPreview] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const spec = useMemo(() => ({ x: grid.x, y: grid.y }), [grid.x, grid.y])
  const cells = useMemo(() => gridCells(spec), [spec])
  const axisName = (kind: string) => t(`generate.grid.axis.${kind}` as "generate.grid.axis.cfg")
  const heading = grid.y
    ? t("generate.grid.heading", { x: axisName(grid.x.kind), y: axisName(grid.y.kind) })
    : t("generate.grid.headingOne", { x: axisName(grid.x.kind) })
  const going = grid.status === "queued" || grid.status === "running"
  const done = grid.cells.filter((cell) => cell.status !== "waiting" && cell.status !== "running").length

  // Every picture of every cell, in cell order, for the full-screen viewer.
  const pictures = useMemo(
    () =>
      cells.flatMap((cell) =>
        (grid.cells[cell.index]?.images ?? []).filter(Boolean).map((image) => ({ cell, image }))
      ),
    [cells, grid.cells]
  )
  const items = useMemo<LightboxItem[]>(
    () =>
      pictures.map(({ cell, image }) => ({
        src: `data:image/png;base64,${image.image_base64}`,
        name: [`${axisName(grid.x.kind)}: ${cell.xValue}`, grid.y && `${axisName(grid.y.kind)}: ${cell.yValue}`, `seed: ${image.seed}`]
          .filter(Boolean)
          .join(" · "),
        downloadName: image.saved_name ?? `latentry_${image.seed}.png`,
      })),
    // axisName reads t, which is stable for a locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pictures, grid.x.kind, grid.y]
  )

  // The sheet is built from the saved pictures: the first of each cell.
  const rows = useMemo(
    () =>
      (grid.y?.values ?? [null]).map((_, y) =>
        grid.x.values.map((_, x) => grid.cells[y * grid.x.values.length + x]?.images[0]?.saved_name ?? null)
      ),
    [grid]
  )
  const canSave = !going && !secret && rows.some((row) => row.some(Boolean))
  const saveSheet = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/gallery/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grid: grid.id, rows, secret: isSecretMode() }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
      toast.success(t("generate.grid.sheetSaved"))
    } catch (error) {
      toast.error(t("generate.grid.sheetFailed"), { description: error instanceof Error ? error.message : t("generate.unreachable") })
    } finally {
      setSaving(false)
    }
  }

  const status =
    grid.status === "queued"
      ? grid.waiting
        ? t("generate.queue.waitingBackend")
        : grid.position > 1
          ? t("generate.queue.position", { ahead: grid.position - 1 })
          : t("generate.grid.waiting")
      : grid.status === "running"
        ? t("generate.grid.progress", { done: Math.min(done + 1, grid.cells.length), total: grid.cells.length })
        : grid.status === "cancelled"
          ? t("generate.grid.cancelled")
          : grid.status === "done"
            ? t("generate.grid.done")
            : ""

  const columns = grid.x.values.length
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label={heading}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{heading}</span>
        <PromptLabel text={secret ? null : grid.label} fallback={t("generate.queue.secretRun")} className="flex-1 text-xs text-muted-foreground" />
        <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
        {secret && pictures.length > 0 && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-xs underline-offset-4 hover:underline"
            onClick={() => setShownRun(veiled ? grid.id : null)}
            aria-pressed={!veiled}
          >
            {veiled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {veiled ? t("generate.earlier.show") : t("generate.earlier.blur")}
          </button>
        )}
        {going ? (
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={onCancel}>
            {t("generate.grid.cancel")}
          </Button>
        ) : (
          <>
            {canSave && (
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void saveSheet()} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                {t("generate.grid.saveSheet")}
              </Button>
            )}
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove} aria-label={t("generate.grid.remove")}>
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      {grid.error && <p className="text-xs text-destructive">{t.server(grid.error)}</p>}
      {grid.x.kind !== "seed" && grid.y?.kind !== "seed" && (
        <p className="text-xs text-muted-foreground">{t("generate.grid.seedShared", { seed: grid.seed })}</p>
      )}
      <div className="overflow-x-auto">
        <div
          className="grid gap-1.5 text-xs"
          style={{ gridTemplateColumns: `${grid.y ? "minmax(3rem, max-content) " : ""}repeat(${columns}, minmax(4.5rem, 1fr))` }}
          role="table"
          aria-label={heading}
        >
          <div role="row" className="contents">
            {grid.y && <span role="columnheader" />}
            {grid.x.values.map((value, x) => (
              <span key={x} role="columnheader" className="truncate text-center text-muted-foreground" title={value}>
                {value || "∅"}
              </span>
            ))}
          </div>
          {(grid.y?.values ?? [null]).map((yValue, y) => (
            <div role="row" key={y} className="contents">
              {grid.y && (
                <span role="rowheader" className="self-center truncate text-right text-muted-foreground" title={yValue ?? ""}>
                  {yValue || "∅"}
                </span>
              )}
              {grid.x.values.map((xValue, x) => {
                const index = y * columns + x
                const cell = grid.cells[index]
                const image = cell?.images.find(Boolean)
                const at = image ? pictures.findIndex((picture) => picture.image === image) : -1
                const percent =
                  cell?.progress && cell.progress.total > 0
                    ? ((cell.progress.completed + cell.progress.currentStep / Math.max(1, cell.progress.stepsPerImage)) / cell.progress.total) * 100
                    : 0
                return (
                  <div role="cell" key={x} className="relative aspect-square overflow-hidden rounded-md border border-border/50 bg-muted/40">
                    {image ? (
                      <button
                        type="button"
                        onClick={() => setPreview(at)}
                        className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        title={t("generate.fullScreen")}
                      >
                        <img
                          src={`data:image/png;base64,${image.image_base64}`}
                          alt={t("generate.grid.cellAlt", { x: xValue, y: yValue ?? "" })}
                          className={cn("h-full w-full object-cover", veiled && "blur-xl")}
                        />
                      </button>
                    ) : cell?.status === "error" || cell?.status === "gone" || (cell?.status === "waiting" && !going) ? (
                      <span className="flex h-full items-center justify-center p-1 text-center text-muted-foreground" title={cell.error ? t.server(cell.error) : undefined}>
                        {t("generate.grid.cellFailed")}
                      </span>
                    ) : null}
                    {(cell?.images.length ?? 0) > 1 && (
                      <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{cell!.images.length}</span>
                    )}
                    {cell?.status === "running" && (
                      <div className="absolute inset-x-1 bottom-1">
                        <Progress value={percent} indeterminate={percent === 0} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <ImageLightbox items={items} index={preview} onIndexChange={setPreview} onClose={() => setPreview(null)} veiled={veiled} />
    </section>
  )
}
