"use client"

import { useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

const COMMANDS = [
  { label: "owner.docker", command: "docker compose exec latentry npm run owner-code" },
  { label: "owner.native", command: "npm run owner-code" },
] as const

const noChange = () => () => {}

/**
 * How to make this browser an owner device with `npm run owner-code`
 * (scripts/owner-code.mjs), step by step, for someone who has not used a
 * terminal or Docker much. `onPairPage` when the code box is on the same page.
 */
export function OwnerCodeSteps({ onPairPage = false }: { onPairPage?: boolean }) {
  const t = useT()
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <ol className="list-decimal space-y-2 pl-5">
        <li>{t("owner.terminal")}</li>
        <li>
          {t("owner.run")}
          <div className="mt-1.5 space-y-1.5">
            {COMMANDS.map(({ label, command }) => (
              <div key={command}>
                <div className="text-xs">{t(label)}</div>
                <CommandLine command={command} />
              </div>
            ))}
          </div>
        </li>
        <li>
          {onPairPage
            ? t("owner.enterHere")
            : t.rich("owner.enterOnPair", {
                link: (children) => (
                  <Link href="/pair" className="underline underline-offset-2">
                    {children}
                  </Link>
                ),
              })}
        </li>
      </ol>
      <p>{t("owner.after")}</p>
    </div>
  )
}

function CommandLine({ command }: { command: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  // The clipboard needs a secure context: there on localhost, not on a LAN
  // address over http, where the line can still be selected by hand. False
  // on the server, so its HTML and the first render agree.
  const canCopy = useSyncExternalStore(noChange, () => !!navigator.clipboard, () => false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-md border bg-muted/50 pl-2">
      <code className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-xs whitespace-nowrap text-foreground select-all">{command}</code>
      {canCopy && (
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copy} aria-label={copied ? t("owner.copied") : t("owner.copy")}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      )}
    </div>
  )
}
