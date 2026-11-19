/**
 * Gallery-only mode (lib/mode.ts): which mode is in effect, and which API
 * routes it closes. Every route under app/api is listed here as closed or
 * open, so a new route fails this script until it is put on one side.
 *
 * Run with: npm test -- mode
 */
import { readdirSync } from "node:fs"
import path from "node:path"
import { appMode, closedInGalleryOnly, galleryOnlyStart, modeFromEnv } from "../lib/mode"
import { parseStoredSettings, SETTINGS_VERSION, validateSettings, type Settings } from "../lib/settings/schema"

let passed = 0
let failed = 0

function expect(label: string, actual: unknown, wanted: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(wanted)) passed++
  else {
    failed++
    console.error(`FAIL: ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`)
  }
}

const none: Settings = { version: SETTINGS_VERSION }
const gallery: Settings = { version: SETTINGS_VERSION, mode: "gallery" }
const full: Settings = { version: SETTINGS_VERSION, mode: "full" }

// Which mode: LATENTRY_MODE, else the file, else full.
expect("nothing set", appMode({}, none), "full")
expect("file says gallery", appMode({}, gallery), "gallery")
expect("env wins over the file", appMode({ LATENTRY_MODE: "full" }, gallery), "full")
expect("env alone", appMode({ LATENTRY_MODE: "gallery" }, none), "gallery")
expect("env is trimmed and case-blind", appMode({ LATENTRY_MODE: " Gallery " }, full), "gallery")
expect("an unknown env value is ignored", appMode({ LATENTRY_MODE: "viewer" }, gallery), "gallery")
expect("modeFromEnv unset", modeFromEnv({}), null)

// The settings file: a mode is kept, a wrong one refused, null goes back to unset.
expect("valid mode stored", validateSettings({ mode: "gallery" }, none), { ok: true, settings: { version: SETTINGS_VERSION, mode: "gallery" } })
expect("wrong mode refused", validateSettings({ mode: "viewer" }, none), { ok: false, errors: { mode: "settings.errorList" } })
expect("null clears it", validateSettings({ mode: null }, gallery), { ok: true, settings: { version: SETTINGS_VERSION } })
expect("absent keeps it", validateSettings({}, gallery), { ok: true, settings: { version: SETTINGS_VERSION, mode: "gallery" } })
expect("a bad mode in the file is dropped, the rest kept", parseStoredSettings({ mode: "x", wildcards: { share: true } }, {}), {
  version: SETTINGS_VERSION,
  wildcards: { share: true },
})

// Every API route, by its folder under app/api, on one side or the other.
const CLOSED = [
  "/api/control",
  "/api/engine/install",
  "/api/engine/loras",
  "/api/engine/models",
  "/api/engine/models/hf",
  "/api/engine/models/load",
  "/api/engine/start",
  "/api/engine/stop",
  "/api/gen/[backend]/cancel",
  "/api/gen/[backend]/generate",
  "/api/gen/[backend]/job",
  "/api/gen/[backend]/job/secret",
  "/api/gen/[backend]/job/stream",
  "/api/gen/[backend]/pose",
  "/api/gen/[backend]/presets",
  "/api/gen/[backend]/workflows",
  "/api/models/info",
  "/api/settings/test",
  "/api/wildcards",
  "/api/wildcards/expand",
]
const OPEN = [
  // Read-only status for Setup's tagger card.
  "/api/engine",
  // Refuses all but a tagger itself in this mode (the route checks the body).
  "/api/engine/models/download",
  "/api/gallery",
  "/api/gallery/[dir]/[name]",
  "/api/gallery/[dir]/[name]/open",
  "/api/gallery/[dir]/[name]/rating",
  "/api/gallery/[dir]/[name]/tags",
  "/api/gallery/[dir]/autotag",
  "/api/gallery/download",
  "/api/gallery/sheet",
  "/api/gen/backends",
  "/api/gen/tag",
  "/api/pair",
  "/api/settings",
  "/api/settings/pairing",
]

function routes(dir: string, prefix: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const here = `${prefix}/${entry.name}`
    if (readdirSync(path.join(dir, entry.name)).includes("route.ts")) found.push(here)
    found.push(...routes(path.join(dir, entry.name), here))
  }
  return found
}
const all = routes(path.join(__dirname, "..", "app", "api"), "/api").sort()
expect("every route is listed once", all, [...CLOSED, ...OPEN].sort())

// A route folder as a request path: [param] becomes a sample value.
const sample = (route: string) => route.replace(/\[[^\]]+\]/g, "x1")
for (const route of CLOSED) {
  expect(`${route} closed (POST)`, closedInGalleryOnly(sample(route), "POST"), true)
  expect(`${route} closed (GET)`, closedInGalleryOnly(sample(route), "GET"), true)
}
for (const route of OPEN) {
  const method = "GET"
  expect(`${route} open`, closedInGalleryOnly(sample(route), method), false)
}
// /api/engine has only GET; anything else there is closed.
expect("/api/engine POST closed", closedInGalleryOnly("/api/engine", "POST"), true)
// A backend called "backends" or "tag" still cannot reach its generate route.
expect("/api/gen/tag/generate closed", closedInGalleryOnly("/api/gen/tag/generate", "POST"), true)
expect("/api/gen/backends/job closed", closedInGalleryOnly("/api/gen/backends/job", "GET"), true)
// Prefixes match whole segments only.
expect("/api/controlled is not /api/control", closedInGalleryOnly("/api/controlled", "GET"), false)

// The folder the gallery opens on: an empty save folder is skipped for the first read-only one.
async function starts() {
  const save = { index: 0, writable: true }
  const other = { index: 1, writable: false }
  const third = { index: 2, writable: false }
  const has = (full: number[]) => async (dir: { index: number }) => full.includes(dir.index)
  expect("no folders", await galleryOnlyStart([], has([])), null)
  expect("empty save folder, a read-only one", await galleryOnlyStart([save, other, third], has([1, 2])), 1)
  expect("save folder with pictures stays first", await galleryOnlyStart([save, other], has([0])), 0)
  expect("empty save folder alone", await galleryOnlyStart([save], has([])), 0)
  expect("an empty read-only folder is still opened", await galleryOnlyStart([save, other], has([])), 1)
  // A paired device that sees only read-only folders opens on the first.
  expect("no save folder shown", await galleryOnlyStart([third, other], has([])), 2)
  let asked = 0
  await galleryOnlyStart([other, save], async () => (asked++, false))
  expect("the save folder is looked into only when it comes first", asked, 0)
}

starts().then(() => {
  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})
