"use client"

import dynamic from "next/dynamic"
import { useMemo } from "react"
import { Loader2, Rotate3d, RotateCcw, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import {
  FRONT,
  isPlainView,
  MAX_EDITS,
  sameEdits,
  sameView,
  type DetectedPerson,
  type PersonChoice,
  type PoseEdit,
  type PoseTurnLimits,
  type ViewCamera,
} from "@/lib/pose"

const NONE: ReadonlySet<number> = new Set()

// WebGL exists only in the browser, and three.js is big: load it when the 3D view opens.
const Pose3dView = dynamic(() => import("./pose-3d-view"), { ssr: false })

interface Pose3dPanelProps {
  /** Everyone's 3D points, or null while they are still being fetched. */
  people: Required<DetectedPerson>[] | null
  person: PersonChoice | null
  limits: PoseTurnLimits
  frame: { aspect: number; output: { width: number; height: number } }
  outputSize: { width: number; height: number }
  /** Where the 3D camera is now, and the angle the current skeleton was drawn from. */
  view: ViewCamera
  turn: ViewCamera
  onViewChange: (view: ViewCamera) => void
  /** Joints moved so far, and the ones the current skeleton was drawn with. */
  edits: PoseEdit[]
  drawnEdits: PoseEdit[]
  /** The joints the backend may move; empty, and joints don't move. */
  movable: ReadonlySet<number>
  onEdit: (edit: PoseEdit) => void
  onUndoEdit: () => void
  onResetEdits: () => void
  /** Asks the backend to draw the skeleton from `camera`, with the edits. */
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
export function Pose3dPanel({
  people,
  person,
  limits,
  frame,
  outputSize,
  view,
  turn,
  onViewChange,
  edits,
  drawnEdits,
  movable,
  onEdit,
  onUndoEdit,
  onResetEdits,
  onDraw,
  loading,
  disabled,
}: Pose3dPanelProps) {
  const t = useT()
  const full = edits.length >= MAX_EDITS
  // At the limit no more drags are taken: undo or reset to go on.
  const grabbable = useMemo(() => (full ? NONE : movable), [full, movable])
  const unchanged = sameView(view, turn) && sameEdits(edits, drawnEdits)
  return (
    <div className="space-y-1.5">
      {people ? (
        <Pose3dView
          people={people}
          person={person ?? 0}
          limits={limits}
          frame={frame}
          camera={view}
          onCameraChange={onViewChange}
          edits={edits}
          movable={grabbable}
          onEdit={onEdit}
        />
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
          disabled={disabled || loading || !people || unchanged}
        >
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Rotate3d className="mr-1 h-3 w-3" />}
          {t("generate.pose3dUse")}
        </Button>
        {movable.size > 0 && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs"
              onClick={onUndoEdit}
              disabled={disabled || loading || !edits.length}
            >
              <Undo2 className="mr-1 h-3 w-3" />
              {t("generate.pose3dUndo")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs"
              onClick={onResetEdits}
              disabled={disabled || loading || !edits.length}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              {t("generate.pose3dReset")}
            </Button>
          </>
        )}
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
      {edits.length > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">{t("generate.pose3dEdited", { count: edits.length })}</p>
      )}
      {full && <p className="text-xs text-amber-600 dark:text-amber-500">{t("generate.pose3dEditsFull", { count: MAX_EDITS })}</p>}
      <p className="text-xs text-muted-foreground">{t("generate.pose3dHint")}</p>
      {movable.size > 0 ? (
        <p className="text-xs text-muted-foreground">{t("generate.pose3dMoveHint")}</p>
      ) : (
        people && <p className="text-xs text-muted-foreground">{t("generate.pose3dNoEdits")}</p>
      )}
    </div>
  )
}
