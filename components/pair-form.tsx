"use client"

import { useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n"

/**
 * Pairs a phone or another computer: the code from the Settings page on the
 * computer running Latentry, typed here (see lib/security/pairing.ts).
 */
export function PairForm() {
  const t = useT()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name }),
      })
      if (response.ok) {
        window.location.replace("/")
        return
      }
      const data = await response.json().catch(() => null)
      setError(data?.error ? t.server(data.error) : t("generate.requestFailed", { status: response.status }))
    } catch {
      setError(t("generate.unreachable"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t("pair.title")}
        </CardTitle>
        <CardDescription>{t("pair.hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pair-code">{t("pair.code")}</Label>
            <Input
              id="pair-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={16}
              placeholder="ABCD-EFGH"
              className="font-mono text-lg tracking-widest"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pair-name">{t("pair.name")}</Label>
            <Input
              id="pair-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              maxLength={40}
              placeholder={t("pair.namePlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("pair.nameHint")}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || code.trim().length < 8}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("pair.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
