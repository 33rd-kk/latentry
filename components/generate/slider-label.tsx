"use client"

import type { ReactNode } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n"

interface SliderLabelProps {
  children: ReactNode
  value: number
  /** Where the slider starts: the model profile's value, as a rule. */
  defaultValue: number
  /** How the default reads in the button's label, e.g. "0.60". */
  shown?: string
  onReset: () => void
  disabled?: boolean
}

/**
 * A slider's label, with a reset button at its end while the value differs
 * from the default. On a phone a tap or swipe while scrolling can move a
 * slider unnoticed; this shows it moved and puts it back. The row keeps its
 * height either way, so the form does not jump when the button appears.
 */
export function SliderLabel({ children, value, defaultValue, shown, onReset, disabled }: SliderLabelProps) {
  const t = useT()
  const label = t("generate.resetTo", { value: shown ?? String(defaultValue) })
  return (
    <div className="flex h-5 items-center justify-between gap-2">
      <Label>{children}</Label>
      {value !== defaultValue && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground"
              onClick={onReset}
              disabled={disabled}
              aria-label={label}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
