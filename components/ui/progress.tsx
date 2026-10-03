import { cn } from "@/lib/utils"

interface ProgressProps {
  /** 0-100; ignored when `indeterminate`. */
  value?: number
  /** A sweeping bar, for the wait before there is anything to measure. */
  indeterminate?: boolean
  className?: string
}

export function Progress({ value = 0, indeterminate = false, className }: ProgressProps) {
  const percent = Math.min(100, Math.max(0, value))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/3 rounded-full bg-primary animate-[progress-indeterminate_1.2s_ease-in-out_infinite]" />
      ) : (
        <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
      )}
    </div>
  )
}
