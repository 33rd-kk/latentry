"use client"

import Link from "next/link"
import { Box, Loader2, Server, SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { listProfiles, type ProfileId } from "@/lib/profiles"
import type { BackendStatus } from "@/lib/backends/types"
import type { EngineModelOption } from "@/hooks/use-engine-models"
import { useT } from "@/lib/i18n"

interface BackendPickerProps {
  backends: BackendStatus[]
  selected: BackendStatus
  onSelect: (id: string) => void
  profile: ProfileId
  onProfileChange: (profile: ProfileId) => void
  disabled?: boolean
  /**
   * When the selected backend is Latentry's own engine: the models in its
   * models folder, so the one it draws with can be changed here.
   */
  engineModels?: {
    models: EngineModelOption[]
    current: string | null
    loading: string | null
    loadError: string | null
    onLoad: (model: EngineModelOption) => void
  }
}

function StatusDot({ backend }: { backend: BackendStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        !backend.alive ? "bg-muted-foreground/40" : backend.busy ? "bg-amber-500" : "bg-emerald-500"
      )}
    />
  )
}

/**
 * Which backend draws the picture, and which model family the form is set up
 * for. The two are separate on purpose: the profile is the backend's default,
 * but a web UI with an Illustrious checkpoint loaded today and a Pony one
 * tomorrow is the same backend.
 */
export function BackendPicker({ backends, selected, onSelect, profile, onProfileChange, disabled, engineModels }: BackendPickerProps) {
  const t = useT()
  const stateLabel = !selected.alive ? t("generate.stateOffline") : selected.busy ? t("generate.stateBusy") : t("generate.stateReady")

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Server className="h-3 w-3" />
            {t("generate.backend")}
          </Label>
          <Select value={selected.id} onValueChange={onSelect} disabled={disabled || backends.length < 2}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {backends.map((backend) => (
                <SelectItem key={backend.id} value={backend.id}>
                  <span className="flex items-center gap-2">
                    <StatusDot backend={backend} />
                    <span>{backend.id}</span>
                    <span className="text-xs text-muted-foreground">{backend.kind}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="flex items-center gap-1 text-xs text-muted-foreground">
            <SlidersHorizontal className="h-3 w-3" />
            {t("generate.profile")}
          </Label>
          <Select value={profile} onValueChange={(value) => onProfileChange(value as ProfileId)} disabled={disabled}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {listProfiles().map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                  {option.id === selected.profile && <span className="ml-1 text-xs text-muted-foreground">({t("generate.profileDefault")})</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1.5">
          <StatusDot backend={selected} />
          {stateLabel}
        </Badge>
        {selected.model && !engineModels && (
          <span className="truncate" title={selected.model}>
            {t("generate.model")} <code className="font-mono">{selected.model}</code>
          </span>
        )}
      </div>
      {engineModels && <EngineModelSelect {...engineModels} disabled={disabled} />}
    </div>
  )
}

function EngineModelSelect({
  models,
  current,
  loading,
  loadError,
  onLoad,
  disabled,
}: NonNullable<BackendPickerProps["engineModels"]> & { disabled?: boolean }) {
  const t = useT()
  const value = loading ?? current ?? ""

  return (
    <div className="space-y-1">
      <Label className="flex items-center gap-1 text-xs text-muted-foreground">
        <Box className="h-3 w-3" />
        {t("generate.model")}
        {loading && (
          <span className="ml-1 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("generate.modelLoading")}
          </span>
        )}
      </Label>
      <Select
        value={value}
        onValueChange={(id) => {
          const model = models.find((option) => option.id === id)
          if (model && id !== current) onLoad(model)
        }}
        disabled={disabled || Boolean(loading) || models.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={models.length === 0 ? t("generate.modelNone") : t("generate.modelPick")} />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              <span className="truncate">{model.name}</span>
              <span className="text-xs text-muted-foreground">{model.family.toUpperCase()}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loadError && <p className="text-xs text-destructive">{t("generate.modelLoadFailed", { error: loadError })}</p>}
      <p className="text-xs text-muted-foreground">
        {t("generate.modelMore")}{" "}
        <Link href="/setup" className="underline underline-offset-2">
          {t("app.navSetup")}
        </Link>
      </p>
    </div>
  )
}
