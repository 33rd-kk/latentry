import { AppHeader } from "@/components/app-header"
import { GenerateClient } from "@/components/generate/generate-client"

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <GenerateClient />
      </main>
    </>
  )
}
