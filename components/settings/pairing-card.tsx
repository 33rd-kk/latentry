"use client"

import { useEffect, useState } from "react"
import { KeyRound, Loader2, Smartphone, Unlink, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"

interface PairedDevice {
  id: string
  name: string | null
  number: number
  pairedAt: number
  expiresAt: number
}

interface PairingState {
  enabled: boolean
  days: number
  code: { code: string; expiresAt: number } | null
  devices: PairedDevice[]
}

const DAY_MS = 24 * 60 * 60 * 1000

async function fetchState(): Promise<PairingState | null> {
  const response = await fetch("/api/settings/pairing", { cache: "no-store" })
  return response.ok ? response.json() : null
}

/**
 * Pairing a phone or another computer (see lib/security/pairing.ts): a code
 * to type on that device, the devices paired so far (each can be removed),
 * and a way to forget them all. Shown only on the computer running Latentry;
 * elsewhere the API refuses and this hides.
 */
export function PairingCard() {
  const { t, locale } = useI18n()
  const [state, setState] = useState<PairingState | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    fetchState()
      .then((data) => {
        if (alive) setState(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // While a code is on screen: the countdown, and the list read again every
  // few seconds, so a device shows up here as soon as it has used the code.
  const expiresAt = state?.code?.expiresAt ?? null
  useEffect(() => {
    if (expiresAt === null) return
    let ticks = 0
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= expiresAt) setState((s) => (s ? { ...s, code: null } : s))
      if (++ticks % 3 === 0) {
        fetchState()
          .then((data) => data && setState(data))
          .catch(() => {})
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const response = await fetch("/api/settings/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(String(response.status))
      return await response.json()
    } catch {
      toast.error(t("settings.pairingFailed"))
      return null
    } finally {
      setBusy(false)
    }
  }

  const newCode = async () => {
    const data = await post({ action: "code" })
    if (!data) return
    setNow(Date.now())
    setState((s) => (s ? { ...s, code: data.code } : s))
  }

  const remove = async (device: PairedDevice, name: string) => {
    if (!window.confirm(t("settings.pairingRemoveConfirm", { name }))) return
    const data = await post({ action: "remove", id: device.id })
    if (data) setState((s) => (s ? { ...s, devices: data.devices } : s))
  }

  const forget = async () => {
    if (!window.confirm(t("settings.pairingForgetConfirm"))) return
    const data = await post({ action: "forget" })
    if (!data) return
    setState((s) => (s ? { ...s, code: null, devices: [] } : s))
    toast.success(t("settings.pairingForgotten"))
  }

  if (!state) return null
  const code = state.code
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0
  const date = (ms: number) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(ms)

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
        <CardContent className="space-y-4">
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

          <div className="space-y-1.5">
            <p className="text-xs font-medium">{t("settings.pairingDevices", { count: state.devices.length })}</p>
            {state.devices.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("settings.pairingNone")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {state.devices.map((device) => {
                  const name = device.name ?? t("settings.pairingDevice", { number: device.number })
                  const days = Math.max(0, Math.ceil((device.expiresAt - now) / DAY_MS))
                  return (
                    <li key={device.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("settings.pairingDeviceDates", { paired: date(device.pairedAt), ends: date(device.expiresAt), days })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => void remove(device, name)}
                        disabled={busy}
                        aria-label={t("settings.pairingRemoveNamed", { name })}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        {t("settings.pairingRemove")}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void newCode()} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1.5 h-3.5 w-3.5" />}
              {code ? t("settings.pairingNewCode") : t("settings.pairingAdd")}
            </Button>
            {state.devices.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => void forget()} disabled={busy}>
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
                {t("settings.pairingForget")}
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
