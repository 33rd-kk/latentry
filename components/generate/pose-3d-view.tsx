"use client"

import { useEffect, useRef } from "react"
import { createPoseViewer, type PosePerson3d, type PoseViewer, type ViewerCamera } from "@/components/pose3d/viewer"

interface Pose3dViewProps {
  people: PosePerson3d[]
  /** Which person is shown, or -1 for everyone. */
  person: number
  limits: { yaw: number; pitch: number }
  /** Where the camera stands; changing it moves the view. */
  camera: ViewerCamera
  onCameraChange: (camera: ViewerCamera) => void
}

/**
 * The 3D pose viewer (components/pose3d, three.js only) as a React component.
 * Loaded with next/dynamic and ssr: false, since WebGL exists only in the browser.
 */
export default function Pose3dView({ people, person, limits, camera, onCameraChange }: Pose3dViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<PoseViewer | null>(null)
  // The viewer is made once; later props reach it through these.
  const onChangeRef = useRef(onCameraChange)
  const initial = useRef({ people, person, limits, camera })

  useEffect(() => {
    onChangeRef.current = onCameraChange
  }, [onCameraChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const viewer = createPoseViewer(canvas, {
      ...initial.current,
      onChange: (moved) => onChangeRef.current(moved),
    })
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    viewerRef.current?.setPeople(people, person)
  }, [people, person])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const now = viewer.getCamera()
    if (now.yaw !== camera.yaw || now.pitch !== camera.pitch) viewer.setCamera(camera)
  }, [camera])

  return <canvas ref={canvasRef} className="block aspect-square w-full max-w-72 cursor-grab touch-none rounded-md border border-border/50 bg-black active:cursor-grabbing" />
}
