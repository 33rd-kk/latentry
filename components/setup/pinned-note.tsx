"use client"

import type { InstallRecord } from "@/lib/engine/install"
import { lockIsStale } from "@/lib/engine/locks"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * Whether the engine's Python packages are the pinned ones, under the install
 * line on Setup: when they were pinned (and a nudge once that is long ago, as
 * security fixes come only with a new lock), or why they are not.
 */
export function PinnedNote({ installed }: { installed: InstallRecord }) {
  const t = useT()
  if (installed.lock) {
    const date = installed.lock.lockedOn
    return lockIsStale(new Date(), date) ? (
      <p className="text-xs text-amber-600 dark:text-amber-500">{t("setup.pinnedStale", { date })}</p>
    ) : (
      <p className="text-xs text-muted-foreground">{t("setup.pinned", { date })}</p>
    )
  }
  const key = installed.unpinned ? (`setup.unpinned.${installed.unpinned}` as MessageKey) : "setup.unpinnedOld"
  return <p className="text-xs text-amber-600 dark:text-amber-500">{t(key)}</p>
}
