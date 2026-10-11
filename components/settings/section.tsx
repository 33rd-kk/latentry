"use client"

import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import type { Source } from "@/lib/settings/draft"
import { cn } from "@/lib/utils"
import { useT, type MessageKey } from "@/lib/i18n"

/** A settings card, with where its values come from and a way back to .env.local. */
export function Section({
  title,
  description,
  source,
  onUseEnv,
  children,
}: {
  title: string
  description: string
  source: Source | null
  onUseEnv?: () => void
  children: ReactNode
}) {
  const t = useT()
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {source && <Badge variant="outline">{t(source === "settings" ? "settings.fromSettings" : "settings.fromEnv")}</Badge>}
          {source === "settings" && onUseEnv && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={onUseEnv}>
              {t("settings.useEnv")}
            </Button>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** The server's complaint about the field at `at`, if it has one. */
export function FieldError({ errors, at }: { errors: Record<string, string>; at: string }) {
  const t = useT()
  return errors[at] ? <p className="text-xs text-destructive">{t(errors[at] as MessageKey)}</p> : null
}
