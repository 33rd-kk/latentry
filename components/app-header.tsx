"use client"

import { useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { EyeOff, Images, Languages, Moon, Sun, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { preferences, STORAGE_EVENT_NAME, STORAGE_KEYS } from "@/lib/storage"
import { isSecretMode } from "@/lib/secret-mode"
import { useI18n } from "@/lib/i18n"

function subscribeSecretMode(listener: () => void) {
  const onChange = (event: Event) => {
    if ((event as CustomEvent).detail?.key === STORAGE_KEYS.SECRET_MODE) listener()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEYS.SECRET_MODE) listener()
  }
  window.addEventListener(STORAGE_EVENT_NAME, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(STORAGE_EVENT_NAME, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

/** Secret mode, read live so every component that shows prompts agrees. */
export function useSecretMode(): boolean {
  return useSyncExternalStore(subscribeSecretMode, isSecretMode, () => false)
}

export function AppHeader() {
  const { locale, setLocale, t } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const pathname = usePathname()
  const secret = useSecretMode()

  const nav = [
    { href: "/", label: t("app.navGenerate"), icon: Wand2 },
    { href: "/gallery", label: t("app.navGallery"), icon: Images },
  ]

  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="container mx-auto flex h-12 max-w-7xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 font-semibold tracking-tight">
          Latentry
        </Link>
        <nav className="flex items-center gap-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Button key={href} variant={pathname === href ? "secondary" : "ghost"} size="sm" asChild>
              <Link href={href}>
                <Icon className="mr-1.5 h-4 w-4" />
                {label}
              </Link>
            </Button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={secret ? "secondary" : "ghost"}
                size="icon"
                aria-pressed={secret}
                aria-label={t("app.secretMode")}
                onClick={() => preferences.setSecretMode(!secret)}
              >
                <EyeOff className={cn("h-4 w-4", secret && "text-primary")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t("app.secretModeHint")}</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("app.language")}
            title={t("app.language")}
            onClick={() => setLocale(locale === "ja" ? "en" : "ja")}
          >
            <Languages className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("app.theme")}
            title={t("app.theme")}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="hidden h-4 w-4 dark:block" />
          </Button>
        </div>
      </div>
    </header>
  )
}
