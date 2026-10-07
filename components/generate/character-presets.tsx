"use client"

import { useCallback, useEffect, useState } from "react"
import { Save, Trash2, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSecretMode } from "@/components/app-header"
import { preferences, STORAGE_KEYS, STORAGE_EVENT_NAME, type CharacterPreset } from "@/lib/storage"
import { useT } from "@/lib/i18n"

interface CharacterPresetsProps {
  /** What "save" starts from: the tags last carried over by the extractor, if any. */
  suggestedTags: string
  artist: string
  negativePrompt: string
  seed: number
  onApply: (preset: CharacterPreset) => void
  disabled?: boolean
}

/**
 * Saved characters: the tags that make one, plus the artist,
 * negative prompt and seed that drew them. Applying one puts the character's
 * tags in front of the prompt and leaves the rest of it (the new scene) alone.
 */
export function CharacterPresets({ suggestedTags, artist, negativePrompt, seed, onApply, disabled }: CharacterPresetsProps) {
  const t = useT()
  const secret = useSecretMode()
  const [presets, setPresets] = useState<CharacterPreset[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [tags, setTags] = useState("")

  // Read after mount (not in useState) so the server render matches; kept in
  // step with other tabs through the same storage events the rest of the app
  // uses. Secret mode turning off, here or in another tab, drops the temporary ones.
  useEffect(() => {
    const load = () => setPresets(preferences.getCharacterPresets())
    load()
    const watched: string[] = [STORAGE_KEYS.CHARACTER_PRESETS, STORAGE_KEYS.SECRET_MODE]
    const onCustom = (event: Event) => {
      if (watched.includes((event as CustomEvent).detail?.key)) load()
    }
    const onNative = (event: StorageEvent) => {
      if (event.key && watched.includes(event.key)) load()
    }
    window.addEventListener(STORAGE_EVENT_NAME, onCustom)
    window.addEventListener("storage", onNative)
    return () => {
      window.removeEventListener(STORAGE_EVENT_NAME, onCustom)
      window.removeEventListener("storage", onNative)
    }
  }, [])

  const startSave = useCallback(() => {
    setTags(suggestedTags)
    setName("")
    setSaving(true)
  }, [suggestedTags])

  const save = useCallback(() => {
    const next = preferences.addCharacterPreset({ name: name.trim(), tags: tags.trim(), artist, negativePrompt, seed })
    setPresets(next)
    setSelectedId(next[0]?.id ?? "")
    setSaving(false)
  }, [name, tags, artist, negativePrompt, seed])

  const remove = useCallback(() => {
    if (!selectedId) return
    setPresets(preferences.removeCharacterPreset(selectedId))
    setSelectedId("")
  }, [selectedId])

  const selected = presets.find((preset) => preset.id === selectedId) ?? null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Select value={selectedId} onValueChange={setSelectedId} disabled={disabled || presets.length === 0}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder={presets.length ? t("generate.characterPick") : t("generate.characterNone")} />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
                {preset.temporary && <span className="ml-1.5 text-[10px] text-muted-foreground">{t("generate.characterTemporary")}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 px-2 text-xs"
          onClick={() => selected && onApply(selected)}
          disabled={disabled || !selected}
        >
          {t("generate.characterApply")}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={remove}
          disabled={disabled || !selected}
          aria-label={t("generate.characterDelete")}
          title={t("generate.characterDelete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={startSave}
          disabled={disabled}
          aria-label={t("generate.characterSave")}
          title={t("generate.characterSave")}
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
      </div>

      {selected && !saving && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{selected.tags}</p>
      )}

      {saving && (
        <div className="space-y-2 rounded-md border p-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("generate.characterName")}
            className="h-8 text-xs"
          />
          <Textarea
            rows={3}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder={t("generate.characterTags")}
            className="text-xs"
          />
          <p className="text-xs text-muted-foreground">{t("generate.characterSaveHint")}</p>
          {secret && <p className="text-xs font-medium text-foreground">{t("generate.characterSaveSecret")}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSaving(false)}>
              {t("generate.cancel")}
            </Button>
            <Button type="button" size="sm" className="h-7 text-xs" onClick={save} disabled={!name.trim() || !tags.trim()}>
              {t("generate.characterSave")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
