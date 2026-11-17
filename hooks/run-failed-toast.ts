"use client"

import { toast } from "sonner"
import { serverMessage, type Translator } from "@/lib/i18n"

/** Where the setup page opens the engine's log (components/setup/engine-card.tsx). */
export const ENGINE_LOG_HREF = "/setup#engine-log"

// serverMessage's text for the key, before its variables.
const ENGINE_FAILED = serverMessage("generate.engineFailed")

/** Whether a run's error is the engine's own failure, whose details are only in its log. */
export function isEngineFailure(error: string | null | undefined): boolean {
  return Boolean(error && (error === ENGINE_FAILED || error.startsWith(`${ENGINE_FAILED}|`)))
}

/**
 * Says a run failed and why. When the engine failed in a way only its log
 * explains, the toast also gets a button to that log, in a new tab so the
 * form stays as it was. On a paired device the setup page asks for the owner
 * code instead of showing the log.
 */
export function toastRunFailed(t: Translator, error: string | null | undefined): void {
  toast.error(t("generate.failed"), {
    description: error ? t.server(error) : t("generate.serverError"),
    ...(isEngineFailure(error)
      ? { action: { label: t("generate.openEngineLog"), onClick: () => window.open(ENGINE_LOG_HREF, "_blank", "noopener") } }
      : {}),
  })
}
