"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Download, Eye, EyeOff, FolderCheck, ImageUp } from "lucide-react"
import { useSecretMode } from "@/components/app-header"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImageLightbox, type LightboxItem } from "@/components/ui/image-lightbox"
import { Progress } from "@/components/ui/progress"
import type { SourceImage } from "@/components/generate/source-image-slot"
import type { JobWatch } from "@/hooks/use-job-watch"
import { useT } from "@/lib/i18n"

// Never show the current-image bar as fully done from the step count alone —
// it snaps to 100% only when the "image" event for real completion arrives.
const MAX_STEP_PERCENT = 99

interface ResultsPanelProps {
  job: Pick<JobWatch, "results" | "progress" | "jobStatus" | "jobError" | "saveWarning" | "isGenerating" | "runId">
  /** Offered when the backend can start from a picture: a result becomes the source. */
  onUseAsSource?: (source: SourceImage) => void
}

/** The run's progress, its pictures, and the full-screen viewer for them. */
export function ResultsPanel({ job, onUseAsSource }: ResultsPanelProps) {
  const t = useT()
  const { results, progress, jobStatus, jobError, saveWarning, isGenerating, runId } = job
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  // Secret mode blurs a run's pictures until "Show results", which lasts for
  // that run only: the next one starts blurred again.
  const secret = useSecretMode()
  const [shownRun, setShownRun] = useState<string | null>(null)
  const veiled = secret && (runId === null || shownRun !== runId)

  const previewItems = useMemo<LightboxItem[]>(
    () =>
      results.map((image) => ({
        src: `data:image/png;base64,${image.image_base64}`,
        name: `seed: ${image.seed}`,
        downloadName: image.saved_name ?? `latentry_${image.seed}.png`,
      })),
    [results]
  )

  const currentImagePercent =
    progress && progress.currentStep > 0
      ? Math.min(MAX_STEP_PERCENT, (progress.currentStep / Math.max(1, progress.stepsPerImage)) * 100)
      : null
  // The images already done, plus how far into the one in flight — a bar that
  // only counted finished images would sit at 0% for a one-image run.
  const overallPercent = progress
    ? Math.min(100, ((progress.completed + (currentImagePercent ?? 0) / 100) / Math.max(1, progress.total)) * 100)
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("generate.results")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isGenerating && progress && (
          <div className="mb-4 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("generate.overall")}</span>
                <span>
                  {progress.completed} / {progress.total}
                </span>
              </div>
              <Progress value={overallPercent} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("generate.currentImage")}</span>
                <span>
                  {progress.currentStep > 0
                    ? t("generate.stepProgress", { current: progress.currentStep, total: progress.stepsPerImage })
                    : t("generate.starting")}
                </span>
              </div>
              <Progress value={currentImagePercent ?? 0} indeterminate={currentImagePercent === null} />
            </div>
          </div>
        )}

        {/* Survives a reload along with the images, so a run that failed
            while the page was closed still says why. */}
        {jobError && !isGenerating && <p className="mb-4 text-sm text-destructive">{t.server(jobError)}</p>}
        {/* Not destructive: the images are right there and the run was fine. */}
        {saveWarning && !isGenerating && (
          <p className="mb-4 text-sm text-amber-600 dark:text-amber-500">{t.server(saveWarning)}</p>
        )}
        {jobStatus === "cancelled" && !jobError && <p className="mb-4 text-sm text-muted-foreground">{t("generate.runCancelled")}</p>}

        {secret && results.some(Boolean) && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {veiled && <span>{t("generate.resultsHidden")}</span>}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline disabled:opacity-50"
              onClick={() => setShownRun(veiled ? runId : null)}
              disabled={runId === null}
              aria-pressed={!veiled}
            >
              {veiled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {veiled ? t("generate.showResults") : t("generate.blurResults")}
            </button>
          </div>
        )}
        {results.length === 0 ? (
          !isGenerating && !jobError && <p className="text-sm text-muted-foreground">{t("generate.noImages")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {results.map((image, index) =>
              image ? (
                <div key={`${image.seed}-${index}`} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(index)}
                    title={t("generate.fullScreen")}
                    className="block w-full cursor-zoom-in overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img
                      src={`data:image/png;base64,${image.image_base64}`}
                      alt={t("generate.imageAlt", { seed: image.seed })}
                      className={cn("w-full rounded-md border border-border/50 bg-muted/50 object-contain", veiled && "blur-xl")}
                    />
                  </button>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>seed: {image.seed}</span>
                    {image.saved_name && (
                      <Link href="/gallery" className="inline-flex items-center gap-1 hover:text-foreground" title={image.saved_name}>
                        <FolderCheck className="h-3 w-3" />
                        {t("generate.saved")}
                      </Link>
                    )}
                    {onUseAsSource && (
                      <button
                        type="button"
                        onClick={() => {
                          const probe = new window.Image()
                          probe.onload = () => onUseAsSource({ dataUrl: probe.src, width: probe.naturalWidth, height: probe.naturalHeight })
                          probe.src = `data:image/png;base64,${image.image_base64}`
                        }}
                        disabled={isGenerating}
                        className="ml-auto inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                      >
                        <ImageUp className="h-3 w-3" />
                        {t("generate.useAsSource")}
                      </button>
                    )}
                    <a
                      href={`data:image/png;base64,${image.image_base64}`}
                      download={image.saved_name ?? `latentry_${image.seed}.png`}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <Download className="h-3 w-3" />
                      {t("generate.save")}
                    </a>
                  </div>
                </div>
              ) : null
            )}
          </div>
        )}
        <ImageLightbox
          items={previewItems}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          veiled={veiled}
        />
      </CardContent>
    </Card>
  )
}
