"use client"

import { useState } from "react"
import { DropdownMenu } from "radix-ui"
import { Bookmark, Check, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSavedSearches } from "@/hooks/use-saved-searches"
import { canSave, cleanName, currentSearch, MAX_NAME, MAX_SAVED, savedQuery, suggestedName } from "@/lib/gallery/saved-searches"
import type { GalleryQuery } from "@/lib/gallery/filter"
import { PRIVATE_TEXT } from "@/lib/secret-mode"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

const ITEM =
  "flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"

/**
 * The toolbar's saved searches: apply one to the open folder, save the
 * current search under a name, rename or delete them. Kept in this browser
 * only; not shown at all in secret mode.
 */
export function SavedSearchMenu({
  query,
  secret,
  onApply,
}: {
  query: GalleryQuery
  secret: boolean
  onApply: (query: GalleryQuery) => void
}) {
  const t = useT()
  const saved = useSavedSearches(secret)
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null)
  if (secret) return null
  const current = currentSearch(saved.searches, query)

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant={current ? "secondary" : "ghost"} size="sm" title={current?.name}>
            <Bookmark className="mr-1 h-4 w-4" />
            {t("gallery.saved.button")}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 max-h-(--radix-dropdown-menu-content-available-height) w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            <DropdownMenu.Label className="px-2 py-1 text-xs text-muted-foreground">
              {saved.searches.length ? t("gallery.saved.title") : t("gallery.saved.none")}
            </DropdownMenu.Label>
            {saved.searches.length > 0 && (
              <DropdownMenu.RadioGroup value={current?.id ?? ""}>
                {saved.searches.map((search) => (
                  <DropdownMenu.RadioItem key={search.id} value={search.id} className={ITEM} onSelect={() => onApply(savedQuery(search))}>
                    <span className="flex w-4 shrink-0 justify-center">
                      <DropdownMenu.ItemIndicator>
                        <Check className="h-4 w-4" />
                      </DropdownMenu.ItemIndicator>
                    </span>
                    <span className="min-w-0 break-words">{search.name}</span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className={ITEM} disabled={!canSave(query)} onSelect={() => setDialog("save")}>
              {t("gallery.saved.save")}
            </DropdownMenu.Item>
            {saved.searches.length > 0 && (
              <DropdownMenu.Item className={ITEM} onSelect={() => setDialog("manage")}>
                {t("gallery.saved.manage")}
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {dialog === "save" && <SaveDialog query={query} saved={saved} initial={current?.name ?? suggestedName(query)} onClose={() => setDialog(null)} />}
      {dialog === "manage" && <ManageDialog saved={saved} onClose={() => setDialog(null)} />}
    </>
  )
}

type Saved = ReturnType<typeof useSavedSearches>

function SaveDialog({ query, saved, initial, onClose }: { query: GalleryQuery; saved: Saved; initial: string; onClose: () => void }) {
  const t = useT()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const clean = cleanName(name)
  const replaces = clean !== "" && saved.searches.some((search) => search.name.toLocaleLowerCase() === clean.toLocaleLowerCase())
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = saved.save(name, query)
    if (!("error" in result)) return onClose()
    setError(t(`gallery.saved.error.${result.error}`, { max: MAX_SAVED }))
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("gallery.saved.saveTitle")}</DialogTitle>
            <DialogDescription>{t("gallery.saved.where")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="saved-search-name">{t("gallery.saved.name")}</Label>
            <Input
              id="saved-search-name"
              value={name}
              maxLength={MAX_NAME}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? "saved-search-error" : replaces ? "saved-search-replaces" : undefined}
              autoFocus
              {...PRIVATE_TEXT}
            />
            {replaces && !error && (
              <p id="saved-search-replaces" className="text-xs text-muted-foreground">
                {t("gallery.saved.replaces")}
              </p>
            )}
            {error && (
              <p id="saved-search-error" role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("gallery.saved.cancel")}
            </Button>
            <Button type="submit" disabled={clean === ""}>
              {t("gallery.saved.saveButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ManageDialog({ saved, onClose }: { saved: Saved; onClose: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState<{ id: string; name: string; error: boolean } | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const rename = (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    if (saved.rename(editing.id, editing.name)) setEditing(null)
    else setEditing({ ...editing, error: true })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("gallery.saved.manageTitle")}</DialogTitle>
          <DialogDescription>{t("gallery.saved.where")}</DialogDescription>
        </DialogHeader>
        {saved.searches.length === 0 ? (
          <p className="text-muted-foreground">{t("gallery.saved.none")}</p>
        ) : (
          <ul className="grid gap-1">
            {saved.searches.map((search) =>
              editing?.id === search.id ? (
                <li key={search.id}>
                  <form onSubmit={rename} className="flex items-center gap-1">
                    <Input
                      value={editing.name}
                      maxLength={MAX_NAME}
                      onChange={(event) => setEditing({ ...editing, name: event.target.value, error: false })}
                      onKeyDown={(event) => {
                        // Esc ends the rename, not the whole dialog.
                        if (event.key === "Escape") {
                          event.stopPropagation()
                          setEditing(null)
                        }
                      }}
                      aria-label={t("gallery.saved.renameLabel", { name: search.name })}
                      aria-invalid={editing.error}
                      aria-describedby={editing.error ? "saved-search-rename-error" : undefined}
                      autoFocus
                      {...PRIVATE_TEXT}
                    />
                    <Button type="submit" size="sm" disabled={cleanName(editing.name) === ""}>
                      {t("gallery.saved.renameButton")}
                    </Button>
                  </form>
                  {editing.error && (
                    <p id="saved-search-rename-error" role="alert" className="mt-1 text-xs text-destructive">
                      {t("gallery.saved.error.taken")}
                    </p>
                  )}
                </li>
              ) : (
                <li key={search.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 break-words">{search.name}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("gallery.saved.rename", { name: search.name })}
                    title={t("gallery.saved.rename", { name: search.name })}
                    onClick={() => setEditing({ id: search.id, name: search.name, error: false })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("gallery.saved.delete", { name: search.name })}
                    title={t("gallery.saved.delete", { name: search.name })}
                    onClick={() => saved.remove(search.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              )
            )}
          </ul>
        )}
        <DialogFooter className={cn(saved.searches.length === 0 && "hidden")}>
          <Button
            variant={confirmAll ? "destructive" : "outline"}
            onClick={() => {
              if (!confirmAll) return setConfirmAll(true)
              saved.removeAll()
              setConfirmAll(false)
            }}
          >
            {confirmAll ? t("gallery.saved.deleteAllConfirm", { count: saved.searches.length }) : t("gallery.saved.deleteAll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
