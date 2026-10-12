"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/** Gigabytes, with two decimals below one. */
export function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1)} GB`
}

/** A log, kept scrolled to its newest line. */
export function LogView({ lines, className }: { lines: string[]; className?: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const element = ref.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines])
  return (
    <pre ref={ref} className={cn("max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap", className)}>
      {lines.join("\n") || "…"}
    </pre>
  )
}
