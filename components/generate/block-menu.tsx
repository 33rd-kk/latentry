"use client"

import { useCallback, useMemo } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocalText } from "@/hooks/use-local-text"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The generate form's optional blocks, each shown or hidden from a row at the
 * top of the form. A hidden block is not used: its source, skeleton, hires fix
 * or grid stays as set, for when it is shown again, but is not sent. Which ones
 * are hidden is remembered in this browser (not in secret mode).
 */
export const BLOCKS = ["characters", "source", "pose", "hires", "grid"] as const
export type Block = (typeof BLOCKS)[number]

const HIDDEN_KEY = "latentry:generate-hidden"

export function useShownBlocks(): { shown: (block: Block) => boolean; setShown: (block: Block, on: boolean) => void } {
  const [text, setText] = useLocalText(HIDDEN_KEY, "")
  const hidden = useMemo(() => new Set(text.split(",").filter(Boolean)), [text])
  const shown = useCallback((block: Block) => !hidden.has(block), [hidden])
  const setShown = useCallback(
    (block: Block, on: boolean) => {
      if (on !== hidden.has(block)) return
      const next = new Set(hidden)
      if (on) next.delete(block)
      else next.add(block)
      setText(BLOCKS.filter((name) => next.has(name)).join(","))
    },
    [hidden, setText]
  )
  return { shown, setShown }
}

export interface BlockChoice {
  block: Block
  /** Hidden, but still holding something it would send: a source, a skeleton, hires fix or a grid switched on. */
  holding: boolean
}

export function BlockMenu({ blocks, shown, setShown }: { blocks: BlockChoice[]; shown: (block: Block) => boolean; setShown: (block: Block, on: boolean) => void }) {
  const t = useT()
  return (
    <div role="group" aria-label={t("generate.blocks.label")} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">{t("generate.blocks.label")}</span>
      {blocks.map(({ block, holding }) => {
        const on = shown(block)
        return (
          <Button
            key={block}
            type="button"
            size="sm"
            variant={on ? "secondary" : "outline"}
            aria-pressed={on}
            title={!on && holding ? t("generate.blocks.holding") : undefined}
            className={cn("h-7 gap-1.5 px-2 text-xs", !on && "border-dashed text-muted-foreground")}
            onClick={() => setShown(block, !on)}
          >
            {on && <Check className="h-3 w-3" aria-hidden />}
            {t(`generate.blocks.${block}`)}
            {!on && holding && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" role="img" aria-label={t("generate.blocks.holding")} />}
          </Button>
        )
      })}
    </div>
  )
}
