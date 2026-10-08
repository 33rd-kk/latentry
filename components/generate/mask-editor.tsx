"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Brush, Eraser, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import type { SourceImage } from "./source-image-slot"
import { VeilToggle } from "./veil-toggle"

interface MaskEditorProps {
  source: SourceImage
  /** PNG data URL of the painted strokes, or null when nothing is painted. */
  onChange: (mask: string | null) => void
  disabled?: boolean
  /** Secret mode: the picture under the strokes is blurred (the strokes stay sharp). */
  veiled?: boolean
  /** Offered in secret mode: show or blur the picture. */
  onVeilChange?: (veiled: boolean) => void
}

/**
 * Paint the region img2img should redraw, over the source image.
 *
 * The canvas is the source's own resolution (scaled down by CSS), so a stroke
 * lands on the same pixels the backend will redraw. It is exported as-is: a
 * transparent PNG with the strokes opaque. The diffusers-compatible API reads
 * such a mask by its alpha (and the A1111 adapter turns the alpha into the
 * web UI's white-on-black), so the stroke colour is only for showing it here.
 */
export function MaskEditor({ source, onChange, disabled, veiled = false, onVeilChange }: MaskEditorProps) {
  const t = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [tool, setTool] = useState<"brush" | "eraser">("brush")
  // In source pixels, so the same setting means the same coverage whatever size
  // the editor happens to be displayed at. Starts at ~6% of the long side.
  const [brushSize, setBrushSize] = useState(() =>
    Math.round(Math.max(source.width, source.height) * 0.06)
  )
  const maxBrush = Math.round(Math.max(source.width, source.height) * 0.25)

  // A new source means a blank canvas; the old strokes belonged to another picture.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = source.width
    canvas.height = source.height
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
  }, [source])

  const toCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }, [])

  const strokeTo = useCallback(
    (point: { x: number; y: number }) => {
      const context = canvasRef.current?.getContext("2d")
      if (!context) return
      const from = lastPointRef.current ?? point
      context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over"
      context.strokeStyle = "rgb(236, 72, 153)"
      context.lineWidth = brushSize
      context.lineCap = "round"
      context.lineJoin = "round"
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(point.x, point.y)
      context.stroke()
      lastPointRef.current = point
    },
    [brushSize, tool]
  )

  /** Reports the canvas upward, or null when the strokes have all been erased. */
  const emit = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = false
    for (let index = 3; index < alpha.length; index += 4) {
      if (alpha[index] > 0) {
        painted = true
        break
      }
    }
    onChange(painted ? canvas.toDataURL("image/png") : null)
  }, [onChange])

  const endStroke = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    emit()
  }, [emit])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
    onChange(null)
  }, [onChange])

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md border border-border/50 bg-muted/50">
        <img
          src={source.dataUrl}
          alt={t("generate.sourceImage")}
          className={cn("block w-full select-none", veiled && "blur-xl")}
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0 h-full w-full touch-none opacity-60", disabled ? "cursor-not-allowed" : "cursor-crosshair")}
          onPointerDown={(event) => {
            if (disabled) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drawingRef.current = true
            lastPointRef.current = null
            strokeTo(toCanvasPoint(event))
          }}
          onPointerMove={(event) => {
            if (drawingRef.current) strokeTo(toCanvasPoint(event))
          }}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={tool === "brush" ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          onClick={() => setTool("brush")}
          disabled={disabled}
        >
          <Brush className="mr-1 h-3.5 w-3.5" />
          {t("generate.maskBrush")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tool === "eraser" ? "secondary" : "ghost"}
          className="h-7 px-2 text-xs"
          onClick={() => setTool("eraser")}
          disabled={disabled}
        >
          <Eraser className="mr-1 h-3.5 w-3.5" />
          {t("generate.maskEraser")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clear} disabled={disabled}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {t("generate.maskClear")}
        </Button>
        {onVeilChange && <VeilToggle veiled={veiled} onChange={onVeilChange} />}
        <div className="flex min-w-40 flex-1 items-center gap-2">
          <Label className="shrink-0 text-xs">{t("generate.maskBrushSize", { value: brushSize })}</Label>
          <Slider
            min={4}
            max={maxBrush}
            step={1}
            value={[brushSize]}
            onValueChange={([v]) => setBrushSize(v)}
            disabled={disabled}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("generate.maskHint")}</p>
    </div>
  )
}
