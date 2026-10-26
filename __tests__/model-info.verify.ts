/**
 * What is kept about each model (lib/models/info.ts): the checks on what is
 * sent, the file it is kept in, the route (this machine only), and laying it
 * over the generate form.
 *
 * Run with: npm test -- model-info
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { DELETE, GET, PUT } from '../app/api/models/info/route'
import { applyModelInfo, CUSTOM_PRESET, DEFAULT, defaultForm, modelInfoFromForm } from '../lib/generate/form'
import {
  MAX_MODEL_INFO_ENTRIES,
  modelInfoPath,
  modelKey,
  modelName,
  NewerModelInfoError,
  parseStoredModelInfo,
  readModelInfo,
  safeUrl,
  saveModelInfo,
  TooManyModelsError,
  validateModelInfo,
  type ModelInfo,
} from '../lib/models/info'
import { privateFiles } from '../lib/security/private-files'
import { getProfile } from '../lib/profiles'

// ── Names ──
eq(modelName('sdxl\\anime\\waiNSFW_v14.safetensors [a1b2c3d4]'), 'waiNSFW_v14.safetensors', "A1111's folder and hash are dropped")
eq(modelName('checkpoints/waiNSFW_v14.safetensors'), 'waiNSFW_v14.safetensors', "a ComfyUI path's folder too")
eq(modelKey('WaiNSFW_v14.safetensors'), modelKey('wainsfw_v14.safetensors'), 'case does not make another model')
check(modelName('..') === null && modelName('') === null && modelName('a\u0000b') === null && modelName(42) === null, 'not a file name: refused')
check(modelName('x'.repeat(201)) === null, 'nor one past 200 characters')
check(['__proto__', 'Constructor', 'prototype'].every((name) => modelName(name) === null), "nor a name every object already has, so no key reaches a prototype")
eq(modelName('x [not a hash].safetensors'), 'x [not a hash].safetensors', 'only a trailing [hex] is taken for the hash')
{
  const started = Date.now()
  check(modelName(' '.repeat(100_000) + 'x') === null && modelName('a' + ' '.repeat(5_000) + '[0') === null, 'a long name is refused')
  check(Date.now() - started < 200, 'without a slow pattern running over it')
}

// ── Links ──
eq(safeUrl('https://civitai.com/models/1'), 'https://civitai.com/models/1', 'an https link is kept')
check(safeUrl('javascript:alert(1)') === null && safeUrl('file:///C:/x') === null && safeUrl('data:text/html,x') === null, 'nothing but http(s) can reach an href')
check(safeUrl('https://x/\u0007') === null && safeUrl('not a link') === null, 'nor a broken one')

// ── What is sent ──
{
  const good = validateModelInfo(
    {
      url: 'https://huggingface.co/x',
      notes: 'line one\nline two',
      sampler: 'Euler a',
      scheduler: '',
      steps: 28,
      cfg: 5.5,
      width: 832,
      height: 1216,
      hires: { scale: 1.5, steps: 0, denoise: 0.35, upscaler: 'Lanczos' },
      extra: 'dropped',
    },
    'x.safetensors',
    1
  )
  eq(
    good.info,
    {
      name: 'x.safetensors',
      updatedAt: 1,
      url: 'https://huggingface.co/x',
      notes: 'line one\nline two',
      sampler: 'Euler a',
      steps: 28,
      cfg: 5.5,
      width: 832,
      height: 1216,
      hires: { scale: 1.5, steps: 0, denoise: 0.35, upscaler: 'Lanczos' },
    },
    'known fields are kept, empty and unknown ones are not'
  )
  const bad = validateModelInfo(
    { url: 'ftp://x', notes: 'a\u0007', steps: 2.5, cfg: 31, width: 1001, height: 100, sampler: 'x'.repeat(201), hires: { scale: 9 } },
    'x.safetensors'
  )
  eq(
    bad.errors,
    {
      url: 'modelInfo.errorUrl',
      notes: 'settings.errorText',
      sampler: 'settings.errorText',
      steps: 'settings.errorSteps',
      cfg: 'settings.errorCfg',
      width: 'settings.errorSize',
      height: 'settings.errorSize',
      hires: 'modelInfo.errorHires',
    },
    'each bad field is named'
  )
}

// ── The stored file ──
{
  const parsed = parseStoredModelInfo({
    version: 1,
    models: {
      'a.safetensors': { name: 'A.safetensors', steps: 20, updatedAt: 5 },
      'b.safetensors': { name: 'other.safetensors', steps: 20 },
      'c.safetensors': { name: 'c.safetensors', steps: 'many' },
    },
  })
  eq(Object.keys(parsed), ['a.safetensors'], 'a hand-edited file keeps the entries that still check out')
  eq(parsed['a.safetensors'].updatedAt, 5, 'with their time')
}

const form = { ...defaultForm(getProfile('sdxl')), prompt: 'kept', sampler: 'Euler', scheduler: 'Karras', presetName: 'fast' }
const options = { samplers: ['Euler', 'Euler a'], schedulers: ['Karras'], upscalers: ['Lanczos'] }

// ── Over the form ──
{
  const info: ModelInfo = { name: 'x.safetensors', updatedAt: 0, sampler: 'Euler a', scheduler: 'Exponential', steps: 24, cfg: 4, width: 896, height: 1152 }
  const { form: next, skipped } = applyModelInfo(form, info, options)
  eq([next.sampler, next.scheduler, next.steps, next.cfg, next.width, next.height], ['Euler a', 'Karras', 24, 4, 896, 1152], 'what the info says replaces, a scheduler the backend lacks does not')
  eq(skipped, ['Exponential'], 'and is named')
  eq([next.prompt, next.negativePrompt, next.hires, next.presetName], ['kept', form.negativePrompt, false, CUSTOM_PRESET], 'the prompt and what the info leaves out stay')
  const none = applyModelInfo(form, { ...info, sampler: 'DPM++' }, { samplers: [], schedulers: [], upscalers: [] })
  eq([none.form.sampler, none.skipped], ['Euler', []], 'on a backend with no sampler choice, nothing is said')
  const hires = applyModelInfo(form, { name: 'x', updatedAt: 0, hires: { scale: 1.5, steps: 10, denoise: 0.3, upscaler: '4x-UltraSharp' } }, options)
  eq([hires.form.hires, hires.form.hrScale, hires.form.hrUpscaler, hires.skipped], [true, 1.5, form.hrUpscaler, ['4x-UltraSharp']], 'hires fix turns on, keeping the upscaler when it is not offered')
  const back = modelInfoFromForm({ ...form, sampler: DEFAULT })
  check(!('sampler' in back) && back.scheduler === 'Karras' && back.steps === form.steps && !('hires' in back), '"Use current values": the backend\'s Default is not a recommendation')
}

const ORIGIN = 'http://127.0.0.1:3000'
const LOCAL = { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' }
const PHONE = { host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' }
const request = (pathname: string, method: string, from: Record<string, string>, body?: unknown) =>
  new Request(`${ORIGIN}${pathname}`, { method, headers: { ...from, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const read = async (response: Response) => [response.status, await response.json()] as [number, Record<string, unknown>]

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-model-info-'))
  process.env.LATENTRY_SETTINGS_FILE = path.join(scratch, 'latentry.settings.json')
  try {
    const file = modelInfoPath()
    eq(path.dirname(file), scratch, 'kept next to the settings file')
    check(privateFiles().includes(file), 'and made owner-only at start with the other private files')

    // ── The file ──
    await saveModelInfo('a.safetensors', { name: 'A.safetensors', steps: 20, updatedAt: 1 })
    eq(readModelInfo()['a.safetensors']?.steps, 20, 'saved and read back')
    eq(readdirSync(scratch).sort(), ['latentry.models.json'], 'with no temp file left behind')
    eq(JSON.parse(readFileSync(file, 'utf8')).version, 1, 'the file says its version')
    await saveModelInfo('a.safetensors', null)
    eq(readModelInfo(), {}, 'and forgotten')

    const many = Object.fromEntries(Array.from({ length: MAX_MODEL_INFO_ENTRIES }, (_, i) => [`m${i}`, { name: `m${i}`, updatedAt: 0 }]))
    writeFileSync(file, JSON.stringify({ version: 1, models: many }))
    const full = await saveModelInfo('one-more', { name: 'one-more', updatedAt: 0 }).then(() => null, (error) => error)
    check(full instanceof TooManyModelsError, `no more than ${MAX_MODEL_INFO_ENTRIES} models`)
    await saveModelInfo('m0', { name: 'm0', steps: 9, updatedAt: 0 })
    eq(readModelInfo().m0.steps, 9, 'though one already kept can still change')

    writeFileSync(file, JSON.stringify({ version: 2, models: { 'a.safetensors': { name: 'a.safetensors', steps: 30, updatedAt: 0 }, future: 'x' } }))
    eq(readModelInfo()['a.safetensors']?.steps, 30, 'a newer release\'s file is read as far as it can be')
    const newer = await saveModelInfo('b', { name: 'b', updatedAt: 0 }).then(() => null, (error) => error)
    check(newer instanceof NewerModelInfoError, 'but not written over')
    check(readFileSync(file, 'utf8').includes('future'), 'so nothing in it is lost')
    rmSync(file)

    // ── The route ──
    const name = encodeURIComponent('sdxl\\WaiNSFW_v14.safetensors [abcd1234]')
    for (const [method, body] of [['GET', undefined], ['PUT', { name: 'x.safetensors', info: {} }], ['DELETE', undefined]] as const) {
      const [status] = await read(await { GET, PUT, DELETE }[method](request(`/api/models/info?name=${name}`, method, PHONE, body)))
      eq(status, 403, `a phone may not ${method} model info: names and links say what is on this computer`)
    }
    eq(await read(await GET(request(`/api/models/info?name=${name}`, 'GET', LOCAL))), [200, { info: null }], 'this machine: nothing kept yet')
    const [badStatus, bad] = await read(await PUT(request('/api/models/info', 'PUT', LOCAL, { name: 'x.safetensors', info: { url: 'javascript:alert(1)' } })))
    eq([badStatus, bad.errors], [422, { url: 'modelInfo.errorUrl' }], 'a bad link is refused by name')
    eq((await read(await PUT(request('/api/models/info', 'PUT', LOCAL, { name: '..', info: {} }))))[0], 400, 'so is a name that is not a file')
    const [saved, body] = await read(
      await PUT(request('/api/models/info', 'PUT', LOCAL, { name: 'sdxl/WaiNSFW_v14.safetensors', info: { url: 'https://civitai.com/models/1', steps: 28 } }))
    )
    eq([saved, (body.info as ModelInfo).name, (body.info as ModelInfo).steps], [200, 'WaiNSFW_v14.safetensors', 28], 'saved under its file name')
    const [, again] = await read(await GET(request(`/api/models/info?name=${name}`, 'GET', LOCAL)))
    eq((again.info as ModelInfo | null)?.url, 'https://civitai.com/models/1', "and found by A1111's name for the same file")
    eq(Object.keys((await read(await GET(request('/api/models/info', 'GET', LOCAL))))[1].models as object), ['wainsfw_v14.safetensors'], 'the whole list, by key')
    eq(await read(await DELETE(request(`/api/models/info?name=${name}`, 'DELETE', LOCAL))), [200, { info: null }], 'and deleted')
    eq(readModelInfo(), {}, 'gone from the file')
  } finally {
    delete process.env.LATENTRY_SETTINGS_FILE
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('model-info'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
