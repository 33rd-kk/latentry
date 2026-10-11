"use client"

import { CheckCircle2, Loader2, Plus, Trash2, Wifi, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { problemText, UnavailableFeatures } from "@/components/generate/unavailable-features"
import { useBackendTests, type BackendTest } from "@/hooks/use-backend-tests"
import { BACKEND_KINDS, type BackendKind } from "@/lib/backends/types"
import type { ProfileId } from "@/lib/profiles"
import { emptyBackend, type BackendDraft, type ChangeDraft } from "@/lib/settings/draft"
import type { SettingsView } from "@/lib/settings/view"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { Field, FieldError, Section } from "./section"

export function BackendsSection({
  view,
  backends,
  errors,
  change,
  onUseEnv,
}: {
  view: SettingsView
  backends: BackendDraft[]
  errors: Record<string, string>
  change: ChangeDraft
  onUseEnv: () => void
}) {
  const t = useT()
  const { tests, testBackend } = useBackendTests()
  return (
    <Section title={t("settings.backendsTitle")} description={t("settings.backendsHint")} source={view.sources.backends} onUseEnv={onUseEnv}>
      <div className="space-y-3">
        {backends.map((backend, index) => (
          <BackendRow
            key={backend.key}
            backend={backend}
            index={index}
            profiles={view.builtinProfiles}
            test={tests[backend.key]}
            errors={errors}
            change={change}
            onTest={() => void testBackend(backend)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            change("backends", (current) => ({
              ...current,
              backends: [...current.backends, emptyBackend()],
            }))
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("settings.addBackend")}
        </Button>
      </div>
    </Section>
  )
}

function BackendRow({
  backend,
  index,
  profiles,
  test,
  errors,
  change,
  onTest,
}: {
  backend: BackendDraft
  index: number
  profiles: SettingsView["builtinProfiles"]
  test: BackendTest | undefined
  errors: Record<string, string>
  change: ChangeDraft
  onTest: () => void
}) {
  const t = useT()
  const update = (patch: Partial<BackendDraft>) =>
    change("backends", (current) => ({
      ...current,
      backends: current.backends.map((item) => (item.key === backend.key ? { ...item, ...patch } : item)),
    }))
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_8rem_1fr_10rem]">
        <Field label={t("settings.backendId")}>
          <Input value={backend.id} onChange={(event) => update({ id: event.target.value })} placeholder="sdxl" />
          <FieldError errors={errors} at={`backends.${index}.id`} />
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
          <FieldError errors={errors} at={`backends.${index}.url`} />
        </Field>
        <Field label={t("settings.backendProfile")}>
          <Select value={backend.profile} onValueChange={(profile) => update({ profile: profile as ProfileId })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {backend.kind === "comfyui" && (
        <Field label={t("settings.backendModel")} hint={t("settings.backendModelHint")}>
          <Input
            value={backend.model}
            onChange={(event) => update({ model: event.target.value })}
            placeholder={t("settings.backendModelFirst")}
            list={`checkpoints-${backend.key}`}
            autoComplete="off"
          />
          <datalist id={`checkpoints-${backend.key}`}>
            {(test?.checkpoints ?? []).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <FieldError errors={errors} at={`backends.${index}.model`} />
        </Field>
      )}
      {backend.kind === "comfyui" && (
        <Field label={t("settings.backendWorkflowsDir")} hint={t("settings.backendWorkflowsDirHint")}>
          <Input
            value={backend.workflowsDir}
            onChange={(event) => update({ workflowsDir: event.target.value })}
            placeholder="D:\ComfyUI\workflows"
            autoComplete="off"
          />
          <FieldError errors={errors} at={`backends.${index}.workflowsDir`} />
          {backend.workflowsDir.trim() && (
            <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <Switch checked={backend.shareWorkflows} onCheckedChange={(shareWorkflows) => update({ shareWorkflows })} />
              {t("settings.shareWorkflows")}
            </label>
          )}
        </Field>
      )}
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
                    : t(
                        backend.kind === "a1111"
                          ? "settings.tokenNoneA1111"
                          : backend.kind === "comfyui"
                            ? "settings.tokenNoneComfyui"
                            : "settings.tokenNone"
                      )
            }
          />
        </Field>
        {backend.tokenSource === "settings" && (
          <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={backend.clearToken} onCheckedChange={(clearToken) => update({ clearToken, token: "" })} />
            {t("settings.tokenClear")}
          </label>
        )}
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onTest} disabled={!backend.url}>
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
          {test.state === "ok"
            ? t("settings.testOk", { model: test.model ?? "?" })
            : test.problem
              ? problemText(t, test.problem)
              : t("settings.testFail")}
        </p>
      )}
      {test?.state === "ok" && test.hints && <UnavailableFeatures hints={test.hints} kind={backend.kind} />}
    </div>
  )
}
