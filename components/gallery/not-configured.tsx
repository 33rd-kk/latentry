"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n"

/** No gallery folder is set: how to set one. */
export function GalleryNotConfigured() {
  const t = useT()
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t("gallery.notConfiguredTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("gallery.notConfigured")}</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {"GALLERY_SAVE_DIR=./output\nGALLERY_DIRS=D:\\ComfyUI\\output;E:\\webui\\outputs\\txt2img-images"}
        </pre>
      </CardContent>
    </Card>
  )
}
