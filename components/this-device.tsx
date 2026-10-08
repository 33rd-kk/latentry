"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Clock, Loader2, Smartphone, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"

/** What /api/pair says about the device asking (see lib/security/pairing.ts). */
type ThisDevice =
  | { local: true }
  | { paired: false }
  | { paired: true; name: string | null; number: number; pairedAt: number; expiresAt: number }

const DAY_MS = 24 * 60 * 60 * 1000
/** From this many days before its pairing ends, a device is told on every page. */
const WARN_DAYS = 3

function useThisDevice(): ThisDevice | null {
  const [device, setDevice] = useState<ThisDevice | null>(null)
  useEffect(() => {
    let alive = true
    fetch("/api/pair", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ThisDevice | null) => {
        if (alive) setDevice(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return device
}

function daysLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS))
}

/**
 * Under the header on a paired phone or computer whose pairing ends within
 * WARN_DAYS days. Nothing on this machine, or with more time left.
 */
export function PairingNotice() {
  const { t } = useI18n()
  const device = useThisDevice()
  if (!device || !("paired" in device) || !device.paired) return null
  const days = daysLeft(device.expiresAt)
  if (days > WARN_DAYS) return null
  return (
    <div className="border-t bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <p className="container mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5 text-xs">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>
          {days <= 1 ? t("pair.endsToday") : t("pair.endsSoon", { days })}{" "}
          <Link href="/pair" className="underline underline-offset-2">
            {t("pair.again")}
          </Link>
        </span>
      </p>
    </div>
  )
}

/**
 * This device's pairing, on the Settings page of a paired phone or computer:
 * the name it paired as, when that ends, and a way to unpair it.
 */
export function ThisDeviceCard() {
  const { t, locale } = useI18n()
  const device = useThisDevice()
  const [busy, setBusy] = useState(false)
  if (!device || !("paired" in device) || !device.paired) return null

  const date = (ms: number) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(ms)
  const name = device.name ?? t("settings.pairingDevice", { number: device.number })

  const unpair = async () => {
    if (!window.confirm(t("pair.unpairConfirm"))) return
    setBusy(true)
    await fetch("/api/pair", { method: "DELETE" }).catch(() => null)
    window.location.replace("/pair")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4" />
          {t("pair.thisDevice")}
        </CardTitle>
        <CardDescription>
          {t("pair.pairedAs", { name, date: date(device.pairedAt) })}{" "}
          {t("pair.endsOn", { date: date(device.expiresAt), days: daysLeft(device.expiresAt) })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" size="sm" variant="outline" onClick={unpair} disabled={busy}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Unlink className="mr-1.5 h-3.5 w-3.5" />}
          {t("pair.unpair")}
        </Button>
      </CardContent>
    </Card>
  )
}
