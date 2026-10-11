"use client"

import dynamic from "next/dynamic"
import { Loader2, Rotate3d } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { FRONT, isPlainView, sameView, type DetectedPerson, type PoseTurnLimits, type ViewCamera } from "@/lib/pose"

// WebGL exists only in the browser, and three.js is big: load it when the 3D view opens.
const Pose3dView = dynamic(() => import("./pose-3d-view"), { ssr: false })

interface Pose3dPanelProps {
  /** Everyone's 3D points, or null while they are still being fetched. */
  people: Required<DetectedPerson>[] | null
  person: number | null
  limits: PoseTurnLimits
  frame: { aspect: number; output: { width: number; height: number } }
  outputSize: { width: number; height: number }
  /** Where the 3D camera is now, and the angle the current skeleton was drawn from. */
  view: ViewCamera
  turn: ViewCamera
  onViewChange: (view: ViewCamera) => void
  /** Asks the backend to draw the skeleton from `camera`. */
  onDraw: (camera: ViewCamera) => void
  loading: boolean
  disabled?: boolean
}

/**
 * A backend that can turn a pose (poseorbit, which answers with `limits`)
 * also gets a 3D view: drag the camera around the figure, zoom and move the
 * frame (a face close-up, or room around the figure), then have the backend
 * draw the skeleton from there.
 */
export function Pose3dPanel({ people, person, limits, frame, outputSize, view, turn, onViewChange, onDraw, loading, disabled }: Pose3dPanelProps) {
  const t = useT()
  return (
    <div className="space-y-1.5">
      {people ? (
        <Pose3dView people={people} person={person ?? 0} limits={limits} frame={frame} camera={view} onCameraChange={onViewChange} />
      ) : (
        <div
          style={{ aspectRatio: `${outputSize.width} / ${outputSize.height}` }}
          className="flex w-full max-w-48 items-center justify-center rounded-md border border-border/50 bg-black dark:border-white/20"
        >
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs tabular-nums text-muted-foreground">
          {t("generate.pose3dAngle", { yaw: view.yaw, pitch: view.pitch, zoom: view.framing.zoom.toFixed(1) })}
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-6 px-1.5 text-xs"
          onClick={() => onDraw(view)}
          disabled={disabled || loading || !people || sameView(view, turn)}
        >
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Rotate3d className="mr-1 h-3 w-3" />}
          {t("generate.pose3dUse")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-xs"
          onClick={() => {
            onViewChange(FRONT)
            if (!isPlainView(turn)) onDraw(FRONT)
          }}
          disabled={disabled || loading || (isPlainView(view) && isPlainView(turn))}
        >
          {t("generate.pose3dFront")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("generate.pose3dHint")}</p>
    </div>
  )
}
