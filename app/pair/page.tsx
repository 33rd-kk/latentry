import type { Metadata } from "next"
import { PairForm } from "@/components/pair-form"

export const metadata: Metadata = { title: "Pair this device · Latentry" }

// No header: until this device is paired, every other page sends it back here.
export default function PairPage() {
  return (
    <main className="container mx-auto flex max-w-md flex-1 flex-col justify-center px-4 py-10">
      <PairForm />
    </main>
  )
}
