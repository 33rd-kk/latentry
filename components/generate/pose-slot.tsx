"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Images, Loader2, PersonStanding, RefreshCw, Rotate3d, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { GalleryPicker } from "@/components/gallery/gallery-picker"
import { useSecretMode, useShownInSecret } from "@/components/app-header"
import { fetchPicture } from "@/hooks/use-gallery"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { isPlainView, WHOLE_FRAME, type PoseCamera, type PoseFraming } from "@/lib/pose"
import { toSourceImage, type SourceImage } from "./source-image-slot"
import { VeilToggle } from "./veil-toggle"

// WebGL exists only in the browser, and three.js is big: load it when the 3D view opens.
const Pose3dView = dynamic(() => import("./pose-3d-view"), { ssr: false })

/** The skeleton the run will follow, as the backend's /pose drew it. */
export interface PoseSkeleton {
  dataUrl: string
  width: number
  height: number
}

/** One person the server found, as fractions of the reference picture: [x0, y0, x1, y1]. */
interface DetectedPerson {
  bbox: [number, number, number, number]
  /** With want_3d: 133 points (x right, y down, z away) in units of the picture's width. */
  points_3d?: number[][]
  scores?: number[]
}

// The pose API's index for "every detected person" (see docs/backend-api.md).
const ALL_PEOPLE = -1
// The camera as the 3D view and the answers carry it: framing always present.
type ViewCamera = PoseCamera & { framing: PoseFraming }
const FRONT: ViewCamera = { yaw: 0, pitch: 0, framing: WHOLE_FRAME }
const sameView = (a: ViewCamera, b: ViewCamera) =>
  a.yaw === b.yaw && a.pitch === b.pitch && a.framing.zoom === b.framing.zoom && a.framing.x === b.framing.x && a.framing.y === b.framing.y
// Fewer body joints than this in the frame (a close-up) leaves a body-only
// OpenPose skeleton little to follow; poseorbit uses the same bar for a person.
const FEW_JOINTS = 8

interface PoseSlotProps {
  /** The backend whose pose detector draws the skeleton. */
  backend: string
  value: PoseSkeleton | null
  onChange: (value: PoseSkeleton | null) => void
  strength: number
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
 * With several people in the picture the server picks the most confident one,
 * which is often not the one meant, so their boxes are drawn over the reference
 * and clicking one asks for that person's skeleton instead. The choice lives
 * only here: the run still just sends the drawn skeleton.
 *
 * A backend that can turn a pose (poseorbit, which answers with `limits`)
 * also gets a 3D view: drag the camera around the figure, zoom and move the
 * frame (a face close-up, or room around the figure), then have the backend
 * draw the skeleton from there.
 */
export function PoseSlot({ backend, value, onChange, strength, onStrengthChange, outputSize, source, disabled }: PoseSlotProps) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  // What the current skeleton was detected from, kept so picking another
  // person (or detecting again at a new size) doesn't need the picture again.
  const [reference, setReference] = useState<SourceImage | null>(null)
  const [people, setPeople] = useState<DetectedPerson[]>([])
  const [person, setPerson] = useState<number | null>(null)
  // How far the backend lets the camera swing; null when it cannot turn a pose.
  const [limits, setLimits] = useState<{ yaw: number; pitch: number; zoom: readonly [number, number] } | null>(null)
  // How the skeleton was drawn, and how much of the body is left in its frame.
  const [style, setStyle] = useState<string | null>(null)
  const [jointsInFrame, setJointsInFrame] = useState<number | null>(null)
  const [show3d, setShow3d] = useState(false)
  // The angle the current skeleton was drawn from, and where the 3D camera is now.
  const [turn, setTurn] = useState<ViewCamera>(FRONT)
  const [view, setView] = useState<ViewCamera>(FRONT)

  const detect = useCallback(
    async (picture: SourceImage, which?: number | null, options: { camera?: ViewCamera; want3d?: boolean } = {}) => {
      setLoading(true)
      setError(null)
      const camera = options.camera ?? turn
      try {
        const response = await fetch(`/api/gen/${encodeURIComponent(backend)}/pose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: picture.dataUrl,
            ...outputSize,
            ...(which != null ? { person: which } : {}),
            ...((options.want3d ?? show3d) ? { want_3d: true } : {}),
            ...(isPlainView(camera) ? {} : { camera }),
          }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.skeleton_base64) {
          throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
        }
        setReference(picture)
        setPeople(Array.isArray(data.people) ? data.people : [])
        setPerson(typeof data.person === "number" ? data.person : null)
        setLimits(
          data.limits && typeof data.limits.yaw === "number"
            ? {
                yaw: data.limits.yaw,
                pitch: data.limits.pitch,
                // A backend without framing gets a view that cannot zoom.
                zoom: Array.isArray(data.limits.zoom) ? data.limits.zoom : [1, 1],
              }
            : null
        )
        setStyle(typeof data.style === "string" ? data.style : null)
        setJointsInFrame(typeof data.joints_in_frame === "number" ? data.joints_in_frame : null)
        const drawnFrom: ViewCamera =
          data.camera && typeof data.camera.yaw === "number"
            ? { yaw: data.camera.yaw, pitch: data.camera.pitch, framing: data.camera.framing ?? WHOLE_FRAME }
            : FRONT
        setTurn(drawnFrom)
        setView(drawnFrom)
        onChange({ dataUrl: `data:image/png;base64,${data.skeleton_base64}`, width: data.width, height: data.height })
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("generate.unreachable"))
      } finally {
        setLoading(false)
      }
    },
    [backend, onChange, outputSize, show3d, t, turn]
  )

  const loadPicture = useCallback(
    async (picture: Promise<Blob>) => {
      let decoded: SourceImage
      try {
        decoded = await toSourceImage(await picture)
      } catch {
        setError(t("generate.sourceLoadFailed"))
        return
      }
      // A new picture starts from the front.
      await detect(decoded, null, { camera: FRONT })
    },
    [detect, t]
  )

  const loadFile = useCallback(
    (file: File | undefined) => {
      if (!file || !file.type.startsWith("image/")) return
      void loadPicture(Promise.resolve(file))
    },
    [loadPicture]
  )

  const pickFromGallery = useCallback((url: string) => void loadPicture(fetchPicture(url)), [loadPicture])

  const clear = useCallback(() => {
    onChange(null)
    setReference(null)
    setPeople([])
    setPerson(null)
    setTurn(FRONT)
    setView(FRONT)
    setError(null)
  }, [onChange])

  const toggle3d = useCallback(() => {
    const opening = !show3d
    setShow3d(opening)
    // The 3D points come only when asked for; fetch them the first time.
    if (opening && reference && !people.some((detected) => detected.points_3d)) {
      void detect(reference, person, { want3d: true })
    }
  }, [detect, people, person, reference, show3d])

  const people3d = people.every((detected) => detected.points_3d && detected.scores)
    ? (people as Required<DetectedPerson>[])
    : null
  const frame = useMemo(
    () => (reference ? { aspect: reference.height / reference.width, output: outputSize } : null),
    [reference, outputSize]
  )
  const fewJoints = style === "openpose" && jointsInFrame !== null && jointsInFrame < FEW_JOINTS

  // A skeleton drawn for another size still works (the backend letterboxes it),
  // but it no longer lines up edge to edge; say so rather than silently shift it.
  const sizeChanged = value && (value.width !== outputSize.width || value.height !== outputSize.height)
  const choosing = value && reference && people.length > 1 ? reference : null
  // Secret mode blurs the picture people are chosen from; the numbered boxes
  // stay sharp on top, so a person can still be picked by where they stand.
  // "Show" lifts the blur for this picture until another one is chosen from.
  const secret = useSecretMode()
  const [shownChooser, setShownChooser] = useShownInSecret<string>()
  const chooserVeiled = secret && choosing !== null && shownChooser !== choosing.dataUrl

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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowGallery(true)}
            disabled={disabled}
          >
            <Images className="mr-1 h-3.5 w-3.5" />
            {t("generate.poseFromGallery")}
          </Button>
        </div>
      </div>

      {value ? (
        <div className="flex items-start gap-3">
          <img
            src={value.dataUrl}
            alt={t("generate.poseSkeleton")}
            className="h-28 w-28 shrink-0 rounded-md border border-border/50 bg-black object-contain dark:border-white/20"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{value.width} × {value.height}</span>
              {limits && reference && (
                <Button
                  type="button"
                  variant={show3d ? "secondary" : "ghost"}
                  size="sm"
                  className="ml-auto h-6 px-1.5 text-xs"
                  aria-pressed={show3d}
                  onClick={toggle3d}
                  disabled={disabled}
                >
                  <Rotate3d className="mr-1 h-3 w-3" />
                  {t("generate.pose3d")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={clear}
                disabled={disabled}
              >
                <X className="mr-1 h-3 w-3" />
                {t("generate.sourceClear")}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>{t("generate.poseStrength", { value: strength.toFixed(2) })}</Label>
              <Slider
                min={0}
                max={2}
                step={0.05}
                value={[strength]}
                onValueChange={([v]) => onStrengthChange(v)}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">{t("generate.poseSkeletonHint")}</p>
              {/* The answer decides what the 3D view can do; say what is missing rather than just leave it out. */}
              {reference && !limits && <p className="text-xs text-muted-foreground">{t("generate.pose3dUnavailable")}</p>}
              {limits && limits.zoom[0] === limits.zoom[1] && (
                <p className="text-xs text-muted-foreground">{t("generate.pose3dNoZoom")}</p>
              )}
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
                  {reference && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-xs"
                      onClick={() => void detect(reference, person)}
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
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragActive(false)
            loadFile(event.dataTransfer.files[0])
          }}
          disabled={disabled || loading}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground transition",
            isDragActive ? "border-primary bg-primary/5" : "hover:border-muted-foreground/60"
          )}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PersonStanding className="h-4 w-4" />}
          {t("generate.poseDrop")}
        </button>
      )}

      {value && reference && frame && limits && show3d && (
        <div className="space-y-1.5">
          {people3d ? (
            <Pose3dView
              people={people3d}
              person={person ?? 0}
              limits={limits}
              frame={frame}
              camera={view}
              onCameraChange={setView}
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
              onClick={() => void detect(reference, person, { camera: view })}
              disabled={disabled || loading || !people3d || sameView(view, turn)}
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
                setView(FRONT)
                if (!isPlainView(turn)) void detect(reference, person, { camera: FRONT })
              }}
              disabled={disabled || loading || (isPlainView(view) && isPlainView(turn))}
            >
              {t("generate.pose3dFront")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("generate.pose3dHint")}</p>
        </div>
      )}

      {choosing && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
            <span>{t("generate.posePeople", { count: people.length })}</span>
            {secret && (
              <VeilToggle veiled={chooserVeiled} onChange={(blur) => setShownChooser(blur ? null : choosing.dataUrl)} />
            )}
          </div>
          {/* The boxes are fractions of the picture, so they sit right at whatever size it renders. */}
          <div className="relative inline-block max-w-full overflow-hidden rounded-md">
            <img
              src={choosing.dataUrl}
              alt=""
              className={cn("block max-h-56 max-w-full rounded-md border border-border/50 bg-muted/50", chooserVeiled && "blur-xl")}
            />
            {people.map((detected, index) => {
              const [x0, y0, x1, y1] = detected.bbox
              const active = person === index || person === ALL_PEOPLE
              return (
                <button
                  key={index}
                  type="button"
                  aria-label={t("generate.posePerson", { n: index + 1 })}
                  aria-pressed={person === index}
                  onClick={() => void detect(choosing, index)}
                  disabled={disabled || loading}
                  style={{
                    left: `${x0 * 100}%`,
                    top: `${y0 * 100}%`,
                    width: `${(x1 - x0) * 100}%`,
                    height: `${(y1 - y0) * 100}%`,
                  }}
                  className={cn(
                    "absolute rounded-sm border-2 transition",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-white/70 bg-black/10 opacity-70 hover:border-primary/70 hover:opacity-100"
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0 top-0 rounded-br-sm px-1 text-[10px] font-semibold leading-4",
                      active ? "bg-primary text-primary-foreground" : "bg-black/60 text-white"
                    )}
                  >
                    {index + 1}
                  </span>
                </button>
              )
            })}
          </div>
          <div>
            <Button
              type="button"
              size="sm"
              variant={person === ALL_PEOPLE ? "secondary" : "ghost"}
              className="h-6 px-1.5 text-xs"
              aria-pressed={person === ALL_PEOPLE}
              onClick={() => void detect(choosing, ALL_PEOPLE)}
              disabled={disabled || loading}
            >
              <Users className="mr-1 h-3 w-3" />
              {t("generate.posePeopleAll")}
            </Button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          loadFile(event.currentTarget.files?.[0])
          event.currentTarget.value = ""
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}

      <GalleryPicker
        open={showGallery}
        onOpenChange={setShowGallery}
        title={t("generate.poseFromGallery")}
        onPick={pickFromGallery}
      />
    </div>
  )
}
