"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { EngineLora } from "@/hooks/use-engine-loras"
import { useT } from "@/lib/i18n"

interface LoraPickerProps {
  loras: EngineLora[] | null
  /** The loaded model's family; a LoRA made for another one cannot be chosen. */
  family: string | null
  /** Reads the loras folder again; called when the list opens. */
  onOpen: () => void
  onPick: (name: string) => void
  disabled?: boolean
}

/** Picks a LoRA from the engine's loras folder; the prompt gets its `<lora:…>` call. */
export function LoraPicker({ loras, family, onOpen, onPick, disabled }: LoraPickerProps) {
  const t = useT()
  return (
    <Select
      value=""
      onValueChange={onPick}
      onOpenChange={(open) => {
        if (open) onOpen()
      }}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-fit" aria-label={t("generate.lora.add")}>
        <SelectValue placeholder={t("generate.lora.add")} />
      </SelectTrigger>
      <SelectContent>
        {loras === null && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("generate.lora.loading")}</p>}
        {loras?.length === 0 && <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">{t("generate.lora.none")}</p>}
        {loras?.map((lora) => {
          const otherFamily = Boolean(family && lora.family && lora.family !== family)
          return (
            <SelectItem key={lora.name} value={lora.name} disabled={otherFamily}>
              <span className="flex flex-col">
                <span>{lora.name}</span>
                {(otherFamily || lora.license) && (
                  <span className="text-xs text-muted-foreground">
                    {otherFamily ? t("generate.lora.otherFamily", { family: lora.family!.toUpperCase() }) : t("generate.lora.license", { license: lora.license! })}
                  </span>
                )}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
