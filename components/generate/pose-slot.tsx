"use client"

import { useMemo, useState } from "react"
import { Images, PersonStanding } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { GalleryPicker } from "@/components/gallery/gallery-picker"
import { useSecretMode, useShownInSecret } from "@/components/app-header"
import { fetchPicture } from "@/hooks/use-gallery"
import { usePoseDetect } from "@/hooks/use-pose-detect"
import { useT } from "@/lib/i18n"
import type { DetectedPerson, PoseSkeleton } from "@/lib/pose"
import { Pose3dPanel } from "./pose-3d-panel"
import { PoseDropZone } from "./pose-drop-zone"
import { PosePersonChooser } from "./pose-person-chooser"
import { PoseSkeletonView } from "./pose-skeleton-view"
import type { SourceImage } from "./source-image-slot"

export type { PoseSkeleton } from "@/lib/pose"

interface PoseSlotProps {
  /** The backend whose pose detector draws the skeleton. */
  backend: string
  value: PoseSkeleton | null
  onChange: (value: PoseSkeleton | null) => void
  strength: number
  /** Where the strength slider starts; its reset goes back here. */
  defaultStrength: number
  onStrengthChange: (value: number) => void
  /** The run's output size; the skeleton is drawn at it so it lines up with the picture. */
  outputSize: { width: number; height: number }
  /** The img2img source, offered as a one-click pose reference. */
  source: SourceImage | null
  disabled?: boolean
}

/**
 * Skeleton pose control, shown only for a backend that offers it. A picture
 * goes to the backend, which detects the pose and draws the skeleton its pose
 * adapter was trained on; that skeleton is what the run sends, so the preview
 * is exactly what is followed.
 *
 * With several people in the picture, PosePersonChooser picks whose skeleton
 * is drawn; a backend that can turn a pose also gets Pose3dPanel. Both choices
 * live only here: the run still just sends the drawn skeleton.
 */
export function PoseSlot({ backend, value, onChange, strength, defaultStrength, onStrengthChange, outputSize, source, disabled }: PoseSlotProps) {
  const t = useT()
  const [showGallery, setShowGallery] = useState(false)
  const pose = usePoseDetect({ backend, outputSize, onChange })
  const { reference, people, person, limits, loading, detect } = pose

  const people3d = people.every((detected) => detected.points_3d && detected.scores)
    ? (people as Required<DetectedPerson>[])
    : null
  const frame = useMemo(
    () => (reference ? { aspect: reference.height / reference.width, output: outputSize } : null),
    [reference, outputSize]
  )
  const choosing = value && reference && people.length > 1 ? reference : null
  // Secret mode blurs the picture people are chosen from; "Show" lifts the
  // blur for this picture until another one is chosen from.
  const secret = useSecretMode()
  const [shownChooser, setShownChooser] = useShownInSecret<string>()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1">
          <PersonStanding className="h-3.5 w-3.5" />
          {t("generate.poseSkeleton")}
        </Label>
        <div className="flex items-center gap-1">
          {source && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void detect(source)}
              disabled={disabled || loading}
            >
              {t("generate.poseFromSource")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowGallery(true)} disabled={disabled}>
            <Images className="mr-1 h-3.5 w-3.5" />
            {t("generate.poseFromGallery")}
          </Button>
        </div>
      </div>

      {value ? (
        <PoseSkeletonView
          value={value}
          outputSize={outputSize}
          strength={strength}
          defaultStrength={defaultStrength}
          onStrengthChange={onStrengthChange}
          hasReference={reference !== null}
          limits={limits}
          style={pose.style}
          jointsInFrame={pose.jointsInFrame}
          turn={pose.turn}
          show3d={pose.show3d}
          onToggle3d={pose.toggle3d}
          onClear={pose.clear}
          onRedetect={() => reference && void detect(reference, person)}
          loading={loading}
          disabled={disabled}
        />
      ) : (
        <PoseDropZone onFile={(file) => void pose.loadPicture(Promise.resolve(file))} loading={loading} disabled={disabled} />
      )}

      {value && reference && frame && limits && pose.show3d && (
        <Pose3dPanel
          people={people3d}
          person={person}
          limits={limits}
          frame={frame}
          outputSize={outputSize}
          view={pose.view}
          turn={pose.turn}
          onViewChange={pose.setView}
          onDraw={(camera) => void detect(reference, person, { camera })}
          loading={loading}
          disabled={disabled}
        />
      )}

      {choosing && (
        <PosePersonChooser
          picture={choosing}
          people={people}
          person={person}
          onPick={(which) => void detect(choosing, which)}
          veil={
            secret
              ? { veiled: shownChooser !== choosing.dataUrl, onChange: (blur) => setShownChooser(blur ? null : choosing.dataUrl) }
              : null
          }
          loading={loading}
          disabled={disabled}
        />
      )}

      {pose.error && <p className="text-xs text-destructive">{pose.error}</p>}

      <GalleryPicker
        open={showGallery}
        onOpenChange={setShowGallery}
        title={t("generate.poseFromGallery")}
        onPick={(url) => void pose.loadPicture(fetchPicture(url))}
      />
    </div>
  )
}
