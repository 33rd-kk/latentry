"use client"

import { useCallback, useState } from "react"
import { toSourceImage, type SourceImage } from "@/components/generate/source-image-slot"
import { useT } from "@/lib/i18n"
import { FRONT, isPlainView, readPoseAnswer, type DetectedPerson, type PersonChoice, type PoseSkeleton, type PoseTurnLimits, type ViewCamera } from "@/lib/pose"

interface UsePoseDetectOptions {
  /** The backend whose /pose detects people and draws the skeleton. */
  backend: string
  /** The run's output size; the skeleton is drawn at it. */
  outputSize: { width: number; height: number }
  onChange: (value: PoseSkeleton | null) => void
}

/**
 * The pose slot's conversation with the backend's /pose: the reference
 * picture, the people found in it and whose skeleton was drawn, and the 3D
 * camera. Every detect answers with a fresh skeleton, handed to `onChange`.
 */
export function usePoseDetect({ backend, outputSize, onChange }: UsePoseDetectOptions) {
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

  const detect = useCallback(
    async (picture: SourceImage, which?: PersonChoice | null, options: { camera?: ViewCamera; want3d?: boolean } = {}) => {
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
        setView(answer.camera)
        onChange(answer.skeleton)
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
    setView,
    detect,
    loadPicture,
    clear,
    toggle3d,
  }
}
