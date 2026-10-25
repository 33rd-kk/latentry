import type { Metadata } from "next"
import { LanguageMenu } from "@/components/language-menu"
import { PairForm } from "@/components/pair-form"

export const metadata: Metadata = { title: "Pair this device · Latentry" }

// No header: until this device is paired, every other page sends it back
// here. Only the language menu, so the steps can be read in it.
export default function PairPage() {
  return (
    <main className="container mx-auto flex max-w-md flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-2 flex justify-end">
        <LanguageMenu />
      </div>
      <PairForm />
    </main>
  )
}
