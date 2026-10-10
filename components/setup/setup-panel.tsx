"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Cpu, Download, ExternalLink, FolderOpen, Loader2, Play, RotateCcw, Square, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import type { CatalogView, EngineStatus } from "@/lib/engine/status"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Refused = { editable: false; reason: "off" | "notLocal" }

const POLL_BUSY_MS = 1500
const POLL_IDLE_MS = 5000

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1)} GB`
}

async function post(path: string, body: unknown = {}): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (response.ok) return { ok: true }
  const payload = await response.json().catch(() => null)
  return { ok: false, error: payload?.error ?? `HTTP ${response.status}` }
}

function LogView({ lines, className }: { lines: string[]; className?: string }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const element = ref.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines])
  return (
    <pre ref={ref} className={cn("max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap", className)}>
      {lines.join("\n") || "…"}
    </pre>
  )
}

function CatalogItem({
  entry,
  canDownload,
  onDownload,
  onUse,
}: {
  entry: CatalogView
  canDownload: boolean
  onDownload: (entry: CatalogView) => void
  onUse?: (entry: CatalogView) => void
}) {
  const t = useT()
  const [accepted, setAccepted] = useState(false)
  const download = entry.download
  const busy = download?.state === "downloading" || download?.state === "queued" || download?.state === "verifying"
  const percent = download && download.totalBytes ? (download.doneBytes / download.totalBytes) * 100 : 0

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{entry.name}</span>
        {entry.recommended && <Badge variant="secondary">{t("setup.recommended")}</Badge>}
        {entry.inUse && <Badge>{t("setup.inUse")}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{gb(entry.bytes)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>{t("setup.license", { license: entry.license })}</span>
        <Badge variant={entry.commercialOutputs ? "outline" : "destructive"}>
          {t(entry.commercialOutputs ? "setup.commercialYes" : "setup.commercialNo")}
        </Badge>
        <a href={entry.licenseUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
          {t("setup.readLicense")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">{entry.terms}</p>

      {busy && download ? (
        <div className="space-y-1">
          <Progress value={percent} indeterminate={!download.totalBytes} />
          <p className="text-xs text-muted-foreground">
            {download.state === "verifying"
              ? t("setup.verifying")
              : t("setup.downloading", { done: gb(download.doneBytes), total: gb(download.totalBytes || entry.bytes) })}
          </p>
        </div>
      ) : entry.installed ? (
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{t("setup.downloaded")}</Badge>
          {onUse && !entry.inUse && (
            <Button size="sm" variant="secondary" onClick={() => onUse(entry)}>
              {t("setup.use")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="h-4 w-4" />
            {t("setup.accept")}
          </label>
          <Button size="sm" disabled={!accepted || !canDownload} onClick={() => onDownload(entry)}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("setup.download", { size: gb(entry.bytes) })}
          </Button>
        </div>
      )}
      {download?.state === "error" && <p className="text-xs text-destructive">{t("setup.downloadFailed", { error: download.error ?? "" })}</p>}
    </div>
  )
}

/**
 * Where the engine looks for models. Changing it restarts running engines,
 * which read the folder when they start.
 */
function ModelsFolder({ status, onSaved }: { status: EngineStatus; onSaved: () => void }) {
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

export function SetupPanel() {
  const t = useT()
  const [status, setStatus] = useState<EngineStatus | Refused | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const refresh = useCallback(() => {
    fetch("/api/engine", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setStatus(data)
      })
      .catch(() => {
        // Restarting; the next poll tries again.
      })
  }, [])

  const engineStatus = status && status.editable ? status : null
  const busy = Boolean(
    engineStatus &&
      (engineStatus.install.state === "running" ||
        engineStatus.engines.some((engine) => engine.state === "starting" || engine.loading) ||
        engineStatus.catalog.some((entry) => ["queued", "downloading", "verifying"].includes(entry.download?.state ?? "")))
  )

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, busy ? POLL_BUSY_MS : POLL_IDLE_MS)
    return () => clearInterval(timer)
  }, [refresh, busy])

  const act = useCallback(
    async (key: string, path: string, body?: unknown) => {
      setPending(key)
      const result = await post(path, body)
      setPending(null)
      if (!result.ok) toast.error(t("setup.failed", { error: result.error ?? "" }))
      refresh()
    },
    [refresh, t]
  )

  const saveEngineSetting = useCallback(
    async (engine: Record<string, unknown>) => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine }),
      })
      if (!response.ok) toast.error(t("setup.failed", { error: `HTTP ${response.status}` }))
      refresh()
    },
    [refresh, t]
  )

  const chooseTagger = useCallback(
    async (entry: CatalogView) => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wd14: { modelDir: entry.dir } }),
      })
      if (!response.ok) toast.error(t("setup.failed", { error: `HTTP ${response.status}` }))
      refresh()
    },
    [refresh, t]
  )

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("app.loading")}
      </div>
    )
  }
  if (!status.editable) {
    return <p className="text-sm text-muted-foreground">{t(status.reason === "off" ? "setup.readOnly" : "setup.notLocal")}</p>
  }

  const s = status
  const installing = s.install.state === "running"
  const running = s.engines.some((engine) => engine.state === "running" || engine.state === "starting")
  const engineUp = s.engines.some((engine) => engine.state === "running")
  const checkpoints = s.catalog.filter((entry) => entry.kind === "checkpoint")
  const taggers = s.catalog.filter((entry) => entry.kind === "tagger")

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("setup.title")}</h1>
        <p className="text-sm break-all text-muted-foreground">{t("setup.intro", { dir: s.runtimeDir })}</p>
      </div>

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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            {t("setup.engine")}
          </CardTitle>
          <CardDescription>{t("setup.engineBody")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {s.installed && !installing && (
            <p>
              {t("setup.installed", {
                torch: s.installed.check.torch,
                diffusers: s.installed.check.diffusers,
                device: s.installed.check.gpu ?? s.installed.check.device,
              })}
            </p>
          )}

          {installing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {s.install.step ? t(`setup.steps.${s.install.step}` as MessageKey) : t("setup.installing")}
              </div>
              <Progress indeterminate />
              <LogView lines={s.install.log} />
            </div>
          )}
          {s.install.state === "error" && (
            <div className="space-y-2">
              <p className="text-destructive">{t("setup.installFailed", { error: s.install.error ?? "" })}</p>
              <LogView lines={s.install.log} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!s.installed ? (
              <Button disabled={installing || pending !== null} onClick={() => void act("install", "/api/engine/install")}>
                {installing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                {t(installing ? "setup.installing" : "setup.install")}
              </Button>
            ) : (
              <>
                {running ? (
                  <Button variant="secondary" disabled={pending !== null} onClick={() => void act("stop", "/api/engine/stop")}>
                    <Square className="mr-1.5 h-4 w-4" />
                    {t("setup.stop")}
                  </Button>
                ) : (
                  <Button disabled={pending !== null || installing} onClick={() => void act("start", "/api/engine/start")}>
                    <Play className="mr-1.5 h-4 w-4" />
                    {t("setup.start")}
                  </Button>
                )}
                <Button variant="ghost" disabled={installing || pending !== null} onClick={() => void act("install", "/api/engine/install")}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {t("setup.reinstall")}
                </Button>
              </>
            )}
            <label className="ml-auto flex items-center gap-2 text-xs">
              <Switch checked={s.autoStart} onCheckedChange={(checked) => void saveEngineSetting({ autoStart: checked })} />
              {t("setup.autoStart")}
            </label>
          </div>

          {s.engines.map((engine) => (
            <Collapsible key={engine.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{engine.id}</span>
                <Badge variant={engine.state === "running" ? "secondary" : engine.state === "crashed" ? "destructive" : "outline"}>
                  {t(`setup.states.${engine.state}` as MessageKey)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {[engine.gpu, t("setup.port", { port: engine.port })].filter(Boolean).join(" · ")}
                </span>
                <span className="text-xs">
                  {engine.loading ? t("setup.loadingModel", { model: engine.loading }) : (engine.model ?? t("setup.noModel"))}
                </span>
                {engine.restarts > 0 && <span className="text-xs text-muted-foreground">{t("setup.restarts", { count: engine.restarts })}</span>}
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs">
                    {t("setup.log")}
                  </Button>
                </CollapsibleTrigger>
              </div>
              {engine.loadError && <p className="mt-2 text-xs text-destructive">{t("setup.loadError", { error: engine.loadError })}</p>}
              <CollapsibleContent className="pt-2">
                <LogView lines={engine.log} />
              </CollapsibleContent>
            </Collapsible>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("setup.models")}</CardTitle>
          <CardDescription className="break-all">{t("setup.modelsBody", { dir: s.modelsDir })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {s.installed && <ModelsFolder status={s} onSaved={refresh} />}
          {!engineUp && s.installed && <p className="text-muted-foreground">{t("setup.needEngine")}</p>}
          {s.models && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("setup.inFolder")}</h3>
              {s.models.length === 0 && <p className="text-muted-foreground">{t("setup.emptyFolder")}</p>}
              {s.models.map((model) => {
                const loading = s.engines.some((engine) => engine.loading === model.id)
                return (
                  <div key={model.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                    <span className="font-medium">{model.name}</span>
                    {model.family && <Badge variant="outline">{model.family.toUpperCase()}</Badge>}
                    <span className="text-xs text-muted-foreground">{gb(model.sizeBytes)}</span>
                    <span className="ml-auto">
                      {!model.family ? (
                        <span className="text-xs text-muted-foreground">{t("setup.unsupported")}</span>
                      ) : s.current === model.id ? (
                        <Badge>{t("setup.loaded")}</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={loading || pending !== null}
                          onClick={() => void act(`load:${model.id}`, "/api/engine/models/load", { id: model.id })}
                        >
                          {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                          {t("setup.load")}
                        </Button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("setup.available")}</h3>
            {checkpoints.map((entry) => (
              <CatalogItem
                key={entry.id}
                entry={entry}
                canDownload={engineUp}
                onDownload={(item) => void act(`download:${item.id}`, "/api/engine/models/download", { id: item.id })}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("setup.tagger")}</CardTitle>
          <CardDescription>{t("setup.taggerBody")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {taggers.map((entry) => (
            <CatalogItem
              key={entry.id}
              entry={entry}
              canDownload
              onDownload={(item) => void act(`download:${item.id}`, "/api/engine/models/download", { id: item.id })}
              onUse={(item) => void chooseTagger(item)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
