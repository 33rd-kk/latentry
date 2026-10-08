"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2, Smartphone, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useT } from "@/lib/i18n"

interface PairingState {
  enabled: boolean
  days: number
  code: { code: string; expiresAt: number } | null
}

/**
 * Pairing a phone or another computer (see lib/security/pairing.ts): a code
 * to type on that device, and a way to forget every device. Shown only on
 * the computer running Latentry; elsewhere the API refuses and this hides.
 */
export function PairingCard() {
  const t = useT()
  const [state, setState] = useState<PairingState | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    fetch("/api/settings/pairing", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: PairingState | null) => {
        if (alive) setState(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // The countdown, and the code dropped once it has expired.
  const expiresAt = state?.code?.expiresAt ?? null
  useEffect(() => {
    if (expiresAt === null) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= expiresAt) setState((s) => (s ? { ...s, code: null } : s))
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  const act = async (action: "code" | "forget") => {
    setBusy(true)
    try {
      const response = await fetch("/api/settings/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error(String(response.status))
      if (action === "code") {
        const data = await response.json()
        setNow(Date.now())
        setState((s) => (s ? { ...s, code: data.code } : s))
      } else {
        setState((s) => (s ? { ...s, code: null } : s))
        toast.success(t("settings.pairingForgotten"))
      }
    } catch {
      toast.error(t("settings.pairingFailed"))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  const code = state.code
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4" />
          {t("settings.pairingTitle")}
        </CardTitle>
        <CardDescription>
          {state.enabled ? t("settings.pairingHint", { days: state.days }) : t("settings.pairingOff")}
        </CardDescription>
      </CardHeader>
      {state.enabled && (
        <CardContent className="space-y-3">
          {code && (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="font-mono text-2xl font-semibold tracking-[0.3em]">
                {code.code.slice(0, 4)}-{code.code.slice(4)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.pairingCodeHint", { minutes: Math.floor(left / 60), seconds: String(left % 60).padStart(2, "0") })}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => act("code")} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1.5 h-3.5 w-3.5" />}
              {code ? t("settings.pairingNewCode") : t("settings.pairingAdd")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (window.confirm(t("settings.pairingForgetConfirm"))) void act("forget")
              }}
              disabled={busy}
            >
              <Unlink className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.pairingForget")}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
