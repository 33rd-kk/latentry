"use client"

import { Server, SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { listProfiles, type ProfileId } from "@/lib/profiles"
import type { BackendStatus } from "@/lib/backends/types"
import { useT } from "@/lib/i18n"

interface BackendPickerProps {
  backends: BackendStatus[]
  selected: BackendStatus
  onSelect: (id: string) => void
  profile: ProfileId
  onProfileChange: (profile: ProfileId) => void
  disabled?: boolean
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
export function BackendPicker({ backends, selected, onSelect, profile, onProfileChange, disabled }: BackendPickerProps) {
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
        {selected.model && (
          <span className="truncate" title={selected.model}>
            {t("generate.model")} <code className="font-mono">{selected.model}</code>
          </span>
        )}
      </div>
    </div>
  )
}
