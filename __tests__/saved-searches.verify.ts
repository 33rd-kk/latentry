/**
 * Saved gallery searches (lib/gallery/saved-searches.ts): what is saved, how
 * a stored list is read back, and the limits.
 *
 * Run with: npm test -- saved-searches
 */
import { check, done, eq } from './assert'
import {
  canSave,
  cleanName,
  currentSearch,
  MAX_NAME,
  MAX_SAVED,
  parseSaved,
  removeSearch,
  renameSearch,
  savedParams,
  savedQuery,
  saveSearch,
  serializeSaved,
  suggestedName,
  type SavedSearch,
} from '../lib/gallery/saved-searches'

let n = 0
const id = () => `id${++n}`

// What is saved: everything but an opened stack, and nothing that is default.
eq(savedParams({}), '', 'an empty query saves nothing')
eq(savedParams({ sort: 'newest' }), '', 'the default order alone saves nothing')
check(!canSave({ q: '  ' }), 'blank words are nothing to save')
check(canSave({ minStars: 3 }), 'a filter alone can be saved')
eq(
  savedParams({ q: 'lighthouse', group: 'seed', stack: 'abc', source: 'comfyui' }),
  'q=lighthouse&source=comfyui&group=seed',
  'the opened stack is left out, the grouping kept'
)
eq(
  savedQuery({ id: 'a', name: 'x', params: 'q=sea&model=foo&stars=4' }),
  {
    q: 'sea',
    sort: 'newest',
    model: 'foo',
    minStars: 4,
  },
  'a saved query reads back through the same checks as the API'
)

// Names.
eq(cleanName('  two\u0000\nlines   here '), 'two lines here', 'control characters and runs of spaces become one space')
eq(Array.from(cleanName('あ'.repeat(MAX_NAME + 5))).length, MAX_NAME, 'a long name is cut at MAX_NAME characters')
eq(suggestedName({ q: 'blue sky, -rain' }), 'blue sky, -rain', 'the search words are the offered name')
eq(suggestedName({ minStars: 5 }), '', 'no words, no offered name')

// Saving.
let list: SavedSearch[] = []
let result = saveSearch(list, 'Sea', { q: 'sea' }, id)
check(!('error' in result), 'a first search is saved')
if (!('error' in result)) list = result.searches
eq(list.map((search) => search.name), ['Sea'], 'it is in the list')
eq(saveSearch(list, '   ', { q: 'x' }, id), { error: 'name' }, 'a blank name is refused')
eq(saveSearch(list, 'Empty', {}, id), { error: 'empty' }, 'an empty query is refused')
result = saveSearch(list, 'sea', { q: 'ocean', minStars: 2 }, id)
check(!('error' in result) && result.searches.length === 1, 'the same name in another case replaces that search')
if (!('error' in result)) {
  eq(result.id, list[0].id, 'it keeps its id')
  list = result.searches
}
eq(list[0].params, 'q=ocean&stars=2', 'with the new query')
eq(list[0].name, 'sea', 'and the name as typed this time')

let full: SavedSearch[] = []
for (let i = 0; i < MAX_SAVED; i += 1) {
  const next = saveSearch(full, `s${i}`, { q: `w${i}` }, id)
  if (!('error' in next)) full = next.searches
}
eq(full.length, MAX_SAVED, 'the list fills up to MAX_SAVED')
eq(saveSearch(full, 'one more', { q: 'x' }, id), { error: 'full' }, 'one more is refused')
check(!('error' in saveSearch(full, 'S3', { q: 'y' }, id)), 'a full list can still save over a name it has')

// Current, rename, remove.
const two = (() => {
  let out: SavedSearch[] = []
  for (const [name, q] of [['A', 'a'], ['B', 'b']]) {
    const next = saveSearch(out, name, { q }, id)
    if (!('error' in next)) out = next.searches
  }
  return out
})()
eq(currentSearch(two, { q: 'b', sort: 'newest' })?.name, 'B', 'the query on screen is found among the saved')
eq(currentSearch(two, { q: 'b', group: 'seed', stack: 'k' }), null, 'a different query is none of them')
eq(currentSearch(two, {}), null, 'an empty query is never a saved one')
eq(renameSearch(two, two[0].id, 'b'), null, 'a rename to another search’s name is refused')
eq(renameSearch(two, two[0].id, ' '), null, 'a rename to nothing is refused')
eq(renameSearch(two, two[0].id, 'a')?.[0].name, 'a', 'a rename to its own name in another case is fine')
eq(removeSearch(two, two[0].id).map((search) => search.name), ['B'], 'remove takes that one out')

// Stored form.
eq(serializeSaved([]), null, 'an empty list is not stored at all')
const stored = serializeSaved(two)
eq(parseSaved(stored), two, 'a stored list reads back the same')
eq(parseSaved(null), [], 'nothing stored is an empty list')
eq(parseSaved('{oops'), [], 'broken JSON is an empty list')
eq(parseSaved(JSON.stringify({ version: 2, searches: two })), [], 'another version is not guessed at')
eq(
  parseSaved(
    JSON.stringify({
      version: 1,
      searches: [
        { id: 'ok', name: 'Kept', params: 'q=x&source=bogus&sort=nope' },
        { id: 'ok', name: 'Same id', params: 'q=y' },
        { id: 'bad id!', name: 'Bad id', params: 'q=y' },
        { id: 'n2', name: 'kept', params: 'q=z' },
        { id: 'n3', name: 'Empty', params: 'stack=abc' },
        { id: 'n4', name: 42, params: 'q=y' },
        'junk',
        { id: 'n5', name: ' Spaced\tname ', params: 'q=w&stars=9' },
      ],
    })
  ),
  [
    { id: 'ok', name: 'Kept', params: 'q=x' },
    { id: 'n5', name: 'Spaced name', params: 'q=w' },
  ],
  'unknown values, repeated ids and names, bad ids, empty queries and junk are left out'
)
const many = JSON.stringify({ version: 1, searches: Array.from({ length: MAX_SAVED + 10 }, (_, i) => ({ id: `m${i}`, name: `m${i}`, params: `q=${i}` })) })
eq(parseSaved(many).length, MAX_SAVED, 'at most MAX_SAVED are read back')

done('saved-searches')
