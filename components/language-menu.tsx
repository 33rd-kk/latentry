"use client"

import { Languages } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { LOCALES, useI18n } from "@/lib/i18n"

/** "de" -> "Deutsch": a language's own name for itself, from the browser. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

/**
 * The UI language, for the header and for the pairing page, which has none.
 * Only once a second catalog exists (see locales/). Each language is named in
 * itself, so nothing here needs translating.
 */
export function LanguageMenu() {
  const { locale, setLocale } = useI18n()
  if (LOCALES.length < 2) return null
  return (
    <Select value={locale} onValueChange={setLocale}>
      <SelectTrigger size="sm" className="w-auto gap-1 border-none shadow-none" aria-label="Language">
        <Languages className="h-4 w-4" />
        <span className="text-xs uppercase">{locale}</span>
      </SelectTrigger>
      {/* Below the button, at its right edge: the default item-aligned list
          ignores `align` and lands in the corner from the header's edge. */}
      <SelectContent position="popper" align="end">
        {LOCALES.map((code) => (
          <SelectItem key={code} value={code}>
            {languageName(code)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
