/**
 * The settings file (lib/settings): what an edit may contain, how the file
 * and .env.local combine, who may change settings, profile overrides, and the
 * folder checks.
 *
 * Run with: npm test -- settings
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { getBackends, hasEnvToken, taggerPreference } from '../lib/backends/config'
import { autoTagEnabled, loraHashesEnabled, parseGalleryDirs } from '../lib/gallery/dirs'
import { getProfile, setProfileOverrides } from '../lib/profiles'
import { editMode, editRefusal } from '../lib/settings/access'
import { EMPTY_SETTINGS, parseStoredSettings, redactSettings, validateSettings, type Settings } from '../lib/settings/schema'
import { checkDir } from '../lib/settings/store'

const ABS = process.platform === 'win32' ? 'C:\\pictures' : '/pictures'

async function main() {
  // ── Validating an edit ──
  const ok = validateSettings(
    {
      backends: [
        { id: ' Anima ', kind: 'diffusers', url: 'http://localhost:7865', profile: 'anima', token: 'secret' },
        { id: 'sdxl', kind: 'a1111', url: 'http://192.168.1.5:7860', profile: 'illustrious' },
      ],
      tagger: 'anima',
      gallery: { saveDir: ABS, dirs: [ABS + '2', '  '], autoTag: true, loraHashes: 'yes' },
      profiles: { sdxl: { width: 1152, height: 896, steps: 30, cfg: 6, qualityTags: 'best', artistTemplate: '-'.replace('-', ''), tagStyle: 'space', keepTags: '' }, nope: { width: 1 } },
    },
    EMPTY_SETTINGS
  )
  check(ok.ok, 'a sound edit passes')
  if (ok.ok) {
    eq(ok.settings.backends?.map((backend) => [backend.id, backend.token ?? null]), [['anima', 'secret'], ['sdxl', null]], 'ids are lowercased; tokens kept when given')
    eq(ok.settings.gallery, { saveDir: ABS, dirs: [ABS + '2'], autoTag: true, loraHashes: false }, 'empty folder rows are dropped; only true turns LoRA hashes on')
    eq(ok.settings.profiles, { sdxl: { width: 1152, height: 896, steps: 30, cfg: 6, qualityTags: 'best', keepTags: '', artistTemplate: null, tagStyle: 'space' } }, 'unknown profiles are ignored; "" hides the artist field; tag spelling kept')
  }

  const bad = validateSettings(
    {
      backends: [
        { id: 'Bad Id', kind: 'comfy', url: 'file:///etc', profile: 'flux' },
        { id: 'a', kind: 'a1111', url: 'http://x', profile: 'sdxl' },
        { id: 'a', kind: 'a1111', url: 'http://y', profile: 'sdxl' },
      ],
      gallery: { saveDir: 'relative/path', dirs: ['also/relative'] },
      profiles: { anima: { width: 1001, steps: 0.5, cfg: 99, artistTemplate: 'no placeholder', tagStyle: 'dashes' } },
    },
    EMPTY_SETTINGS
  )
  check(!bad.ok, 'a bad edit fails')
  if (!bad.ok) {
    eq(
      Object.keys(bad.errors).sort(),
      [
        'backends.0.id',
        'backends.0.kind',
        'backends.0.profile',
        'backends.0.url',
        'backends.2.id',
        'gallery.dirs.0',
        'gallery.saveDir',
        'profiles.anima.artistTemplate',
        'profiles.anima.cfg',
        'profiles.anima.steps',
        'profiles.anima.tagStyle',
        'profiles.anima.width',
      ],
      'every bad field is named'
    )
  }

  // Tokens are write-only: absent keeps, "" clears, a value replaces.
  const current: Settings = { version: 1, backends: [{ id: 'a', kind: 'a1111', url: 'http://x/', profile: 'sdxl', token: 'old' }] }
  const keep = validateSettings({ backends: [{ id: 'a', kind: 'a1111', url: 'http://x', profile: 'sdxl' }] }, current)
  const clear = validateSettings({ backends: [{ id: 'a', kind: 'a1111', url: 'http://x', profile: 'sdxl', token: '' }] }, current)
  const replace = validateSettings({ backends: [{ id: 'a', kind: 'a1111', url: 'http://x', profile: 'sdxl', token: 'new' }] }, current)
  eq(
    [keep, clear, replace].map((result) => (result.ok ? result.settings.backends?.[0].token ?? null : 'error')),
    ['old', null, 'new'],
    'token: keep / clear / replace'
  )
  // A saved token stays with its server: a new address needs it typed again.
  const moved = (url: string, token?: string) =>
    validateSettings({ backends: [{ id: 'a', kind: 'a1111', url, profile: 'sdxl', ...(token === undefined ? {} : { token }) }] }, current)
  const movedAway = moved('http://evil.example/')
  check(!movedAway.ok && movedAway.errors['backends.0.token'] === 'settings.errorTokenMoved', 'a new host without the token is refused')
  check(!moved('http://x:8080/').ok && !moved('https://x/').ok, 'so is a new port or scheme')
  check(moved('http://x/sdapi').ok && (moved('http://x/sdapi') as { ok: true; settings: Settings }).settings.backends?.[0].token === 'old', 'a new path on the same server keeps it')
  eq([moved('http://evil.example/', ''), moved('http://evil.example/', 'typed')].map((result) => (result.ok ? result.settings.backends?.[0].token ?? null : 'error')), [null, 'typed'], 'moving works with the token removed or typed again')
  // Parts not sent are kept; null hands them back to .env.local.
  const partial = validateSettings({ tagger: null }, { ...current, gallery: { saveDir: ABS } })
  check(partial.ok && partial.settings.backends?.length === 1 && partial.settings.gallery?.saveDir === ABS && partial.settings.tagger === null, 'parts not sent are kept')
  const reset = validateSettings({ backends: null }, current)
  check(reset.ok && reset.settings.backends === undefined, 'null removes a part')

  eq(redactSettings(current).backends, [{ id: 'a', kind: 'a1111', url: 'http://x/', profile: 'sdxl', hasToken: true }], 'tokens never leave redacted settings')

  // A hand-edited file with one bad part keeps the rest.
  const salvaged = parseStoredSettings({ version: 1, backends: [{ id: 'BAD ID' }], gallery: { saveDir: ABS } })
  check(salvaged.backends === undefined && salvaged.gallery?.saveDir === ABS, 'a broken part of the file is dropped, the rest kept')
  eq(parseStoredSettings('nonsense'), EMPTY_SETTINGS, 'a broken file is empty settings')

  // ── File over environment ──
  const env = { GEN_BACKENDS: 'envone|diffusers|http://localhost:1|generic', GEN_TOKEN_A: 'from-env', TAGGER_BACKEND: 'envone', GALLERY_SAVE_DIR: ABS + '-env', GALLERY_DIRS: ABS + '-x', GALLERY_AUTO_TAG: '1' }
  eq(getBackends(env, EMPTY_SETTINGS).map((backend) => backend.id), ['envone'], 'no settings: the environment')
  const fromFile = getBackends(env, { version: 1, backends: [{ id: 'a', kind: 'a1111', url: 'http://x/', profile: 'sdxl' }] })
  eq(fromFile.map((backend) => [backend.id, backend.token ?? null]), [['a', null]], 'saved backends replace GEN_BACKENDS; GEN_TOKEN_<ID> without an address there is not sent')
  const envBound = { GEN_BACKENDS: 'a|a1111|http://x:7860|sdxl', GEN_TOKEN_A: 'from-env' }
  const saved = (url: string) => getBackends(envBound, { version: 1, backends: [{ id: 'a', kind: 'a1111', url, profile: 'sdxl' }] })[0].token ?? null
  eq([saved('http://x:7860/'), saved('http://x:7860/sdapi'), saved('http://evil.example:7860/'), saved('http://x:7861/')], ['from-env', 'from-env', null, null], 'GEN_TOKEN_<ID> only goes to the address GEN_BACKENDS gives that id')
  check(hasEnvToken('a', 'http://x:7860/', envBound) && !hasEnvToken('a', 'http://evil.example/', envBound), 'the settings page says so too')
  eq(getBackends(env, current)[0].token, 'old', 'a saved token wins over the environment')
  eq([taggerPreference(env, EMPTY_SETTINGS), taggerPreference(env, { version: 1, tagger: null })], ['envone', null], 'tagger: setting over TAGGER_BACKEND')
  const dirs = parseGalleryDirs(env, { version: 1, gallery: { saveDir: null } })
  eq(dirs.map((dir) => dir.writable), [false], 'saveDir null turns saving off while GALLERY_DIRS still applies')
  eq(parseGalleryDirs(env, { version: 1, gallery: { dirs: [] } }).map((dir) => dir.writable), [true], 'dirs [] clears the read-only folders')
  eq([loraHashesEnabled(EMPTY_SETTINGS), loraHashesEnabled({ version: 1, gallery: { loraHashes: true } })], [false, true], 'LoRA hashes: off unless the setting turns them on')
  eq([autoTagEnabled(env, EMPTY_SETTINGS), autoTagEnabled(env, { version: 1, gallery: { autoTag: false } })], [true, false], 'auto-tag: setting over GALLERY_AUTO_TAG')

  // ── Profiles ──
  setProfileOverrides({ illustrious: { width: 896, artistTemplate: null, negativePrompt: 'custom' } })
  const illustrious = getProfile('illustrious')
  eq([illustrious.defaults.width, illustrious.defaults.height, illustrious.artistTemplate, illustrious.defaults.negativePrompt], [896, 1216, null, 'custom'], 'an override replaces only what it names')
  setProfileOverrides(null)
  eq(getProfile('illustrious').defaults.width, 832, 'cleared overrides restore the built-in values')

  // ── Who may edit ──
  const headers = (host: string, forwarded?: string) => new Headers({ host, ...(forwarded ? { 'x-forwarded-for': forwarded } : {}) })
  eq(editMode({}), 'local', 'the default is local only')
  eq(editRefusal(headers('localhost:3000', '127.0.0.1'), {}), null, 'localhost may edit')
  eq(editRefusal(headers('127.0.0.1:3000', '::1'), {}), null, 'loopback by IP may edit')
  eq(editRefusal(headers('192.168.1.20:3000', '192.168.1.30'), {}), 'notLocal', 'a phone on the LAN may not')
  eq(editRefusal(headers('localhost:3000', '192.168.1.30'), {}), 'notLocal', 'a LAN client behind a localhost Host may not')
  eq(editRefusal(headers('192.168.1.20:3000', '192.168.1.30'), { SETTINGS_EDIT: 'lan' }), null, 'SETTINGS_EDIT=lan opens it to the network')
  eq(editRefusal(headers('localhost:3000', '127.0.0.1'), { SETTINGS_EDIT: 'off' }), 'off', 'SETTINGS_EDIT=off closes it everywhere')

  // ── Folder checks ──
  const root = await mkdtemp(path.join(tmpdir(), 'latentry-settings-'))
  try {
    const file = path.join(root, 'file.txt')
    await writeFile(file, 'x')
    eq(await checkDir(root, { writable: true }), 'ok', 'a writable folder')
    eq(await checkDir(path.join(root, 'nope')), 'missing', 'a missing folder')
    eq(await checkDir(file), 'notDirectory', 'a file')
    eq(await checkDir(path.join(root, 'new', 'deep'), { writable: true, create: true }), 'created', 'a missing save folder is created')
  } finally {
    await rm(root, { recursive: true, force: true })
  }

  done('settings')
}

void main()
