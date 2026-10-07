/**
 * Privacy audit (2026-10): what secret mode keeps out of browser storage
 * (lib/storage.ts, lib/secret-mode.ts), and what the server's job record
 * (lib/diffusion/job-store.ts) still hands to any client after a run.
 *
 * Gaps found by the audit are pinned with knownGap(); see
 * audit/2026-10-privacy-audit.md (local, not committed) for the IDs.
 *
 * Run with: npm test -- privacy
 */
import { check, done, eq, knownGap } from './assert'
import { drainHandoff, preferences, pushHandoff, STORAGE_KEYS } from '../lib/storage'
import { applyEvent, getCurrentJob, getJob, isResumable, RESUME_WINDOW_MS, startJob, toSnapshot, type JobContext } from '../lib/diffusion/job-store'

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

const SECRET = 'zzaudit-secret-prompt'
const BEFORE = 'zzaudit-typed-before-secret'

// ── C1: typing while secret mode is on ──
store.clear()
preferences.setSecretMode(true)
check(preferences.getSecretMode(), 'secret mode reads back as on')
preferences.setForm('anima', { prompt: SECRET, negativePrompt: SECRET })
preferences.setSharedPrompt({ prompt: SECRET, artist: SECRET })
preferences.addCharacterPreset({ name: SECRET, tags: SECRET, artist: '', negativePrompt: '', seed: 1 })
eq(holding(SECRET), [], 'C1: the form, the shared prompt and characters are not stored in secret mode')

pushHandoff({ type: 'settings', settings: { prompt: SECRET, negativePrompt: SECRET } })
pushHandoff({ type: 'tags', tags: [SECRET], target: 'positive' })
knownGap(holding(SECRET).length === 0, 'F6', 'gallery → generate handoff writes the prompt to localStorage in secret mode')
eq(drainHandoff().length, 2, 'the handoff still reaches the form (in memory is fine)')
eq(holding(SECRET), [], 'a drained handoff leaves nothing behind')

// ── C2: what was typed before secret mode ──
store.clear()
preferences.setForm('anima', { prompt: BEFORE })
preferences.setSharedPrompt({ prompt: BEFORE, artist: '' })
eq(holding(BEFORE).sort(), [STORAGE_KEYS.FORM_PREFIX + 'anima', STORAGE_KEYS.SHARED_PROMPT].sort(), 'outside secret mode the form is kept')
preferences.setSecretMode(true)
knownGap(holding(BEFORE).length === 0, 'F7', 'turning secret mode on leaves the earlier prompt in localStorage')
preferences.setSecretMode(false)
knownGap(holding(BEFORE).length === 0, 'F7', 'turning secret mode off clears nothing either')
preferences.setSecretMode(false)
eq(store.get(STORAGE_KEYS.SECRET_MODE), 'false', 'the flag itself is a plain stored preference')

// ── F4: the server's record of a run ──
const context: JobContext = {
  request: { prompt: SECRET, negativePrompt: '', width: 64, height: 64, steps: 1, seed: 1, count: 1 } as unknown as JobContext['request'],
  profile: 'generic',
  kind: 'diffusers',
  model: null,
  mode: 'txt2img',
}
const job = startJob({ backend: 'audit', total: 1, steps: 1, context })
applyEvent(job, { type: 'image', index: 0, total: 1, seed: 1, imageBase64: 'iVBORw0K' } as Parameters<typeof applyEvent>[1])
applyEvent(job, { type: 'done' } as Parameters<typeof applyEvent>[1])
eq(job.status, 'done', 'the run finished')
check(!JSON.stringify(toSnapshot(job)).includes(SECRET), 'a snapshot never carries the prompt')
check(!('images' in toSnapshot(job)), '/job answers without the images')

// /job asks nothing of the caller but the backend id, and /job/stream only the job id it returns.
knownGap(!(getCurrentJob('audit') && isResumable(getCurrentJob('audit')!)), 'F4', 'a finished run is offered to any client for an hour')
check(JSON.stringify(toSnapshot(job, { includeImages: true })).includes('iVBORw0K'), 'the stream snapshot carries the images')

job.endedAt = Date.now() - RESUME_WINDOW_MS - 1
check(!isResumable(job), 'past the window the page no longer adopts the run')
knownGap(getJob('audit', job.id) === null, 'F4', '/job/stream still serves the images past the resume window (it checks only the id)')
check(getCurrentJob('audit')?.context.request.prompt === SECRET, 'the prompt stays in server memory until the next run or a restart')

done('privacy')
