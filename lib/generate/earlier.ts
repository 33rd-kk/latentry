// The runs the Generate page keeps below the one on screen (see
// hooks/use-job-watch.ts), so a run's pictures do not vanish when the next
// one in the queue starts. Held in the page's memory only.

/** One picture as the page holds it. */
export interface EarlierImage {
  seed: number
  image_base64: string
  saved_name: string | null
}

/** A run that has left the screen to a newer one, kept below it. */
export interface EarlierRun {
  id: string
  backend: string
  images: EarlierImage[]
}

/** How many earlier runs the page keeps, and how many pictures in all: they are held in its memory. */
export const EARLIER_MAX_RUNS = 5
export const EARLIER_MAX_IMAGES = 32

/** Puts `run` first and drops the oldest past the limits. */
export function keepEarlier(runs: EarlierRun[], run: EarlierRun): EarlierRun[] {
  const kept: EarlierRun[] = []
  let images = 0
  for (const entry of [run, ...runs.filter((other) => other.id !== run.id)]) {
    if (kept.length >= EARLIER_MAX_RUNS || images + entry.images.length > EARLIER_MAX_IMAGES) break
    kept.push(entry)
    images += entry.images.length
  }
  return kept
}
