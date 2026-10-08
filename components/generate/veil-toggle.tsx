"use client"

import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

/**
 * Secret mode's switch for one picture on the generate page: "Show picture"
 * while it is blurred, "Blur picture" once shown. A labelled button rather
 * than a click on the picture, so it is found on a phone too.
 */
export function VeilToggle({ veiled, onChange }: { veiled: boolean; onChange: (veiled: boolean) => void }) {
  const t = useT()
  return (
    <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-xs" aria-pressed={!veiled} onClick={() => onChange(!veiled)}>
      {veiled ? <Eye className="mr-1 h-3 w-3" /> : <EyeOff className="mr-1 h-3 w-3" />}
      {veiled ? t("generate.showPicture") : t("generate.blurPicture")}
    </Button>
  )
}
