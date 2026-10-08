/**
 * The generate page's form (lib/generate/form.ts): its defaults, which
 * sampler a backend accepts, and a gallery picture's settings laid over it.
 *
 * Run with: npm test -- generate-form
 */
import { check, done, eq } from './assert'
import { accepted, applySettings, callsLora, CUSTOM_PRESET, DEFAULT, defaultForm, type FormState } from '../lib/generate/form'
import { getProfile } from '../lib/profiles'

const sdxl = getProfile('sdxl')
const fresh = defaultForm(sdxl)
eq(
  [fresh.profile, fresh.width, fresh.height, fresh.steps, fresh.seed, fresh.sampler, fresh.presetName],
  ['sdxl', 1024, 1024, 28, -1, DEFAULT, CUSTOM_PRESET],
  "a fresh form takes the profile's defaults"
)
check(fresh.quality === Boolean(sdxl.qualityTags), 'quality tags on where the profile has them')

eq(accepted('Euler a', ['Euler', 'Euler a']), 'Euler a', 'a sampler the backend has stays')
eq(accepted('DPM++ 2M', ['Euler', 'Euler a']), 'Euler', 'one it lacks falls back to its first')
eq(accepted('anything', []), 'anything', 'a backend that lists none takes what is asked')

const form: FormState = { ...fresh, artist: 'someone', quality: true, width: 832, height: 1216, steps: 30, cfg: 5, sampler: 'Euler', presetName: 'fast' }
const settings = {
  backend: 'sdxl-box',
  profile: 'anima',
  prompt: 'long hair, smile',
  negativePrompt: 'bad hands',
  seed: 42,
  width: 1216,
  height: 832,
  steps: 50,
  cfg: 4,
  sampler: 'DPM++ 2M',
}

const other = applySettings(form, settings, false)
eq(
  [other.prompt, other.artist, other.quality, other.seed],
  ['long_hair, smile', '', false, 42],
  "from another backend: the words in this form's spelling, and the seed"
)
eq(
  [other.width, other.height, other.steps, other.cfg, other.sampler, other.profile, other.negativePrompt, other.presetName],
  [832, 1216, 30, 5, 'Euler', 'sdxl', form.negativePrompt, 'fast'],
  'and nothing tuned for the other model'
)

const same = applySettings(form, settings, true)
eq(
  [same.profile, same.prompt, same.negativePrompt, same.width, same.height, same.steps, same.cfg, same.sampler, same.presetName],
  ['anima', 'long hair, smile', 'bad hands', 1216, 832, 50, 4, 'DPM++ 2M', CUSTOM_PRESET],
  "from the same backend: everything it says, in its own profile's spelling"
)
eq(applySettings(form, { prompt: 'cat', negativePrompt: '' }, true).width, 832, 'what a picture does not say stays as it was')

// ── <lora:…> in a prompt, warned about where the backend will not load it ──
check(callsLora('1girl, <lora:detail:0.8>, smile'), 'a <lora:name:weight> tag is found')
check(callsLora('<LyCORIS:x>') === false && callsLora('<lyco:style>'), '<lyco:…> counts, other angle brackets do not')
check(!callsLora('1girl, lora, <lora:>'), 'the word lora and an empty tag do not')

done('generate-form')
