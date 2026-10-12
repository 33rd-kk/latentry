"use client"

import { useState } from "react"
import { toast } from "sonner"
import { FolderOpen, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { post } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * Where the engine looks for models. Changing it restarts running engines,
 * which read the folder when they start.
 */
export function ModelsFolder({ status, onSaved }: { status: EngineStatus; onSaved: () => void }) {
  const t = useT()
  const [value, setValue] = useState(status.customModelsDir ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (modelsDir: string | null) => {
    setSaving(true)
    setError(null)
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: { modelsDir } }),
    })
    if (response.ok) {
      if (modelsDir === null) setValue("")
      if (status.engines.some((engine) => engine.state === "running" || engine.state === "starting")) {
        await post("/api/engine/stop")
        await post("/api/engine/start")
      }
      toast.success(t("setup.saved"))
    } else {
      const payload = await response.json().catch(() => null)
      const key = payload?.errors?.["engine.modelsDir"]
      setError(key ? t(key as MessageKey) : (payload?.error ?? `HTTP ${response.status}`))
    }
    setSaving(false)
    onSaved()
  }

  const changed = value.trim() !== (status.customModelsDir ?? "")
  return (
    <div className="space-y-2">
      <label htmlFor="models-folder" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
        <FolderOpen className="h-3.5 w-3.5" />
        {t("setup.modelsFolder")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="models-folder"
          value={value}
          placeholder={status.customModelsDir ? undefined : status.modelsDir}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button size="sm" disabled={saving || !changed || !value.trim()} onClick={() => void save(value.trim())}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {t("setup.save")}
        </Button>
        {status.customModelsDir && (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
            {t("setup.modelsFolderDefault")}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{t("setup.modelsFolderHint")}</p>
    </div>
  )
}
