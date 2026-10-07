/**
 * The gallery's orders and page cursors (lib/gallery/sort.ts) and its query
 * string and filters (lib/gallery/filter.ts).
 *
 * Run with: npm test -- gallery-sort
 */
import { check, done, eq } from './assert'
import { compareEntries, encodeCursor, SORT_KEYS, startIndex, type SortKey } from '../lib/gallery/sort'
import {
  activeFilterCount,
  formatOf,
  fromParams,
  matchesCheap,
  matchesMeta,
  needsMeta,
  orientationOf,
  resolutionOf,
  sourceOf,
  toParams,
  type GalleryQuery,
} from '../lib/gallery/filter'

const ENTRIES = [
  { name: 'img10.png', mtime: 3000, size: 50 },
  { name: 'img2.png', mtime: 1000, size: 300 },
  { name: 'b.webp', mtime: 2000, size: 300 },
  { name: 'a.png', mtime: 2000, size: 100 },
  { name: 'odd:name.png', mtime: 500, size: 10 },
]

const order = (sort: SortKey) => [...ENTRIES].sort(compareEntries(sort)).map((entry) => entry.name)

// ── Orders ──
eq(order('newest'), ['img10.png', 'a.png', 'b.webp', 'img2.png', 'odd:name.png'], 'newest first; equal times by name')
eq(order('oldest'), ['odd:name.png', 'img2.png', 'a.png', 'b.webp', 'img10.png'], 'oldest first; equal times still by name')
eq(order('name-asc'), ['a.png', 'b.webp', 'img2.png', 'img10.png', 'odd:name.png'], 'names compare numbers as numbers')
eq(order('name-desc'), ['odd:name.png', 'img10.png', 'img2.png', 'b.webp', 'a.png'], 'name Z–A is the reverse')
eq(order('size-desc'), ['b.webp', 'img2.png', 'a.png', 'img10.png', 'odd:name.png'], 'largest first; equal sizes by name')
eq(
  compareEntries('name-asc')({ name: 'é.png', mtime: 0, size: 0 }, { name: 'é.png', mtime: 0, size: 0 }) !== 0,
  true,
  'names the collator calls equal still have an order'
)

// ── Cursors: paging one at a time visits every entry once, in every order ──
for (const sort of SORT_KEYS) {
  const sorted = [...ENTRIES].sort(compareEntries(sort))
  const visited: string[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 10; guard += 1) {
    const start = startIndex(sorted, cursor, sort)
    if (start === -1) break
    visited.push(sorted[start].name)
    cursor = encodeCursor(sorted[start], sort)
  }
  eq(visited, sorted.map((entry) => entry.name), `paging by cursor visits each entry once (${sort})`)
}
{
  const sorted = [...ENTRIES].sort(compareEntries('newest'))
  const cursor = encodeCursor(sorted[1], 'newest')
  eq(startIndex(sorted.filter((entry) => entry.name !== sorted[1].name), cursor, 'newest'), 1, 'the cursor holds even when its file is gone')
  eq(startIndex(sorted, encodeCursor(sorted[1], 'oldest'), 'newest'), 0, "another order's cursor starts from the top")
  eq(startIndex(sorted, 'garbage', 'newest'), 0, 'a broken cursor starts from the top')
  eq(startIndex(sorted, 'newest:abc:a.png', 'newest'), 0, 'a cursor without a number starts from the top')
  eq(startIndex(sorted, null, 'newest'), 0, 'no cursor starts from the top')
  eq(startIndex(sorted, encodeCursor(sorted[sorted.length - 1], 'newest'), 'newest'), -1, 'after the last entry there is nothing')
}

// ── Query string ──
const full: GalleryQuery = {
  q: '"long hair", smile',
  backend: 'anima',
  profile: 'sdxl',
  sort: 'name-asc',
  since: 'week',
  formats: ['webp', 'png'],
  orientation: 'portrait',
  resolution: 'standard',
  model: 'Anima-Base (v1.0)',
  source: 'latentry',
  untagged: true,
}
eq(fromParams(toParams(full)), { ...full, formats: ['png', 'webp'] }, 'a query survives the round trip (formats in a fixed order)')
eq(toParams({ ...full, formats: ['webp', 'png'] }).toString(), toParams({ ...full, formats: ['png', 'webp'] }).toString(), 'equal queries, equal strings')
eq(toParams({ sort: 'newest', formats: ['png', 'webp', 'jpg'], untagged: false, q: '  ' }).toString(), '', 'defaults and empty values are left out')
eq(
  fromParams(new URLSearchParams('sort=sideways&since=year&formats=gif,png&orientation=round&resolution=huge&source=photoshop&untagged=yes')),
  { q: undefined, backend: undefined, profile: undefined, sort: 'newest', since: undefined, formats: ['png'], orientation: undefined, resolution: undefined, model: undefined, source: undefined, untagged: undefined },
  'unknown values are dropped'
)
eq(fromParams(new URLSearchParams({ model: 'x'.repeat(500) })).model?.length, 200, 'a long name is cut')

// ── Counting and needing metadata ──
eq(activeFilterCount({ q: 'smile', sort: 'oldest' }), 0, 'the search and the order are not filters')
eq(activeFilterCount(full), 9, 'every filter counts once')
eq(activeFilterCount({ formats: ['png', 'webp', 'jpg'] }), 0, 'every file type is no filter')
eq([needsMeta({ since: 'day', formats: ['png'] }), needsMeta({ orientation: 'square' })], [false, true], 'age and type need no file opened')

// ── Cheap filters ──
const now = 10 * 24 * 60 * 60 * 1000
const hour = 60 * 60 * 1000
check(matchesCheap({ name: 'a.png', mtime: now - hour }, { since: 'day' }, now), 'an hour ago is within a day')
check(!matchesCheap({ name: 'a.png', mtime: now - 2 * 24 * hour }, { since: 'day' }, now), 'two days ago is not')
check(matchesCheap({ name: 'a.png', mtime: now - 2 * 24 * hour }, { since: 'week' }, now), 'but is within a week')
eq([formatOf('A.PNG'), formatOf('b.jpeg'), formatOf('c.jpg'), formatOf('d.gif')], ['png', 'jpg', 'jpg', null], 'file types by extension')
check(matchesCheap({ name: 'b.JPEG', mtime: now }, { formats: ['jpg'] }, now), '.jpeg counts as JPG')
check(!matchesCheap({ name: 'b.webp', mtime: now }, { formats: ['png', 'jpg'] }, now), 'a type not chosen is left out')

// ── Size and settings ──
eq([orientationOf(832, 1216), orientationOf(1216, 832), orientationOf(1024, 1000), orientationOf(null, 10)], ['portrait', 'landscape', 'square', null], 'orientation')
eq([resolutionOf(512, 768), resolutionOf(832, 1216), resolutionOf(1024, 1024), resolutionOf(1248, 1824), resolutionOf(0, 0)], ['small', 'standard', 'standard', 'large', null], 'resolution bands')
eq([sourceOf(null), sourceOf({ source: 'unknown', prompt: '', negativePrompt: '' }), sourceOf({ source: 'comfyui', prompt: '', negativePrompt: '' })], ['none', 'none', 'comfyui'], 'where the settings came from')
const picture = {
  width: 832,
  height: 1216,
  meta: { source: 'latentry' as const, prompt: '', negativePrompt: '', model: 'M', backend: 'anima', tags: [{ name: 'smile', category: 0, score: 0.9 }] },
}
check(matchesMeta(picture, { orientation: 'portrait', resolution: 'standard', model: 'M', source: 'latentry', backend: 'anima' }), 'every filter met')
check(!matchesMeta(picture, { untagged: true }), 'a tagged picture is not untagged')
check(matchesMeta({ ...picture, meta: { ...picture.meta, tags: [] } }, { untagged: true }), 'an empty tag list is untagged')
check(!matchesMeta({ width: null, height: null, meta: null }, { orientation: 'square' }), 'an unknown size matches no shape')
check(matchesMeta({ width: null, height: null, meta: null }, { source: 'none', untagged: true }), 'a picture with nothing is "no settings" and untagged')

done('gallery-sort')
