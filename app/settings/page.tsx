import type { Metadata } from "next"
import { AppHeader } from "@/components/app-header"
import { SettingsForm } from "@/components/settings/settings-form"

export const metadata: Metadata = { title: "Settings · Latentry" }

export default function SettingsPage() {
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <SettingsForm />
      </main>
    </>
  )
}
