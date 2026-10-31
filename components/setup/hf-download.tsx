"use client"

import { useState } from "react"
import { Download, ExternalLink, Link2, Loader2, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import type { EngineActions } from "@/hooks/use-engine-status"
import type { EngineStatus } from "@/lib/engine/status"
import { useT } from "@/lib/i18n"
import { gb } from "./log-view"

type Folder = "checkpoint" | "lora"

/** What /api/engine/models/hf found for a URL. */
interface Preview {
  url: string
  repo: string
  path: string
  fileName: string
  commit: string
  size: number
  license: string | null
  gated: boolean
  token: boolean
}

/**
 * Downloads one .safetensors file by its Hugging Face URL, next to the
 * catalog: Check shows what the URL points at, Download fetches that commit.
 * The URL stays in this component only; nothing keeps it.
 */
export function HfDownload({ status: s, actions, canDownload }: { status: EngineStatus; actions: EngineActions; canDownload: boolean }) {
  const t = useT()
  const [url, setUrl] = useState("")
  const [folder, setFolder] = useState<Folder>("checkpoint")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [starting, setStarting] = useState(false)

  const check = async () => {
    setChecking(true)
    setError(null)
    setPreview(null)
    setAccepted(false)
    const typed = url.trim()
    const response = await fetch("/api/engine/models/hf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: typed }),
    }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    if (response?.ok && payload) setPreview({ ...payload, url: typed })
    else setError(payload?.error ? t.server(payload.error) : t("setup.hf.error.unreachable"))
    setChecking(false)
  }

  const download = async () => {
    if (!preview) return
    setStarting(true)
    setError(null)
    const response = await fetch("/api/engine/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: preview.url, revision: preview.commit, folder }),
    }).catch(() => null)
    const payload = await response?.json().catch(() => null)
    if (response?.ok) {
      setUrl("")
      setPreview(null)
      setAccepted(false)
    } else setError(payload?.error ? t.server(payload.error) : t("setup.hf.error.unreachable"))
    setStarting(false)
    actions.refresh()
  }

  const downloads = s.urlDownloads ?? []
  return (
    <div className="space-y-2">
      <label htmlFor="hf-url" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
        <Link2 className="h-3.5 w-3.5" />
        {t("setup.hf.title")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="hf-url"
          value={url}
          placeholder="https://huggingface.co/owner/name/blob/main/model.safetensors"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setUrl(event.target.value)
            setPreview(null)
          }}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button size="sm" variant="secondary" disabled={!canDownload || checking || !url.trim()} onClick={() => void check()}>
          {checking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
          {t("setup.hf.check")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label={t("setup.hf.folder")}>
        <span className="text-muted-foreground">{t("setup.hf.folder")}</span>
        {(["checkpoint", "lora"] as const).map((option) => (
          <Button key={option} size="sm" variant={folder === option ? "default" : "outline"} aria-pressed={folder === option} onClick={() => setFolder(option)}>
            {t(option === "checkpoint" ? "setup.hf.checkpoint" : "setup.hf.lora")}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("setup.hf.hint")}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {preview && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium break-all">{preview.fileName}</span>
            <span className="ml-auto text-xs text-muted-foreground">{gb(preview.size)}</span>
          </div>
          <p className="text-xs break-all text-muted-foreground">
            {t("setup.hf.from", { repo: preview.repo, commit: preview.commit.slice(0, 10) })}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>{t("setup.license", { license: preview.license ?? t("setup.hf.noLicense") })}</span>
            {preview.gated && <Badge variant="destructive">{t("setup.hf.gated")}</Badge>}
            <a
              href={`https://huggingface.co/${preview.repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              {t("setup.readLicense")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {preview.gated && !preview.token && <p className="text-xs text-muted-foreground">{t("setup.hf.needToken")}</p>}
          <p className="text-xs text-muted-foreground">{t("setup.hf.unchecked")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="h-4 w-4" />
              {t("setup.accept")}
            </label>
            <Button size="sm" disabled={!accepted || !canDownload || starting} onClick={() => void download()}>
              {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              {t(folder === "lora" ? "setup.hf.downloadLora" : "setup.hf.downloadCheckpoint", { size: gb(preview.size) })}
            </Button>
          </div>
        </div>
      )}

      {downloads.map((item) => {
        const busy = item.state === "queued" || item.state === "downloading" || item.state === "verifying"
        return (
          <div key={item.id} className="space-y-1 rounded-lg border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium break-all">{item.fileName}</span>
              <Badge variant="outline">{t(item.folder === "lora" ? "setup.hf.lora" : "setup.hf.checkpoint")}</Badge>
              {item.state === "done" && <Badge variant="outline">{t("setup.downloaded")}</Badge>}
            </div>
            {busy && (
              <>
                <Progress value={item.totalBytes ? (item.doneBytes / item.totalBytes) * 100 : 0} indeterminate={!item.totalBytes} />
                <p className="text-muted-foreground">
                  {item.state === "verifying" ? t("setup.verifying") : t("setup.downloading", { done: gb(item.doneBytes), total: gb(item.totalBytes) })}
                </p>
              </>
            )}
            {item.state === "error" && <p className="text-destructive">{t("setup.downloadFailed", { error: item.error ?? "" })}</p>}
          </div>
        )
      })}
    </div>
  )
}
