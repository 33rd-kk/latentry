"use client"

import { ChevronDown, Info } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { HINTED_FEATURES, type FeatureHint, type HintedFeature } from "@/lib/backends/types"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface UnavailableFeaturesProps {
  hints: Partial<Record<HintedFeature, FeatureHint>>
  className?: string
}

/**
 * The features this backend cannot use, folded into one line: opening it says
 * why each is off and what would turn it on. Nothing when all of them work.
 */
export function UnavailableFeatures({ hints, className }: UnavailableFeaturesProps) {
  const t = useT()
  const missing = HINTED_FEATURES.filter((feature) => hints[feature])
  if (!missing.length) return null
  const names = missing.map((feature) => t(`generate.unavailable.feature.${feature}` as MessageKey)).join(", ")

  return (
    <Collapsible className={cn("rounded-md border border-dashed px-2.5 py-1.5", className)}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{t("generate.unavailable.title", { features: names })}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
          {missing.map((feature) => (
            <li key={feature}>
              <span className="font-medium text-foreground">{t(`generate.unavailable.feature.${feature}` as MessageKey)}</span>
              {": "}
              {hintText(t, feature, hints[feature]!)}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function hintText(t: ReturnType<typeof useT>, feature: HintedFeature, hint: FeatureHint): string {
  if (hint.reason === "declined") {
    // The server's own words come first: it knows what it has loaded.
    return hint.detail ? t("generate.unavailable.declinedBecause", { detail: hint.detail }) : t("generate.unavailable.declined")
  }
  return t(`generate.unavailable.${hint.reason === "kind" ? "kind" : "notReported"}.${feature}` as MessageKey)
}
