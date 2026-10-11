"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { MAX_FOLDER_LABEL } from "@/lib/settings/schema"
import { autoLabel, type ChangeDraft, type Draft } from "@/lib/settings/draft"
import type { SettingsView } from "@/lib/settings/view"
import { useT } from "@/lib/i18n"
import { Field, FieldError, Section } from "./section"

export function GallerySection({
  view,
  draft,
  errors,
  change,
  onUseEnv,
}: {
  view: SettingsView
  draft: Draft
  errors: Record<string, string>
  change: ChangeDraft
  onUseEnv: () => void
}) {
  const t = useT()
  return (
    <Section
      title={t("settings.galleryTitle")}
      description={t("settings.galleryHint")}
      source={view.sources.saveDir === "settings" || view.sources.dirs === "settings" ? "settings" : "env"}
      onUseEnv={onUseEnv}
    >
      <div className="space-y-4">
        <Field label={t("settings.saveDir")} hint={t("settings.saveDirHint")}>
          <div className="flex gap-2">
            <Input
              value={draft.saveDir}
              onChange={(event) => change("gallery", (current) => ({ ...current, saveDir: event.target.value }))}
              placeholder={t("settings.saveDirOff")}
              className="font-mono text-xs"
            />
            <Input
              value={draft.saveLabel}
              onChange={(event) => change("gallery", (current) => ({ ...current, saveLabel: event.target.value }))}
              placeholder={autoLabel(view, draft.saveDir) ?? t("settings.folderLabelAuto")}
              aria-label={t("settings.folderLabel")}
              maxLength={MAX_FOLDER_LABEL}
              className="w-32 shrink-0 text-xs sm:w-40"
            />
          </div>
          <FieldError errors={errors} at="gallery.saveDir" />
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
                <Input
                  value={draft.dirLabels[index] ?? ""}
                  onChange={(event) =>
                    change("gallery", (current) => ({
                      ...current,
                      dirLabels: current.dirs.map((_, i) => (i === index ? event.target.value : (current.dirLabels[i] ?? ""))),
                    }))
                  }
                  placeholder={autoLabel(view, dir) ?? t("settings.folderLabelAuto")}
                  aria-label={t("settings.folderLabel")}
                  maxLength={MAX_FOLDER_LABEL}
                  className="w-32 shrink-0 text-xs sm:w-40"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("settings.remove")}
                  onClick={() =>
                    change("gallery", (current) => ({
                      ...current,
                      dirs: current.dirs.filter((_, i) => i !== index),
                      dirLabels: current.dirLabels.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <FieldError errors={errors} at={`gallery.dirs.${index}`} />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => change("gallery", (current) => ({ ...current, dirs: [...current.dirs, ""], dirLabels: [...current.dirLabels, ""] }))}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("settings.addDir")}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.autoTag} onCheckedChange={(autoTag) => change("gallery", (current) => ({ ...current, autoTag }))} />
          {t("settings.autoTag")}
        </label>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.loraHashes} onCheckedChange={(loraHashes) => change("gallery", (current) => ({ ...current, loraHashes }))} />
            {t("settings.loraHashes")}
          </label>
          <p className="text-xs text-muted-foreground">{t("settings.loraHashesHint")}</p>
        </div>
      </div>
    </Section>
  )
}
