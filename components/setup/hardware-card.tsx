"use client"

import { Cpu } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The GPUs found and the PyTorch build chosen for them. */
export function HardwareCard({ status: s }: { status: EngineStatus }) {
  const t = useT()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          {t("setup.hardware")}
        </CardTitle>
        <CardDescription>{s.platform}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {s.gpus.length ? (
          s.gpus.map((gpu) => (
            <p key={gpu.index}>
              {t("setup.gpu", { index: gpu.index, name: gpu.name, vram: (gpu.vramMiB / 1024).toFixed(0), driver: gpu.driver ?? "?" })}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground">{t("setup.noGpu")}</p>
        )}
        <p className={cn(s.torch.label.startsWith("unsupported") && "text-destructive")}>{t("setup.torch", { label: s.torch.label })}</p>
        {s.torch.outdated && <p className="text-xs text-amber-600 dark:text-amber-500">{t("setup.torchOutdated")}</p>}
      </CardContent>
    </Card>
  )
}
