"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ModelInfoDetails, ModelInfoEditor, modelInfoSummary } from "@/components/model-info"
import { useBackends } from "@/hooks/use-backends"
import { useEngineModels } from "@/hooks/use-engine-models"
import { deleteModelInfo, listModelInfo, putModelInfo, type ModelInfoDraft } from "@/lib/models/client"
import type { ModelInfo } from "@/lib/models/info"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { useT } from "@/lib/i18n"
import { Field, Section } from "./section"

const sorted = (list: Record<string, ModelInfo> | null) => (list ? Object.values(list).sort((a, b) => a.name.localeCompare(b.name)) : [])

/**
 * Every model's info, including models that are not loaded: the generate
 * page only reaches the selected one. Saved at once, apart from the page's
 * Save button, like Devices.
 */
export function ModelsSection() {
  const t = useT()
  const id = useId()
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  // The model whose editor is open, by file name.
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState("")

  const load = useCallback(async () => setModels(sorted(await listModelInfo())), [])
  useEffect(() => {
    let live = true
    void listModelInfo().then((list) => {
      if (live) setModels(sorted(list))
    })
    return () => {
      live = false
    }
  }, [])

  // Names to pick from when adding: the engine's models and what the backends have loaded.
  const engine = useEngineModels()
  const { backends } = useBackends()
  const suggestions = useMemo(() => {
    const names = new Set<string>()
    for (const model of engine.models ?? []) names.add(model.id)
    for (const backend of backends) if ((backend.kind === "comfyui" || backend.kind === "a1111") && backend.model) names.add(backend.model)
    return [...names].sort()
  }, [engine.models, backends])

  const save = (name: string) => async (draft: ModelInfoDraft) => {
    const result = await putModelInfo(name, draft)
    if (!("info" in result)) return result
    await load()
    return null
  }
  const remove = (name: string) => async () => {
    const error = await deleteModelInfo(name)
    if (!error) await load()
    return error
  }
  const startAdding = () => {
    const name = adding.trim()
    if (!name) return
    // A model already kept opens its own editor.
    const known = models?.find((model) => model.name.toLowerCase() === name.toLowerCase())
    setEditing(known?.name ?? name)
    setAdding("")
  }

  const open = editing !== null ? (models?.find((model) => model.name === editing) ?? null) : null

  return (
    <Section title={t("modelInfo.settingsTitle")} description={t("modelInfo.settingsHint")} source={null}>
      <div className="space-y-4">
        {editing !== null && !open && (
          <ModelInfoEditor key={editing} name={editing} info={null} onSave={save(editing)} onDone={() => setEditing(null)} />
        )}
        {models === null ? null : models.length === 0 && editing === null ? (
          <p className="text-sm text-muted-foreground">{t("modelInfo.settingsNone")}</p>
        ) : (
          <ul className="space-y-2" aria-label={t("modelInfo.settingsTitle")}>
            {models.map((model) =>
              editing === model.name ? (
                <li key={model.name}>
                  <ModelInfoEditor name={model.name} info={model} onSave={save(model.name)} onDelete={remove(model.name)} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={model.name} className="space-y-1 rounded-md border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 truncate font-mono" title={model.name}>
                      {model.name}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{modelInfoSummary(model, t)}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setEditing(model.name)}
                      aria-label={t("modelInfo.editFor", { name: model.name })}
                      title={t("modelInfo.edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ModelInfoDetails info={model} />
                </li>
              )
            )}
          </ul>
        )}
        <Field label={t("modelInfo.settingsAdd")} hint={t("modelInfo.settingsAddHint")} htmlFor={`${id}-add`}>
          <div className="flex gap-2">
            <Input
              {...PRIVATE_TEXT}
              id={`${id}-add`}
              list={`${id}-names`}
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") startAdding()
              }}
              placeholder="model.safetensors"
              className="font-mono text-xs"
            />
            <Button type="button" variant="secondary" onClick={startAdding} disabled={!adding.trim()}>
              <Plus className="mr-1 h-4 w-4" />
              {t("modelInfo.add")}
            </Button>
          </div>
          <datalist id={`${id}-names`}>
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
      </div>
    </Section>
  )
}
