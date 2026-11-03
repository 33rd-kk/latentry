/**
 * The search box's suggestions (lib/gallery/suggest.ts): which term the caret
 * is in, what is suggested for it, nothing named in secret mode, and the text
 * a suggestion leaves, read back as the search reads it.
 *
 * Run with: npm test -- suggest
 */
import { check, done, eq } from './assert'
import { parseQuery } from '../lib/gallery/query'
import { applySuggestion, MAX_SUGGESTIONS, suggest, termAt, type SuggestSource } from '../lib/gallery/suggest'

const source: SuggestSource = {
  tags: new Map([
    ['long hair', 5],
    ['very long hair', 9],
    ['looking at viewer', 2],
    ['smile', 7],
    ['hair ornament', 1],
  ]),
  models: ['noobaiXL_v11.safetensors', 'waiNSFW_v14.safetensors'],
  loras: ['ink style'],
  samplers: ['Euler a', 'DPM++ 2M'],
}
const at = (text: string, caret = text.length) => termAt(text, caret)
const labels = (text: string, secret = false, caret?: number) => suggest(at(text, caret), source, { secret }).map((item) => item.label)

// ── Which term ──
eq([at('smile, lon').start, at('smile, lon').end, at('smile, lon').typed], [6, 10, ' lon'.trimStart()], 'the term after the last comma')
eq(at('smile, lon, outdoors', 10).end, 10, 'and up to the next one')
eq([at('"long, hair').start, at('"long, hair').quoted, at('"long, hair').typed], [0, true, 'long, hair'], 'a comma inside quotes does not split')
eq([at('-smi').negate, at('-smi').typed], [true, 'smi'], 'a leading minus leaves out')
eq([at('steps:>').field, at('steps:>').typed], ['steps', '>'], 'a setting key')
eq(at('score:9').field, null, 'an unknown key is just text, as the search reads it')
eq(at('smile, lon', 3).typed, 'smi', 'up to the caret only')

// ── Tags ──
eq(labels('lo'), ['lora:', 'long hair', 'looking at viewer', 'very long hair'], 'a setting first, then tags starting with it (more pictures first), then those containing it')
eq(labels('long'), ['long hair', 'very long hair'], 'then those containing it')
eq(labels('hair'), ['hair ornament', 'very long hair', 'long hair'], 'each group by how many pictures carry it')
eq(labels('long_hai'), labels('long hai'), 'underscores are spaces')
eq(labels('LONG'), labels('long'), 'case does not matter')
eq(labels('smile'), [], 'a tag written in full has nothing to add')
eq(suggest(at('"lon'), source, { secret: false })[0].insert, '"long hair"', 'inside quotes: the exact tag, quoted')
eq(suggest(at('-lon'), source, { secret: false })[0].insert, '-long hair', 'with its minus')
eq(suggest(at('smi'), source, { secret: false })[0].count, 7, 'with how many shown pictures carry it')

// ── Settings ──
eq(labels('mo'), ['model:'], 'a setting\'s name, as it is typed')
eq(labels('s').slice(0, 3), ['sampler:', 'seed:', 'steps:'], 'all that start with it, before tags')
eq(labels('model:noob'), ['model:noobaiXL_v11.safetensors'], 'a model shown so far')
eq(labels('sampler:'), ['sampler:DPM++ 2M', 'sampler:Euler a'], 'the samplers shown so far')
eq(labels('steps:'), ['steps:>=', 'steps:<='], 'a number: the comparisons')
eq(labels('steps:30'), [], 'and nothing once one is typed')

// ── How to search ──
const empty = labels('')
check(empty[0] === '"…"' && empty[1] === '-…' && empty.includes('model:') && empty.includes('h:'), 'an empty term: exact, leave out, and every setting')
check(empty.length <= MAX_SUGGESTIONS, `at most ${MAX_SUGGESTIONS}`)
check(!labels('-').includes('-…'), 'no second minus')

// ── Secret mode ──
eq(labels('lon', true), [], 'secret mode: no tags')
eq(labels('model:noob', true), [], 'nor names')
eq(labels('mo', true), ['model:'], 'but how to write a search still')
eq(labels('', true), empty, 'all of it')

// ── Taking one ──
const take = (text: string, index = 0, caret = text.length) => {
  const term = at(text, caret)
  return applySuggestion(text, term, suggest(term, source, { secret: false })[index])
}
eq(take('smile, lon'), { text: 'smile, long hair, ', caret: 18 }, 'a tag in place of the term, and a comma to go on')
eq(take('smile, lon, outdoors', 0, 10), { text: 'smile, long hair, outdoors', caret: 18 }, 'in the middle, the comma already there is kept')
eq(take('mo'), { text: 'model:', caret: 6 }, 'a setting\'s name stays open for its value')
eq(take('"lon').text, '"long hair", ', 'a quoted tag, closed')
eq(
  parseQuery(take('smile, -lon').text).map((term) => [term.text, term.exact, term.negate ?? false]),
  [
    ['smile', false, false],
    ['long hair', false, true],
  ],
  'what is left reads back as the search reads it'
)
eq(parseQuery(take('"lon').text).map((term) => [term.text, term.exact]), [['long hair', true]], 'an exact tag too')

done('suggest')
