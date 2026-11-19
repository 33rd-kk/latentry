import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { AppHeader } from "@/components/app-header"
import { GenerateClient } from "@/components/generate/generate-client"
import { galleryOnly, modeChosen } from "@/lib/mode"
import { editRefusal } from "@/lib/settings/access"

export default async function Home() {
  // Gallery-only mode has no generate page: its home is the gallery.
  if (galleryOnly()) redirect("/gallery")
  // Not chosen yet: the notice shown without a backend asks how Latentry is used.
  const firstRun = modeChosen() ? null : editRefusal(await headers()) ? "askOwner" : "choose"
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <GenerateClient firstRun={firstRun} />
      </main>
    </>
  )
}
