"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"

interface WildcardPickerProps {
  names: string[] | null
  /** Reads the wildcards folder again; called when the list opens. */
  onOpen: () => void
  onPick: (name: string) => void
}

/** Picks a wildcard from the wildcards folder; the prompt gets its `__name__`. */
export function WildcardPicker({ names, onOpen, onPick }: WildcardPickerProps) {
  const t = useT()
  return (
    <Select
      value=""
      onValueChange={onPick}
      onOpenChange={(open) => {
        if (open) onOpen()
      }}
    >
      <SelectTrigger size="sm" className="w-fit" aria-label={t("generate.wildcards.add")}>
        <SelectValue placeholder={t("generate.wildcards.add")} />
      </SelectTrigger>
      {/* Under the button: with no value of its own, the default (item-aligned)
          has no item to line up with and opens the list off to the side. */}
      <SelectContent position="popper" align="start">
        {names === null && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("generate.wildcards.loading")}</p>}
        {names?.length === 0 && <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">{t("generate.wildcards.none")}</p>}
        {names?.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
