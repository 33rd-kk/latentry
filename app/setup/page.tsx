import type { Metadata } from "next"
import { AppHeader } from "@/components/app-header"
import { SetupPanel } from "@/components/setup/setup-panel"
import { galleryOnly } from "@/lib/mode"

export const metadata: Metadata = { title: "Setup · Latentry" }

export default function SetupPage() {
  const only = galleryOnly()
  return (
    <>
      <AppHeader galleryOnly={only} />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <SetupPanel galleryOnly={only} />
      </main>
    </>
  )
}
