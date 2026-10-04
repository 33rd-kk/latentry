import type { Metadata } from "next"
import { AppHeader } from "@/components/app-header"
import { SetupPanel } from "@/components/setup/setup-panel"

export const metadata: Metadata = { title: "Setup · Latentry" }

export default function SetupPage() {
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <SetupPanel />
      </main>
    </>
  )
}
