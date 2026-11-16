import type { Metadata } from "next"
import { headers } from "next/headers"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { UnpairedGuard } from "@/components/unpaired-guard"
import { I18nProvider } from "@/lib/i18n"
import { NONCE_HEADER } from "@/lib/security/headers"

const fontSans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const fontMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Latentry",
  description: "Private, local image generation. Every picture remembered.",
}

// Reading the request makes every page render per request, which the nonce
// in proxy.ts needs (a page built ahead of time would carry no nonce).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
  return (
    <html lang="en" suppressHydrationWarning className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ThemeProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster />
            <UnpairedGuard />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
