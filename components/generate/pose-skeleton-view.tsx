"use client"

import { useId } from "react"
import { RefreshCw, Rotate3d, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SliderLabel } from "@/components/generate/slider-label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { isPlainView, type PoseSkeleton, type PoseTurnLimits, type ViewCamera } from "@/lib/pose"

// Fewer body joints than this in the frame (a close-up) leaves a body-only
// OpenPose skeleton little to follow; poseorbit uses the same bar for a person.
const FEW_JOINTS = 8

interface PoseSkeletonViewProps {
  value: PoseSkeleton
  outputSize: { width: number; height: number }
  strength: number
  /** Where the strength slider starts; its reset goes back here. */
  defaultStrength: number
  onStrengthChange: (value: number) => void
  /** Whether the picture the skeleton came from is still at hand (to detect again, or turn). */
  hasReference: boolean
  limits: PoseTurnLimits | null
  style: string | null
  jointsInFrame: number | null
  /** The angle the skeleton was drawn from. */
  turn: ViewCamera
  show3d: boolean
  onToggle3d: () => void
  onClear: () => void
  onRedetect: () => void
  loading: boolean
  disabled?: boolean
}

/** The skeleton the run will follow, its strength, and what to know about it. */
export function PoseSkeletonView({
  value,
  outputSize,
  strength,
  defaultStrength,
  onStrengthChange,
  hasReference,
  limits,
  style,
  jointsInFrame,
  turn,
  show3d,
  onToggle3d,
  onClear,
  onRedetect,
  loading,
  disabled,
}: PoseSkeletonViewProps) {
  const t = useT()
  const sliderId = useId()
  const fewJoints = style === "openpose" && jointsInFrame !== null && jointsInFrame < FEW_JOINTS
  // A skeleton drawn for another size still works (the backend letterboxes it),
  // but it no longer lines up edge to edge; say so rather than silently shift it.
  const sizeChanged = value.width !== outputSize.width || value.height !== outputSize.height

  return (
    <div className="flex items-start gap-3">
      <img
        src={value.dataUrl}
        alt={t("generate.poseSkeleton")}
        className="h-28 w-28 shrink-0 rounded-md border border-border/50 bg-black object-contain dark:border-white/20"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{value.width} × {value.height}</span>
          {limits && hasReference && (
            <Button
              type="button"
              variant={show3d ? "secondary" : "ghost"}
              size="sm"
              className="ml-auto h-6 px-1.5 text-xs"
              aria-pressed={show3d}
              onClick={onToggle3d}
              disabled={disabled}
            >
              <Rotate3d className="mr-1 h-3 w-3" />
              {t("generate.pose3d")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={onClear} disabled={disabled}>
            <X className="mr-1 h-3 w-3" />
            {t("generate.sourceClear")}
          </Button>
        </div>
        <div className="space-y-1.5">
          <SliderLabel
            id={`${sliderId}-0`}
            value={strength}
            defaultValue={defaultStrength}
            shown={defaultStrength.toFixed(2)}
            onReset={() => onStrengthChange(defaultStrength)}
            disabled={disabled}
          >
            {t("generate.poseStrength", { value: strength.toFixed(2) })}
          </SliderLabel>
          <Slider aria-labelledby={`${sliderId}-0`} min={0} max={2} step={0.05} value={[strength]} onValueChange={([v]) => onStrengthChange(v)} disabled={disabled} />
          <p className="text-xs text-muted-foreground">{t("generate.poseSkeletonHint")}</p>
          {/* The answer decides what the 3D view can do; say what is missing rather than just leave it out. */}
          {hasReference && !limits && <p className="text-xs text-muted-foreground">{t("generate.pose3dUnavailable")}</p>}
          {limits && limits.zoom[0] === limits.zoom[1] && <p className="text-xs text-muted-foreground">{t("generate.pose3dNoZoom")}</p>}
          {!isPlainView(turn) && (
            <p className="text-xs text-muted-foreground">
              {t("generate.pose3dTurned", { yaw: turn.yaw, pitch: turn.pitch, zoom: turn.framing.zoom.toFixed(1) })}
            </p>
          )}
          {fewJoints && (
            <p className="text-xs text-amber-600 dark:text-amber-500">{t("generate.pose3dFewJoints", { count: jointsInFrame ?? 0 })}</p>
          )}
          {sizeChanged && (
            <div className="flex flex-wrap items-center gap-1">
              <p className="text-xs text-amber-600 dark:text-amber-500">{t("generate.poseSizeChanged")}</p>
              {hasReference && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={onRedetect}
                  disabled={disabled || loading}
                >
                  <RefreshCw className={cn("mr-1 h-3 w-3", loading && "animate-spin")} />
                  {t("generate.poseRedetect")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
