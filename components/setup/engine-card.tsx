"use client"

import { Download, Loader2, Play, RotateCcw, Square, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import type { EngineActions } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT, type MessageKey } from "@/lib/i18n"
import { LogView } from "./log-view"
import { PinnedNote } from "./pinned-note"

/** Installing, starting and stopping the engine, its switches, and each engine's state and log. */
export function EngineCard({ status: s, actions }: { status: EngineStatus; actions: EngineActions }) {
  const t = useT()
  const { pending, act, saveEngineSetting } = actions
  const installing = s.install.state === "running"
  const running = s.engines.some((engine) => engine.state === "running" || engine.state === "starting")
  return (
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
          <div className="space-y-1">
            <p>
              {t("setup.installed", {
                torch: s.installed.check.torch,
                diffusers: s.installed.check.diffusers,
                device: s.installed.check.gpu ?? s.installed.check.device,
              })}
            </p>
            <PinnedNote installed={s.installed} />
          </div>
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
        <label className="flex items-start gap-2 text-xs">
          <Switch className="mt-0.5" checked={s.shareLoras} onCheckedChange={(checked) => void saveEngineSetting({ shareLoras: checked })} />
          <span>
            {t("setup.shareLoras")}
            <span className="block text-muted-foreground">{t("setup.shareLorasHint")}</span>
          </span>
        </label>

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
              {engine.version && <span className="text-xs text-muted-foreground">{t("setup.engineVersion", { version: engine.version })}</span>}
              {engine.restarts > 0 && <span className="text-xs text-muted-foreground">{t("setup.restarts", { count: engine.restarts })}</span>}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs">
                  {t("setup.log")}
                </Button>
              </CollapsibleTrigger>
            </div>
            {engine.loadError && <p className="mt-2 text-xs text-destructive">{t("setup.loadError", { error: engine.loadError })}</p>}
            {engine.version && s.engineVersion && engine.version !== s.engineVersion && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                {t("setup.engineOutdated", { running: engine.version, folder: s.engineVersion })}
              </p>
            )}
            <CollapsibleContent className="pt-2">
              <LogView lines={engine.log} />
            </CollapsibleContent>
          </Collapsible>
        ))}
      </CardContent>
    </Card>
  )
}
