"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
}

interface ChoiceRowProps<T extends string> {
  choices: readonly Choice<T>[]
  value: T | null
  onPick: (value: T) => void
  disabled?: boolean
  "aria-label"?: string
  "aria-labelledby"?: string
}

/**
 * A row of small buttons that picks one of a few options (the source picture's
 * use, the control kind). Long labels, as in Japanese, wrap inside their button
 * and the row wraps to another line, so nothing is cut off at the card's edge.
 */
export function ChoiceRow<T extends string>({ choices, value, onPick, disabled, ...labelled }: ChoiceRowProps<T>) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" {...labelled}>
      {choices.map((choice) => (
        <Button
          key={choice.value}
          type="button"
          role="radio"
          aria-checked={value === choice.value}
          size="sm"
          variant={value === choice.value ? "secondary" : "ghost"}
          className="h-auto min-h-6 min-w-0 flex-auto shrink px-1.5 py-0.5 text-xs leading-tight whitespace-normal"
          onClick={() => onPick(choice.value)}
          disabled={disabled}
        >
          {choice.icon}
          {choice.label}
        </Button>
      ))}
    </div>
  )
}
