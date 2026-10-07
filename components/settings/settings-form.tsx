"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { CheckCircle2, Loader2, Plus, RotateCcw, Save, Trash2, Wifi, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { BACKEND_KINDS, type BackendKind } from "@/lib/backends/types"
import { setProfileOverrides, type ProfileId } from "@/lib/profiles"
import { TAG_STYLES } from "@/lib/tags"
import type { SettingsView } from "@/lib/settings/view"
import { cn } from "@/lib/utils"
import { useT, type MessageKey } from "@/lib/i18n"

type Source = "settings" | "env"
type Part = "backends" | "tagger" | "wd14" | "gallery" | "profiles"

interface BackendDraft {
  /** Stable React key; the id itself is editable. */
  key: string
  id: string
  kind: BackendKind
  url: string
  profile: ProfileId
  /** What is typed; "" with `clearToken` false means "keep the current one". */
  token: string
  clearToken: boolean
  tokenSource: Source | null
}

type ProfileDraft = Record<"width" | "height" | "steps" | "cfg" | "negativePrompt" | "qualityTags" | "artistTemplate" | "tagStyle" | "keepTags", string>

interface Draft {
  backends: BackendDraft[]
  tagger: string
  wd14Dir: string
  wd14General: string
  wd14Character: string
  saveDir: string
  dirs: string[]
  autoTag: boolean
  profiles: Partial<Record<ProfileId, ProfileDraft>>
}

const AUTO = "__auto__"
const BUILTIN = "builtin"
const PROFILE_FIELDS: (keyof ProfileDraft)[] = ["width", "height", "steps", "cfg", "negativePrompt", "qualityTags", "artistTemplate", "tagStyle", "keepTags"]

let nextKey = 0
const newKey = () => `b${(nextKey += 1)}`

function toDraft(view: SettingsView): Draft {
  const profiles: Draft["profiles"] = {}
  for (const builtin of view.builtinProfiles) {
    const override = view.profiles[builtin.id] ?? {}
    profiles[builtin.id] = Object.fromEntries(
      PROFILE_FIELDS.map((field) => {
        const value = override[field]
        // "-" stands for "none": no artist field, or no tags kept from respelling.
        return [field, value === undefined ? "" : value === null || (field === "keepTags" && value === "") ? "-" : String(value)]
      })
    ) as ProfileDraft
  }
  return {
    backends: view.backends.map((backend) => ({
      key: newKey(),
      id: backend.id,
      kind: backend.kind,
      url: backend.url,
      profile: backend.profile,
      token: "",
      clearToken: false,
      tokenSource: backend.token,
    })),
    tagger: view.tagger ?? AUTO,
    wd14Dir: view.wd14.modelDir ?? "",
    // Thresholds show as typed only when they differ from the defaults.
    wd14General: view.wd14.general === view.wd14.defaults.general ? "" : String(view.wd14.general),
    wd14Character: view.wd14.character === view.wd14.defaults.character ? "" : String(view.wd14.character),
    saveDir: view.gallery.saveDir ?? "",
    dirs: view.gallery.dirs,
    autoTag: view.gallery.autoTag,
    profiles,
  }
}

/** The JSON the API takes for the parts that changed. */
function toInput(draft: Draft, dirty: Set<Part>) {
  const body: Record<string, unknown> = {}
  if (dirty.has("backends")) {
    body.backends = draft.backends.map((backend) => ({
      id: backend.id,
      kind: backend.kind,
      url: backend.url,
      profile: backend.profile,
      // Write-only: a typed value sets it, "clear" empties it, nothing keeps it.
      ...(backend.clearToken ? { token: "" } : backend.token ? { token: backend.token } : {}),
    }))
  }
  if (dirty.has("tagger")) body.tagger = draft.tagger === AUTO ? null : draft.tagger
  if (dirty.has("wd14")) {
    body.wd14 = {
      modelDir: draft.wd14Dir.trim() || null,
      ...(draft.wd14General.trim() ? { general: Number(draft.wd14General) } : {}),
      ...(draft.wd14Character.trim() ? { character: Number(draft.wd14Character) } : {}),
    }
  }
  if (dirty.has("gallery")) {
    body.gallery = { saveDir: draft.saveDir.trim() || null, dirs: draft.dirs.map((dir) => dir.trim()).filter(Boolean), autoTag: draft.autoTag }
  }
  if (dirty.has("profiles")) {
    const profiles: Record<string, Record<string, unknown>> = {}
    for (const [id, fields] of Object.entries(draft.profiles)) {
      const out: Record<string, unknown> = {}
      for (const field of PROFILE_FIELDS) {
        const value = fields![field].trim()
        if (!value) continue
        if (field === "artistTemplate") out[field] = value === "-" ? null : value
        else if (field === "keepTags") out[field] = value === "-" ? "" : fields![field]
        else if (field === "tagStyle") out[field] = value
        else if (field === "negativePrompt" || field === "qualityTags") out[field] = fields![field]
        else out[field] = Number(value)
      }
      if (Object.keys(out).length) profiles[id] = out
    }
    body.profiles = profiles
  }
  return body
}

export function SettingsForm() {
  const t = useT()
  const [view, setView] = useState<SettingsView | { editable: false; reason: "off" | "notLocal" } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState<Set<Part>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [tests, setTests] = useState<Record<string, { state: "testing" | "ok" | "fail"; model?: string | null }>>({})

  const load = useCallback(async () => {
    const response = await fetch("/api/settings", { cache: "no-store" })
    const data = await response.json()
    setView(data)
    if (data.editable) {
      setDraft(toDraft(data))
      setDirty(new Set())
      setErrors({})
    }
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect -- the settings live on the server;
     fetching them on mount is the synchronisation, and every setState happens after the
     response arrives. */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable react-hooks/set-state-in-effect */

  const change = useCallback((part: Part, update: (draft: Draft) => Draft) => {
    setDraft((current) => (current ? update(current) : current))
    setDirty((current) => new Set(current).add(part))
  }, [])

  const editable = view !== null && view.editable
  const settingsView = editable ? (view as SettingsView) : null
  const backendIds = useMemo(() => (draft?.backends ?? []).map((backend) => backend.id).filter(Boolean), [draft])

  const save = useCallback(
    async (override?: Record<string, unknown>) => {
      if (!draft) return
      setSaving(true)
      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(override ?? toInput(draft, dirty)),
        })
        const data = await response.json().catch(() => null)
        if (response.status === 422 && data?.errors) {
          setErrors(data.errors)
          toast.error(t("settings.invalid"))
          return
        }
        if (!response.ok) throw new Error(data?.error ?? String(response.status))
        setView(data)
        setDraft(toDraft(data))
        setDirty(new Set())
        setErrors({})
        // So the generate page, open in another tab, picks the new defaults up
        // on its next poll; this tab already has them.
        setProfileOverrides(data.profiles)
        toast(t("settings.saved"))
      } catch (error) {
        toast.error(t("settings.saveFailed"), { description: error instanceof Error ? error.message : undefined })
      } finally {
        setSaving(false)
      }
    },
    [draft, dirty, t]
  )

  const testBackend = useCallback(
    async (backend: BackendDraft) => {
      setTests((current) => ({ ...current, [backend.key]: { state: "testing" } }))
      try {
        const response = await fetch("/api/settings/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: backend.id, kind: backend.kind, url: backend.url, token: backend.token || undefined, profile: backend.profile }),
        })
        const data = await response.json().catch(() => null)
        setTests((current) => ({ ...current, [backend.key]: { state: data?.alive ? "ok" : "fail", model: data?.model } }))
      } catch {
        setTests((current) => ({ ...current, [backend.key]: { state: "fail" } }))
      }
    },
    []
  )

  if (view === null) {
    return (
      <p className="flex items-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("app.loading")}
      </p>
    )
  }

  if (!view.editable) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>{t("settings.title")}</CardTitle>
          <CardDescription>{t(view.reason === "off" ? "settings.lockedOff" : "settings.lockedRemote")}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!draft || !settingsView) return null
  const error = (key: string) => (errors[key] ? <p className="text-xs text-destructive">{t(errors[key] as MessageKey)}</p> : null)

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.intro", { file: settingsView.file })}</p>
      </div>

      {/* ── Backends ── */}
      <Section
        title={t("settings.backendsTitle")}
        description={t("settings.backendsHint")}
        source={settingsView.sources.backends}
        onUseEnv={() => void save({ backends: null })}
      >
        <div className="space-y-3">
          {draft.backends.map((backend, index) => {
            const test = tests[backend.key]
            const update = (patch: Partial<BackendDraft>) =>
              change("backends", (current) => ({
                ...current,
                backends: current.backends.map((item) => (item.key === backend.key ? { ...item, ...patch } : item)),
              }))
            return (
              <div key={backend.key} className="space-y-2 rounded-lg border p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_8rem_1fr_10rem]">
                  <Field label={t("settings.backendId")}>
                    <Input value={backend.id} onChange={(event) => update({ id: event.target.value })} placeholder="sdxl" />
                    {error(`backends.${index}.id`)}
                  </Field>
                  <Field label={t("settings.backendKind")}>
                    <Select value={backend.kind} onValueChange={(kind) => update({ kind: kind as BackendKind })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BACKEND_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {kind}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("settings.backendUrl")}>
                    <Input value={backend.url} onChange={(event) => update({ url: event.target.value })} placeholder="http://localhost:7860" />
                    {error(`backends.${index}.url`)}
                  </Field>
                  <Field label={t("settings.backendProfile")}>
                    <Select value={backend.profile} onValueChange={(profile) => update({ profile: profile as ProfileId })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {settingsView.builtinProfiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t("settings.backendToken")} className="min-w-56 flex-1">
                    <Input
                      type="password"
                      autoComplete="off"
                      value={backend.token}
                      disabled={backend.clearToken}
                      onChange={(event) => update({ token: event.target.value })}
                      placeholder={
                        backend.clearToken
                          ? t("settings.tokenWillClear")
                          : backend.tokenSource === "settings"
                            ? t("settings.tokenKept")
                            : backend.tokenSource === "env"
                              ? t("settings.tokenFromEnv", { name: `GEN_TOKEN_${backend.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` })
                              : t(backend.kind === "a1111" ? "settings.tokenNoneA1111" : "settings.tokenNone")
                      }
                    />
                  </Field>
                  {backend.tokenSource === "settings" && (
                    <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                      <Switch checked={backend.clearToken} onCheckedChange={(clearToken) => update({ clearToken, token: "" })} />
                      {t("settings.tokenClear")}
                    </label>
                  )}
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void testBackend(backend)} disabled={!backend.url}>
                    {test?.state === "testing" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wifi className="mr-1 h-4 w-4" />}
                    {t("settings.test")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={t("settings.remove")}
                    onClick={() => change("backends", (current) => ({ ...current, backends: current.backends.filter((item) => item.key !== backend.key) }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {test && test.state !== "testing" && (
                  <p className={cn("flex items-center gap-1 text-xs", test.state === "ok" ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>
                    {test.state === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {test.state === "ok" ? t("settings.testOk", { model: test.model ?? "?" }) : t("settings.testFail")}
                  </p>
                )}
              </div>
            )
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              change("backends", (current) => ({
                ...current,
                backends: [
                  ...current.backends,
                  { key: newKey(), id: "", kind: "a1111", url: "", profile: "sdxl", token: "", clearToken: false, tokenSource: null },
                ],
              }))
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("settings.addBackend")}
          </Button>
        </div>
      </Section>

      {/* ── WD14 tagging ── */}
      <Section
        title={t("settings.taggerTitle")}
        description={t("settings.taggerHint")}
        source={settingsView.sources.wd14 === "settings" || settingsView.sources.tagger === "settings" ? "settings" : "env"}
        onUseEnv={() => void save({ wd14: null, tagger: null })}
      >
        <div className="space-y-4">
          <div className="max-w-sm space-y-1">
            <Label>{t("settings.tagger")}</Label>
            <Select value={draft.tagger} onValueChange={(tagger) => change("tagger", (current) => ({ ...current, tagger }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t("settings.taggerAuto")}</SelectItem>
                <SelectItem value={BUILTIN}>{t("settings.taggerBuiltin")}</SelectItem>
                {backendIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t("settings.taggerBackend", { id })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error("tagger")}
          </div>
          <Field label={t("settings.wd14Dir")} hint={t("settings.wd14DirHint")}>
            <Input
              value={draft.wd14Dir}
              onChange={(event) => change("wd14", (current) => ({ ...current, wd14Dir: event.target.value }))}
              placeholder={t("settings.wd14DirOff")}
              className="font-mono text-xs"
            />
            {error("wd14.modelDir")}
            {!dirty.has("wd14") && settingsView.wd14.modelDir && (
              <p className={cn("flex items-center gap-1 text-xs", settingsView.wd14.found ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>
                {settingsView.wd14.found ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {t(settingsView.wd14.found ? "settings.wd14Found" : "settings.wd14Missing")}
              </p>
            )}
          </Field>
          <div className="grid max-w-sm grid-cols-2 gap-2">
            {(["general", "character"] as const).map((field) => (
              <Field key={field} label={t(field === "general" ? "settings.wd14General" : "settings.wd14Character")}>
                <Input
                  inputMode="decimal"
                  value={field === "general" ? draft.wd14General : draft.wd14Character}
                  placeholder={String(settingsView.wd14.defaults[field])}
                  onChange={(event) =>
                    change("wd14", (current) => ({ ...current, [field === "general" ? "wd14General" : "wd14Character"]: event.target.value }))
                  }
                />
                {error(`wd14.${field}`)}
              </Field>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Gallery ── */}
      <Section
        title={t("settings.galleryTitle")}
        description={t("settings.galleryHint")}
        source={settingsView.sources.saveDir === "settings" || settingsView.sources.dirs === "settings" ? "settings" : "env"}
        onUseEnv={() => void save({ gallery: null })}
      >
        <div className="space-y-4">
          <Field label={t("settings.saveDir")} hint={t("settings.saveDirHint")}>
            <Input
              value={draft.saveDir}
              onChange={(event) => change("gallery", (current) => ({ ...current, saveDir: event.target.value }))}
              placeholder={t("settings.saveDirOff")}
              className="font-mono text-xs"
            />
            {error("gallery.saveDir")}
          </Field>
          <div className="space-y-2">
            <Label>{t("settings.readDirs")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.readDirsHint")}</p>
            {draft.dirs.map((dir, index) => (
              <div key={index} className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    value={dir}
                    onChange={(event) =>
                      change("gallery", (current) => ({ ...current, dirs: current.dirs.map((item, i) => (i === index ? event.target.value : item)) }))
                    }
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.remove")}
                    onClick={() => change("gallery", (current) => ({ ...current, dirs: current.dirs.filter((_, i) => i !== index) }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {error(`gallery.dirs.${index}`)}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => change("gallery", (current) => ({ ...current, dirs: [...current.dirs, ""] }))}>
              <Plus className="mr-1 h-4 w-4" />
              {t("settings.addDir")}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.autoTag} onCheckedChange={(autoTag) => change("gallery", (current) => ({ ...current, autoTag }))} />
            {t("settings.autoTag")}
          </label>
        </div>
      </Section>

      {/* ── Profiles ── */}
      <Section title={t("settings.profilesTitle")} description={t("settings.profilesHint")} source={null}>
        <div className="space-y-4">
          {settingsView.builtinProfiles.map((builtin) => {
            const fields = draft.profiles[builtin.id]!
            const set = (field: keyof ProfileDraft, value: string) =>
              change("profiles", (current) => ({ ...current, profiles: { ...current.profiles, [builtin.id]: { ...current.profiles[builtin.id]!, [field]: value } } }))
            const changed = PROFILE_FIELDS.some((field) => fields[field].trim())
            const at = (field: string) => `profiles.${builtin.id}.${field}`
            return (
              <div key={builtin.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {builtin.label}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{t("settings.sizeMultiple", { multiple: builtin.sizeMultiple })}</span>
                  </p>
                  {changed && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        change("profiles", (current) => ({
                          ...current,
                          profiles: { ...current.profiles, [builtin.id]: Object.fromEntries(PROFILE_FIELDS.map((field) => [field, ""])) as ProfileDraft },
                        }))
                      }
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      {t("settings.profileReset")}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["width", "height", "steps", "cfg"] as const).map((field) => (
                    <Field key={field} label={t(`settings.profile.${field}`)}>
                      <Input inputMode="decimal" value={fields[field]} placeholder={String(builtin[field])} onChange={(event) => set(field, event.target.value)} />
                      {error(at(field))}
                    </Field>
                  ))}
                </div>
                <Field label={t("settings.profile.negativePrompt")}>
                  <Textarea rows={2} value={fields.negativePrompt} placeholder={builtin.negativePrompt} onChange={(event) => set("negativePrompt", event.target.value)} />
                  {error(at("negativePrompt"))}
                </Field>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label={t("settings.profile.qualityTags")}>
                    <Input value={fields.qualityTags} placeholder={builtin.qualityTags || t("settings.none")} onChange={(event) => set("qualityTags", event.target.value)} />
                    {error(at("qualityTags"))}
                  </Field>
                  <Field label={t("settings.profile.artistTemplate")} hint={t("settings.artistTemplateHint")}>
                    <Input value={fields.artistTemplate} placeholder={builtin.artistTemplate ?? "-"} onChange={(event) => set("artistTemplate", event.target.value)} />
                    {error(at("artistTemplate"))}
                  </Field>
                  <Field label={t("settings.profile.tagStyle")} hint={t("settings.tagStyleHint")}>
                    <Select value={fields.tagStyle || BUILTIN} onValueChange={(value) => set("tagStyle", value === BUILTIN ? "" : value)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={BUILTIN}>{t("settings.tagStyleBuiltin", { style: t(`settings.tagStyles.${builtin.tagStyle}`) })}</SelectItem>
                        {TAG_STYLES.map((style) => (
                          <SelectItem key={style} value={style}>
                            {t(`settings.tagStyles.${style}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {error(at("tagStyle"))}
                  </Field>
                  <Field label={t("settings.profile.keepTags")} hint={t("settings.keepTagsHint")}>
                    <Input value={fields.keepTags} placeholder={builtin.keepTags || "-"} onChange={(event) => set("keepTags", event.target.value)} />
                    {error(at("keepTags"))}
                  </Field>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-4 py-3">
          {dirty.size > 0 && <span className="mr-auto text-xs text-muted-foreground">{t("settings.unsaved")}</span>}
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={saving || dirty.size === 0}>
            {t("settings.discard")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || dirty.size === 0}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {t("settings.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Section({
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

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
