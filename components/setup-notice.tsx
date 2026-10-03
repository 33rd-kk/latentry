"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n"

const EXAMPLE = `# .env.local
GEN_BACKENDS=anima|diffusers|http://localhost:7865|anima;sdxl|a1111|http://localhost:7860|illustrious
GEN_TOKEN_SDXL=user:password
GALLERY_SAVE_DIR=./output`

/** Shown instead of the form while no backend is configured. */
export function SetupNotice() {
  const t = useT()
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t("app.setupTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("app.setupBody")}</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{EXAMPLE}</pre>
        <p className="text-muted-foreground">{t("app.setupRestart")}</p>
      </CardContent>
    </Card>
  )
}
