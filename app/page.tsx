import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AppHeader } from "@/components/app-header"
import { GenerateClient } from "@/components/generate/generate-client"
import type { FirstRun } from "@/components/setup-notice"
import { galleryOnly, modeChosen, modeFromEnv } from "@/lib/mode"
import { editRefusal } from "@/lib/settings/access"

export default async function Home() {
  // Gallery-only mode has no generate page: its home is the gallery.
  if (galleryOnly()) redirect("/gallery")
  // What the notice shown without a backend offers (components/setup-notice.tsx):
  // not chosen yet, it asks how Latentry is used, or tells a device that may not
  // change settings who can; chosen, it offers browsing only instead, unless
  // LATENTRY_MODE decides or this device may not change settings.
  const refusal = editRefusal(await headers())
  const firstRun: FirstRun = !modeChosen()
    ? refusal === "off" ? "readOnly" : refusal ? "askOwner" : "choose"
    : modeFromEnv() === null && !refusal ? "switch" : null
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <GenerateClient firstRun={firstRun} />
      </main>
    </>
  )
}
