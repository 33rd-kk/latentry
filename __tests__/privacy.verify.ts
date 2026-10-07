/**
 * Privacy audit (2026-10): what secret mode keeps out of browser storage
 * (lib/storage.ts, lib/secret-mode.ts), and what the server's job record
 * (lib/diffusion/job-store.ts) hands to clients after a run.
 *
 * Gaps still open are pinned with knownGap(); see
 * audit/2026-10-privacy-audit.md (local, not committed) for the IDs.
 *
 * Run with: npm test -- privacy
 */
import { check, done, eq } from './assert'
import { drainHandoff, preferences, pushHandoff, STORAGE_KEYS } from '../lib/storage'
import { applyEvent, forget, getCurrentJob, getJob, isResumable, isWatchable, keptFor, RESUME_WINDOW_MS, SECRET_GRACE_MS, startJob, toSnapshot, type JobContext } from '../lib/diffusion/job-store'

// ── A browser, as far as lib/storage.ts needs one ──
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true, writable: true })
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true, writable: true })

/** Every place the marker text survives in storage. */
const holding = (marker: string) => [...store].filter(([, value]) => value.includes(marker)).map(([key]) => key)

const HIDDEN = 'zzaudit-hidden-prompt'
const BEFORE = 'zzaudit-typed-before-secret'

// ── C1: typing while secret mode is on ──
store.clear()
preferences.setSecretMode(true)
check(preferences.getSecretMode(), 'secret mode reads back as on')
preferences.setForm('anima', { prompt: HIDDEN, negativePrompt: HIDDEN })
preferences.setSharedPrompt({ prompt: HIDDEN, artist: HIDDEN })
preferences.addCharacterPreset({ name: HIDDEN, tags: HIDDEN, artist: '', negativePrompt: '', seed: 1 })
eq(holding(HIDDEN), [], 'C1: the form, the shared prompt and characters are not stored in secret mode')

pushHandoff({ type: 'settings', settings: { prompt: HIDDEN, negativePrompt: HIDDEN } })
pushHandoff({ type: 'tags', tags: [HIDDEN], target: 'positive' })
eq(holding(HIDDEN), [], 'F6: the gallery → generate handoff stays out of localStorage in secret mode')
eq(drainHandoff().length, 2, 'and still reaches the form in this tab')
eq(drainHandoff().length, 0, 'once')

preferences.setSecretMode(false)
pushHandoff({ type: 'tag', tag: 'outside', target: 'positive' })
eq(holding('outside'), [STORAGE_KEYS.HANDOFF], 'outside secret mode it goes through localStorage, so another tab gets it')
eq(drainHandoff().length, 1, 'drained')
eq(holding('outside'), [], 'a drained handoff leaves nothing behind')

// ── C2: what was typed before secret mode ──
store.clear()
preferences.setForm('anima', { prompt: BEFORE })
preferences.setSharedPrompt({ prompt: BEFORE, artist: '' })
eq(holding(BEFORE).sort(), [STORAGE_KEYS.FORM_PREFIX + 'anima', STORAGE_KEYS.SHARED_PROMPT].sort(), 'outside secret mode the form is kept')
// F7, decided: drafts from before secret mode are not secret-mode data, and
// deleting them on the toggle would lose work. Nothing typed during it is added.
preferences.setSecretMode(true)
preferences.setForm('anima', { prompt: HIDDEN })
preferences.setSecretMode(false)
eq(holding(BEFORE).length, 2, 'drafts from before secret mode are kept')
eq(holding(HIDDEN), [], 'nothing from during it is')
preferences.setSecretMode(false)
eq(store.get(STORAGE_KEYS.SECRET_MODE), 'false', 'the flag itself is a plain stored preference')

// ── Characters in secret mode: temporary, gone when it ends ──
store.clear()
preferences.setSecretMode(false)
const kept = preferences.addCharacterPreset({ name: 'kept', tags: 'a', artist: '', negativePrompt: '', seed: 1 })[0]
preferences.setSecretMode(true)
eq(preferences.getCharacterPresets().map((c) => c.name), ['kept'], 'characters saved before secret mode can be used in it')
const temp = preferences.addCharacterPreset({ name: HIDDEN, tags: HIDDEN, artist: '', negativePrompt: '', seed: 2 })[0]
eq([temp.name, temp.temporary], [HIDDEN, true], 'one saved in secret mode is listed first, marked temporary')
eq(preferences.getCharacterPresets().map((c) => c.name), [HIDDEN, 'kept'], 'next to the saved ones')
eq(holding(HIDDEN), [], 'and is not written to storage')
preferences.removeCharacterPreset(kept.id)
eq(preferences.getCharacterPresets().map((c) => c.name), [HIDDEN], 'deleting a saved one in secret mode deletes it')
eq(store.get(STORAGE_KEYS.CHARACTER_PRESETS), '[]', 'for good')
preferences.setSecretMode(false)
eq(preferences.getCharacterPresets(), [], 'turning secret mode off drops the temporary ones')
preferences.setSecretMode(true)
preferences.addCharacterPreset({ name: HIDDEN, tags: HIDDEN, artist: '', negativePrompt: '', seed: 3 })
store.set(STORAGE_KEYS.SECRET_MODE, 'false') // turned off in another tab
eq(preferences.getCharacterPresets(), [], 'also when another tab turns it off')
preferences.setSecretMode(false)

// ── F4: the server's record of a run ──
const context: JobContext = {
  request: { prompt: HIDDEN, negativePrompt: '', width: 64, height: 64, steps: 1, seed: 1, count: 1 } as unknown as JobContext['request'],
  profile: 'generic',
  kind: 'diffusers',
  model: null,
  mode: 'txt2img',
}
type Event = Parameters<typeof applyEvent>[1]
const image: Event = { type: 'image', index: 0, total: 1, seed: 1, imageBase64: 'iVBORw0K' } as Event

// An ordinary run: back on screen after a reload, for an hour.
const open = startJob({ backend: 'audit', total: 1, steps: 1, context })
applyEvent(open, image)
applyEvent(open, { type: 'done' } as Event)
check(!JSON.stringify(toSnapshot(open)).includes(HIDDEN), 'a snapshot never carries the prompt')
check(!('images' in toSnapshot(open)), '/job answers without the images')
check(isResumable(open), 'an ordinary run is offered to a page that loads, within the hour')
const late = (open.endedAt ?? 0) + RESUME_WINDOW_MS + 1
check(!isResumable(open, late) && !isWatchable(open, late), 'F4: past the hour neither /job nor /job/stream serves it')
check(keptFor(open) === RESUME_WINDOW_MS, 'and an ordinary run is dropped from memory then')

// A secret run: the starting page only, and gone a minute after it ends.
const secret = startJob({ backend: 'audit', total: 1, steps: 1, context, secret: true })
check(!isResumable(secret), 'F4: a secret run is never offered to a page that loads, even while running')
check(isWatchable(secret), 'the page that started it can watch it')
applyEvent(secret, image)
applyEvent(secret, { type: 'done' } as Event)
check(isWatchable(secret) && !isResumable(secret), 'just after it ends, only its stream may still read it')
check(!isWatchable(secret, (secret.endedAt ?? 0) + SECRET_GRACE_MS + 1), 'not after the grace period')
check(keptFor(secret) === SECRET_GRACE_MS, 'a secret run is dropped from memory after the grace period')
forget(secret)
check(getCurrentJob('audit') === null && getJob('audit', secret.id) === null, 'F4: forgotten, the server no longer has it')
check(secret.images.length === 0 && !JSON.stringify(secret.context).includes(HIDDEN), 'neither its images nor its prompt')

done('privacy')
