/**
 * The gallery's search box (lib/gallery/query.ts): commas separate terms, a
 * tag of several words stays one term, and quotes match a tag exactly.
 *
 * Run with: npm test -- query
 */
import { check, done, eq } from './assert'
import { exactTagQuery, matchesQuery, normalizeTag, parseQuery, searchableOf } from '../lib/gallery/query'
import type { ImageMeta } from '../lib/image-meta'

eq(parseQuery('long hair, smile'), [{ text: 'long hair', exact: false }, { text: 'smile', exact: false }], 'commas separate; spaces stay inside a term')
eq(parseQuery('"long hair"'), [{ text: 'long hair', exact: true }], 'quotes make an exact tag')
eq(parseQuery('"long_hair",  Outdoors ,,'), [{ text: 'long hair', exact: true }, { text: 'outdoors', exact: false }], 'underscores, case and empty terms')
eq(parseQuery('"name, with comma"'), [{ text: 'name, with comma', exact: true }], 'a comma inside quotes stays')
eq(parseQuery(''), [], 'nothing to search')

eq(normalizeTag('(long hair:1.2)'), 'long hair', 'weight and emphasis removed')
eq(normalizeTag('[[Long_Hair]]'), 'long hair', 'nested brackets')
eq(normalizeTag('hatsune miku \\(cosplay\\)'), 'hatsune miku (cosplay)', 'escaped parentheses are part of the tag')
eq(exactTagQuery('long hair'), '"long hair"', 'a tag sent from the viewer')

const meta: ImageMeta = {
  source: 'latentry',
  prompt: 'masterpiece, 1girl, very long hair, (smile:1.1), school uniform',
  negativePrompt: 'lowres',
  model: 'noobai-xl',
  tags: [{ name: 'blue_eyes', category: 0, score: 0.9 }],
}
const picture = searchableOf('20261004_sdxl_1_0.png', meta)
const find = (query: string) => matchesQuery(picture, parseQuery(query))

check(find('long hair'), 'a phrase matches inside the prompt')
check(!find('"long hair"'), '"long hair" does not match "very long hair"')
check(find('"very long hair"'), 'the exact tag does')
check(find('"smile"'), 'a weighted tag matches its bare name')
check(find('"blue eyes"'), 'WD14 tags match, underscores or not')
check(find('"school uniform", noobai'), 'a tag and a model together')
check(!find('"school uniform", pony'), 'every term must match')
check(!find('"lowres"'), 'the negative prompt is not searched')
check(find('sdxl'), 'the file name is searched')

// ── key:value settings ──
eq(parseQuery('model: NoobAI_XL'), [{ text: 'model: noobai xl', exact: false, field: { key: 'model', contains: 'noobai xl' } }], 'a setting term, normalised like text')
eq(parseQuery('steps:>=30, w:1024'), [
  { text: 'steps:>=30', exact: false, field: { key: 'steps', op: '>=', value: 30 } },
  { text: 'w:1024', exact: false, field: { key: 'w', op: '=', value: 1024 } },
], 'numbers, with = by default')
eq(parseQuery('score:9, steps:many, (smile:1.1), model:'), [
  { text: 'score:9', exact: false },
  { text: 'steps:many', exact: false },
  { text: '(smile:1.1)', exact: false },
  { text: 'model:', exact: false },
], 'unknown keys, words for numbers, weights and empty values stay text')
eq(parseQuery('"model:x"'), [{ text: 'model:x', exact: true }], 'quoted, it is a tag')

const set = searchableOf('a.png', { ...meta, sampler: 'DPM++ 2M', seed: 42, steps: 30, cfg: 4.5, width: 832, height: 1216 }, { width: 1664, height: 2432 })
const findSet = (query: string) => matchesQuery(set, parseQuery(query))
check(findSet('model:noobai'), 'model contains')
check(findSet('model:NOOBAI-XL'), 'model, any case')
check(!findSet('model:pony'), 'another model does not match')
check(findSet('sampler:dpm++'), 'sampler contains')
check(findSet('seed:42') && !findSet('seed:4'), 'seed equals')
check(findSet('steps:>=30') && findSet('steps:<=30') && !findSet('steps:>30') && !findSet('steps:<30'), 'comparisons')
check(findSet('cfg:4.5') && findSet('cfg:>4'), 'decimals')
check(findSet('w:1664') && !findSet('w:832'), 'the real size wins over the settings')
check(matchesQuery(searchableOf('a.png', { ...meta, width: 832 }), parseQuery('w:832')), "the settings' size stands in")
check(!findSet('h:>3000'), 'height')
check(!matchesQuery(searchableOf('a.png', null), parseQuery('steps:>0')), 'a picture without the setting does not match')
check(findSet('model:noobai, "very long hair", steps:30'), 'settings, tags and text together')

// ── LoRAs ──
const withLora = searchableOf('b.png', { ...meta, prompt: '1girl, <lora:Detail_Tweaker:0.6>, smile', loras: ['Detail_Tweaker', 'flat color'] })
const findLora = (query: string) => matchesQuery(withLora, parseQuery(query))
check(findLora('lora:detail') && findLora('lora:FLAT_COLOR'), 'lora: matches any of its LoRAs, as text')
check(!findLora('lora:pony'), 'another LoRA does not match')
check(!matchesQuery(searchableOf('c.png', meta), parseQuery('lora:detail')), 'a picture without LoRAs does not match')
check(findLora('detail tweaker'), 'LoRA names are searched as plain text too')
check(![...withLora.tags].some((tag) => tag.includes('lora')), 'a <lora:…> call is not a tag')

// ── Leaving out ──
eq(parseQuery('-smile'), [{ text: 'smile', exact: false, negate: true }], 'a leading - leaves out')
eq(parseQuery('-"long hair"'), [{ text: 'long hair', exact: true, negate: true }], 'before a quoted tag too')
eq(parseQuery(' - , -model:pony'), [{ text: 'model:pony', exact: false, field: { key: 'model', contains: 'pony' }, negate: true }], 'a lone - is nothing; a setting can be left out')
eq(parseQuery('x-ray, seed:-1'), [
  { text: 'x-ray', exact: false },
  { text: 'seed:-1', exact: false, field: { key: 'seed', op: '=', value: -1 } },
], 'a - inside a term or a value is not one')
check(!find('-smile') && find('-pony') && find('"school uniform", -"long hair"'), 'leaving out, alone and with other terms')
check(!find('-model:noobai') && find('-model:pony'), 'leaving out a setting')
check(!findLora('-lora:detail') && find('-lora:detail'), 'leaving out a LoRA')

done('query')
