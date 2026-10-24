"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toSourceImage, type SourceImage } from "@/components/generate/source-image-slot"
import { useT } from "@/lib/i18n"
import {
  FRONT,
  isPlainView,
  readPoseAnswer,
  type DetectedPerson,
  type PersonChoice,
  type PoseEdit,
  type PoseSkeleton,
  type PoseTurnLimits,
  sameView,
  type ViewCamera,
} from "@/lib/pose"

const NO_JOINTS: ReadonlySet<number> = new Set()

/** One step Undo takes back: a joint moved, or the camera moved away from `view`. */
type Step = { kind: "edit" } | { kind: "view"; view: ViewCamera }

// How long the camera must rest before a move of it becomes one step: a
// drag, a scroll or a pinch sends many small moves.
const SETTLE_MS = 400

interface UsePoseDetectOptions {
  /** The backend whose /pose detects people and draws the skeleton. */
  backend: string
  /** A ComfyUI workflow to draw the skeleton for, "" for none: it says how the skeleton is drawn. */
  workflow?: string
  /** The run's output size; the skeleton is drawn at it. */
  outputSize: { width: number; height: number }
  onChange: (value: PoseSkeleton | null) => void
}

/**
 * The pose slot's conversation with the backend's /pose: the reference
 * picture, the people found in it and whose skeleton was drawn, and the 3D
 * camera. Every detect answers with a fresh skeleton, handed to `onChange`.
 */
export function usePoseDetect({ backend, workflow = "", outputSize, onChange }: UsePoseDetectOptions) {
  const t = useT()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the current skeleton was detected from, kept so picking another
  // person (or detecting again at a new size) doesn't need the picture again.
  const [reference, setReference] = useState<SourceImage | null>(null)
  const [people, setPeople] = useState<DetectedPerson[]>([])
  const [person, setPerson] = useState<PersonChoice | null>(null)
  // Whether the backend takes some of the people by a list, or only one or everyone.
  const [subsets, setSubsets] = useState(false)
  // How far the backend lets the camera swing; null when it cannot turn a pose.
  const [limits, setLimits] = useState<PoseTurnLimits | null>(null)
  // How the skeleton was drawn, and how much of the body is left in its frame.
  const [style, setStyle] = useState<string | null>(null)
  const [jointsInFrame, setJointsInFrame] = useState<number | null>(null)
  const [show3d, setShow3d] = useState(false)
  // The angle the current skeleton was drawn from, and where the 3D camera is now.
  const [turn, setTurn] = useState<ViewCamera>(FRONT)
  const [view, setView] = useState<ViewCamera>(FRONT)
  // Joints moved in the 3D view, in order, and the ones the current skeleton
  // was drawn with. Kept per person index, so choosing someone else keeps them;
  // in memory only, gone with the picture.
  const [edits, setEdits] = useState<PoseEdit[]>([])
  const [drawnEdits, setDrawnEdits] = useState<PoseEdit[]>([])
  // The joints the backend may move ("movable"); none, and joints don't move.
  const [movable, setMovable] = useState<ReadonlySet<number>>(NO_JOINTS)
  // What Undo takes back, joints and camera together, in the order they moved.
  const [history, setHistory] = useState<Step[]>([])
  // Where the camera last came to rest and where it is now, and the wait for
  // it to rest again; a move counts as a step once it does.
  const settled = useRef<ViewCamera>(FRONT)
  const latest = useRef<ViewCamera>(FRONT)
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [cameraMoving, setCameraMoving] = useState(false)

  /** The camera move still waiting to rest, as a step (null for none), now counted as rested. */
  const takeCameraStep = useCallback((): Step | null => {
    if (settling.current) clearTimeout(settling.current)
    settling.current = null
    setCameraMoving(false)
    const from = settled.current
    settled.current = latest.current
    return sameView(from, latest.current) ? null : { kind: "view", view: from }
  }, [])

  /** The camera as the 3D view moves it. */
  const moveView = useCallback(
    (next: ViewCamera) => {
      setView(next)
      latest.current = next
      if (settling.current) clearTimeout(settling.current)
      setCameraMoving(!sameView(settled.current, next))
      settling.current = setTimeout(() => {
        const step = takeCameraStep()
        if (step) setHistory((steps) => [...steps, step])
      }, SETTLE_MS)
    },
    [takeCameraStep]
  )

  /** The camera put somewhere without a step to undo (a new answer, a new picture). */
  const placeView = useCallback((next: ViewCamera) => {
    if (settling.current) clearTimeout(settling.current)
    settling.current = null
    setCameraMoving(false)
    settled.current = next
    latest.current = next
    setView(next)
  }, [])

  useEffect(() => () => {
    if (settling.current) clearTimeout(settling.current)
  }, [])

  const detect = useCallback(
    async (
      picture: SourceImage,
      which?: PersonChoice | null,
      options: { camera?: ViewCamera; want3d?: boolean; edits?: PoseEdit[] } = {}
    ) => {
      setLoading(true)
      setError(null)
      const camera = options.camera ?? turn
      // The skeleton always shows the edits, whatever else was asked.
      const sent = options.edits ?? edits
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
            ...(sent.length ? { edits: sent } : {}),
            ...(workflow ? { workflow } : {}),
          }),
        })
        const data = await response.json().catch(() => null)
        const answer = response.ok ? readPoseAnswer(data) : null
        if (!answer) {
          throw new Error(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
        }
        setReference(picture)
        setPeople(answer.people)
        setPerson(answer.person)
        setSubsets(answer.subsets)
        setLimits(answer.limits)
        setStyle(answer.style)
        setJointsInFrame(answer.jointsInFrame)
        setTurn(answer.camera)
        // A camera move not yet counted is still one step back.
        const step = takeCameraStep()
        if (options.edits) setHistory([])
        else if (step) setHistory((steps) => [...steps, step])
        placeView(answer.camera)
        setMovable(answer.movable.length ? new Set(answer.movable) : NO_JOINTS)
        setEdits(sent)
        setDrawnEdits(sent)
        onChange(answer.skeleton)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t("generate.unreachable"))
      } finally {
        setLoading(false)
      }
    },
    [backend, edits, onChange, outputSize, placeView, show3d, t, takeCameraStep, turn, workflow]
  )

  // Another workflow may draw skeletons another way: draw this one again for it.
  const drawnFor = useRef(workflow)
  /* eslint-disable react-hooks/set-state-in-effect -- the workflow is chosen
     outside this slot, and the skeleton it needs comes from the server */
  useEffect(() => {
    if (drawnFor.current === workflow) return
    drawnFor.current = workflow
    if (reference) void detect(reference, person)
  }, [detect, person, reference, workflow])
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadPicture = useCallback(
    async (picture: Promise<Blob>) => {
      let decoded: SourceImage
      try {
        decoded = await toSourceImage(await picture)
      } catch {
        setError(t("generate.sourceLoadFailed"))
        return
      }
      // A new picture starts from the front, as detected.
      await detect(decoded, null, { camera: FRONT, edits: [] })
    },
    [detect, t]
  )

  const clear = useCallback(() => {
    onChange(null)
    setReference(null)
    setPeople([])
    setPerson(null)
    setTurn(FRONT)
    placeView(FRONT)
    setEdits([])
    setDrawnEdits([])
    setHistory([])
    setError(null)
  }, [onChange, placeView])

  const addEdit = useCallback(
    (edit: PoseEdit) => {
      // A camera move just before the drag comes first.
      const step = takeCameraStep()
      setHistory((steps) => [...steps, ...(step ? [step] : []), { kind: "edit" }])
      setEdits((current) => [...current, edit])
    },
    [takeCameraStep]
  )

  /** Takes back the last move, of a joint or of the camera. */
  const undo = useCallback(() => {
    const step = takeCameraStep()
    const steps = step ? [...history, step] : history
    const last = steps.at(-1)
    if (!last) return
    setHistory(steps.slice(0, -1))
    if (last.kind === "edit") setEdits((current) => current.slice(0, -1))
    else placeView(last.view)
  }, [history, placeView, takeCameraStep])

  const resetEdits = useCallback(() => {
    setEdits([])
    setHistory((steps) => steps.filter((step) => step.kind !== "edit"))
  }, [])

  const toggle3d = useCallback(() => {
    const opening = !show3d
    setShow3d(opening)
    // The 3D points come only when asked for; fetch them the first time.
    if (opening && reference && !people.some((detected) => detected.points_3d)) {
      void detect(reference, person, { want3d: true })
    }
  }, [detect, people, person, reference, show3d])

  return {
    loading,
    error,
    reference,
    people,
    person,
    subsets,
    limits,
    style,
    jointsInFrame,
    show3d,
    turn,
    view,
    setView: moveView,
    edits,
    drawnEdits,
    movable,
    canUndo: history.length > 0 || cameraMoving,
    addEdit,
    undo,
    resetEdits,
    detect,
    loadPicture,
    clear,
    toggle3d,
  }
}
