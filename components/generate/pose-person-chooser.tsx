"use client"

import { Loader2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { ALL_PEOPLE, chosenIndices, toggledChoice, type DetectedPerson, type PersonChoice } from "@/lib/pose"
import type { SourceImage } from "./source-image-slot"
import { VeilToggle } from "./veil-toggle"

interface PosePersonChooserProps {
  /** The reference picture the people were found in. */
  picture: SourceImage
  people: DetectedPerson[]
  /** Who was drawn, or null. */
  person: PersonChoice | null
  /** Whether the backend takes some of the people by a list; without it, one or everyone. */
  subsets: boolean
  /** Asks for the skeleton of this choice. */
  onPick: (person: PersonChoice) => void
  /** Secret mode's blur over the picture; null outside secret mode. */
  veil: { veiled: boolean; onChange: (veiled: boolean) => void } | null
  loading: boolean
  disabled?: boolean
}

/**
 * With several people in the picture the server picks the most confident one,
 * which is often not the one meant, so their boxes are drawn over the
 * reference. On a backend that takes a list, clicking a box switches that
 * person on or off (the last one stays); on one that does not, clicking asks
 * for that person alone, and the chooser says why it cannot do more.
 *
 * Secret mode blurs the picture; the numbered boxes stay sharp on top, so a
 * person can still be picked by where they stand.
 */
export function PosePersonChooser({ picture, people, person, subsets, onPick, veil, loading, disabled }: PosePersonChooserProps) {
  const t = useT()
  const veiled = veil?.veiled ?? false
  const chosen = chosenIndices(person, people.length)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
        <span>{t(subsets ? "generate.posePeopleToggle" : "generate.posePeople", { count: people.length })}</span>
        {veil && <VeilToggle veiled={veil.veiled} onChange={veil.onChange} />}
      </div>
      {/* The boxes are fractions of the picture, so they sit right at whatever size it renders. */}
      <div className="relative inline-block max-w-full overflow-hidden rounded-md">
        <img
          src={picture.dataUrl}
          alt=""
          className={cn("block max-h-56 max-w-full rounded-md border border-border/50 bg-muted/50", veiled && "blur-xl")}
        />
        {people.map((detected, index) => {
          const [x0, y0, x1, y1] = detected.bbox
          const active = chosen.has(index)
          const next = subsets ? toggledChoice(person, index, people.length) : index
          return (
            <button
              key={index}
              type="button"
              aria-label={t("generate.posePerson", { n: index + 1 })}
              aria-pressed={subsets ? active : person === index}
              onClick={() => next !== null && onPick(next)}
              // The last one chosen cannot be left out: there would be no skeleton.
              disabled={disabled || loading || next === null}
              style={{
                left: `${x0 * 100}%`,
                top: `${y0 * 100}%`,
                width: `${(x1 - x0) * 100}%`,
                height: `${(y1 - y0) * 100}%`,
              }}
              className={cn(
                "absolute rounded-sm border-2 transition",
                active
                  ? "border-primary bg-primary/10"
                  : "border-white/70 bg-black/10 opacity-70 hover:border-primary/70 hover:opacity-100"
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-0 rounded-br-sm px-1 text-[10px] font-semibold leading-4",
                  active ? "bg-primary text-primary-foreground" : "bg-black/60 text-white"
                )}
              >
                {index + 1}
              </span>
            </button>
          )
        })}
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          variant={person === ALL_PEOPLE ? "secondary" : "ghost"}
          className="h-6 px-1.5 text-xs"
          aria-pressed={person === ALL_PEOPLE}
          onClick={() => onPick(ALL_PEOPLE)}
          disabled={disabled || loading}
        >
          <Users className="mr-1 h-3 w-3" />
          {t("generate.posePeopleAll")}
        </Button>
      </div>
      {!subsets && <p className="text-xs text-muted-foreground">{t("generate.posePeopleOneOrAll")}</p>}
    </div>
  )
}
