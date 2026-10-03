import type { Metadata } from "next"
import { AppHeader } from "@/components/app-header"
import { Gallery } from "@/components/gallery/gallery"

export const metadata: Metadata = { title: "Gallery · Latentry" }

export default function GalleryPage() {
  return (
    <>
      <AppHeader />
      <main className="container mx-auto max-w-7xl px-4 py-6">
        <Gallery />
      </main>
    </>
  )
}
