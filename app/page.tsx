import { redirect } from "next/navigation"
import { AppHeader } from "@/components/app-header"
import { GenerateClient } from "@/components/generate/generate-client"
import { galleryOnly } from "@/lib/mode"

export default function Home() {
  // Gallery-only mode has no generate page: its home is the gallery.
  if (galleryOnly()) redirect("/gallery")
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <GenerateClient />
      </main>
    </>
  )
}
