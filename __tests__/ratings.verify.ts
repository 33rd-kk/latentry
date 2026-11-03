/**
 * Stars on gallery pictures (lib/gallery/ratings.ts): the checks on what is
 * stored, the file they are kept in, the route, and the stars filter and
 * order in a folder's listing.
 *
 * Run with: npm test -- ratings
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { PUT } from '../app/api/gallery/[dir]/[name]/rating/route'
import { folderKey, type GalleryDir } from '../lib/gallery/dirs'
import { matchesStars, fromParams, toParams, activeFilterCount } from '../lib/gallery/filter'
import { invalidateListing, listEntries, listPage } from '../lib/gallery/fs'
import {
  dropMissingRatings,
  folderRatings,
  MAX_RATINGS,
  NewerRatingsError,
  parseStoredRatings,
  ratingsPath,
  setRating,
  TooManyRatingsError,
  validStars,
  withoutMissing,
  withRating,
  type Ratings,
} from '../lib/gallery/ratings'
import { compareEntries, encodeCursor, startIndex } from '../lib/gallery/sort'
import { privateFiles } from '../lib/security/private-files'

// ── Values ──
eq([1, 2, 3, 4, 5].map(validStars), [1, 2, 3, 4, 5], '1–5 are stars')
eq([0, 6, -1, 2.5, '3', null, undefined, NaN].map(validStars), Array(8).fill(null), 'nothing else is, 0 included (it means none)')

// ── What a stored file holds ──
eq(
  [...parseStoredRatings({ version: 1, folders: { '/a': { 'x.png': 3, 'y.png': 0, 'z.png': 'five', 'w.png': 6, 'a/b.png': 2, '': 4, 'ok.png': 5 }, '/b': [], '/c': {} } })].map(
    ([folder, files]) => [folder, [...files]]
  ),
  [['/a', [['x.png', 3], ['ok.png', 5]]]],
  'only whole stars on plain names are kept, and empty folders go'
)
eq(parseStoredRatings(null).size + parseStoredRatings({ folders: [] }).size + parseStoredRatings('x').size, 0, 'a file of the wrong shape holds nothing')
{
  const many = Object.fromEntries(Array.from({ length: MAX_RATINGS + 5 }, (_, i) => [`${i}.png`, 1]))
  eq(parseStoredRatings({ folders: { '/a': many } }).get('/a')?.size, MAX_RATINGS, 'at most MAX_RATINGS are read')
}

// ── Changes ──
{
  const empty: Ratings = new Map()
  const one = withRating(empty, '/a', 'x.png', 4)
  eq(one.get('/a')?.get('x.png'), 4, 'stars are given')
  check(empty.size === 0, 'on a copy')
  check(withRating(one, '/a', 'x.png', 4) === one, 'the same stars change nothing')
  eq(withRating(one, '/a', 'x.png', 0).size, 0, '0 takes them away, and the empty folder with them')
  const two = withRating(one, '/a', 'y.png', 1)
  eq([...(withoutMissing(two, '/a', new Set(['y.png'])).get('/a') ?? [])], [['y.png', 1]], 'files no longer there go')
  check(withoutMissing(two, '/a', new Set(['x.png', 'y.png', 'z.png'])) === two, 'nothing changes when all are there')
  check(withoutMissing(two, '/other', new Set()) === two, 'nor for a folder without ratings')
  const full: Ratings = new Map([['/a', new Map(Array.from({ length: MAX_RATINGS }, (_, i) => [`${i}.png`, 1]))]])
  check(withRating(full, '/a', '0.png', 5).get('/a')?.get('0.png') === 5, 'a full file still changes a rating it has')
  let threw: unknown = null
  try {
    withRating(full, '/a', 'new.png', 5)
  } catch (error) {
    threw = error
  }
  check(threw instanceof TooManyRatingsError, 'but takes no new one')
}

// ── The filter and the order ──
check(matchesStars(0, {}) && matchesStars(3, { minStars: 3 }) && !matchesStars(2, { minStars: 3 }) && !matchesStars(0, { minStars: 1 }), 'the stars filter')
eq(toParams({ minStars: 3 }).toString(), 'stars=3', 'it goes in the URL')
eq([fromParams(new URLSearchParams('stars=4')).minStars, fromParams(new URLSearchParams('stars=9')).minStars, fromParams(new URLSearchParams('stars=x')).minStars], [4, undefined, undefined], 'and comes back from it, 1–5 only')
eq(toParams({ minStars: 0 }).toString(), '', 'unset is left out')
eq(activeFilterCount({ minStars: 2 }), 1, 'and counts as a filter')
{
  const entries = [
    { name: 'a.png', mtime: 300, size: 1, stars: 0 },
    { name: 'b.png', mtime: 100, size: 1, stars: 5 },
    { name: 'c.png', mtime: 200, size: 1, stars: 5 },
    { name: 'd.png', mtime: 400, size: 1, stars: 2 },
  ]
  const sorted = [...entries].sort(compareEntries('stars-desc'))
  eq(sorted.map((entry) => entry.name), ['c.png', 'b.png', 'd.png', 'a.png'], 'most stars first, newest first among equals, unrated last')
  eq(startIndex(sorted, encodeCursor(sorted[1], 'stars-desc'), 'stars-desc'), 2, 'the cursor carries on after the last one')
}

async function main() {
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-ratings-'))
  const folder = path.join(scratch, 'out')
  const other = path.join(scratch, 'comfy')
  mkdirSync(folder)
  mkdirSync(other)
  const saved = { settings: process.env.LATENTRY_SETTINGS_FILE, save: process.env.GALLERY_SAVE_DIR, dirs: process.env.GALLERY_DIRS }
  process.env.LATENTRY_SETTINGS_FILE = path.join(scratch, 'latentry.settings.json')
  process.env.GALLERY_SAVE_DIR = folder
  process.env.GALLERY_DIRS = other
  try {
    // ── The file ──
    const file = ratingsPath()
    eq(path.dirname(file), scratch, 'next to the settings file')
    check(privateFiles().includes(file), 'and made owner-only at start with the other private files')
    await setRating(folder, 'x.png', 3)
    eq(JSON.parse(readFileSync(file, 'utf8')), { version: 1, folders: { [folderKey(folder)]: { 'x.png': 3 } } }, 'kept by folder and name')
    eq(readdirSync(scratch).sort(), ['comfy', 'latentry.ratings.json', 'out'], 'with no temp file left behind')
    if (process.platform !== 'win32') eq(statSync(file).mode & 0o777, 0o600, 'readable by its owner only')
    eq([...folderRatings(folder)], [['x.png', 3]], 'and read back')
    await Promise.all([setRating(folder, 'y.png', 1), setRating(folder, 'z.png', 2), setRating(other, 'w.png', 5)])
    eq(folderRatings(folder).size + folderRatings(other).size, 4, 'ratings given at once all stay')
    await setRating(folder, 'y.png', 0)
    check(!folderRatings(folder).has('y.png'), '0 takes one away')
    let refused: unknown = null
    try {
      await setRating(folder, '../x.png', 2)
    } catch (error) {
      refused = error
    }
    check(refused instanceof RangeError, 'a path is not a name')

    // ── Missing files ──
    await dropMissingRatings(folder, new Set(['x.png']))
    eq([...folderRatings(folder)], [['x.png', 3]], 'ratings of files that are gone are dropped')
    const before = statSync(file).mtimeMs
    await dropMissingRatings(folder, new Set(['x.png']))
    await dropMissingRatings(path.join(scratch, 'none'), new Set())
    eq(statSync(file).mtimeMs, before, 'nothing is written when nothing goes')

    // ── The route ──
    const ORIGIN = 'http://localhost:3000'
    const put = (dir: string, name: string, body: unknown) =>
      PUT(
        new Request(`${ORIGIN}/api/gallery/${dir}/${encodeURIComponent(name)}/rating`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ dir, name }) } as never
      )
    writeFileSync(path.join(folder, 'x.png'), 'x')
    writeFileSync(path.join(folder, 'a.png'), 'a')
    writeFileSync(path.join(folder, 'b.png'), 'b')
    writeFileSync(path.join(other, 'c.png'), 'c')
    const now = Date.now() / 1000
    utimesSync(path.join(folder, 'x.png'), now - 30, now - 30)
    utimesSync(path.join(folder, 'a.png'), now - 20, now - 20)
    utimesSync(path.join(folder, 'b.png'), now - 10, now - 10)
    eq((await put('0', 'a.png', { stars: 5 })).status, 200, 'a picture is rated')
    eq((await put('1', 'c.png', { stars: 2 })).status, 200, 'one in a read-only folder too')
    eq((await put('0', 'gone.png', { stars: 2 })).status, 404, 'a picture that is not there is not')
    eq((await put('7', 'a.png', { stars: 2 })).status, 404, 'nor one in a folder that is not there')
    eq((await put('0', 'notes.txt', { stars: 2 })).status, 404, 'nor a file that is not a picture')
    eq(
      await Promise.all([{ stars: 6 }, { stars: 2.5 }, { stars: '3' }, {}].map(async (body) => (await put('0', 'a.png', body)).status)),
      [400, 400, 400, 400],
      'stars must be 0–5'
    )

    // ── In the listing ──
    const dir: GalleryDir = { index: 0, path: folder, label: 'out', autoLabel: true, writable: true }
    invalidateListing(dir)
    const names = async (filter: Parameters<typeof listPage>[1]['filter']) => (await listPage(dir, { limit: 10, filter })).items.map((item) => [item.name, item.stars])
    eq(await names({}), [['b.png', undefined], ['a.png', 5], ['x.png', 3]], 'items carry their stars')
    eq(await names({ minStars: 4 }), [['a.png', 5]], 'the stars filter')
    eq(await names({ sort: 'stars-desc' }), [['a.png', 5], ['x.png', 3], ['b.png', undefined]], 'the stars order')
    await put('0', 'b.png', { stars: 4 })
    eq(await names({ sort: 'stars-desc' }), [['a.png', 5], ['b.png', 4], ['x.png', 3]], 'which follows a new rating at once')

    // ── Listing drops the ratings of files that went ──
    rmSync(path.join(folder, 'x.png'))
    invalidateListing(dir)
    await listEntries(dir)
    // The drop is not waited for by the listing; give it its turn.
    for (let i = 0; i < 20 && folderRatings(folder).has('x.png'); i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    check(!folderRatings(folder).has('x.png') && folderRatings(folder).get('a.png') === 5, 'listing a folder forgets the stars of a file no longer in it')
    rmSync(path.join(folder, 'a.png'))
    rmSync(path.join(folder, 'b.png'))
    invalidateListing(dir)
    await listEntries(dir)
    await new Promise((resolve) => setTimeout(resolve, 50))
    eq(folderRatings(folder).size, 2, 'but not when the folder looks empty, as a drive not mounted yet would')

    // ── A newer file ──
    writeFileSync(file, JSON.stringify({ version: 2, folders: { [folderKey(folder)]: { 'a.png': 5 } } }))
    eq(folderRatings(folder).get('a.png'), 5, 'a newer file is still read')
    const newer = await setRating(folder, 'a.png', 1).then(
      () => null,
      (error) => error
    )
    check(newer instanceof NewerRatingsError, 'but never written over')
    writeFileSync(path.join(folder, 'a.png'), 'a')
    eq((await put('0', 'a.png', { stars: 1 })).status, 409, 'the route says so')
    eq(JSON.parse(readFileSync(file, 'utf8')).version, 2, 'and the file is as it was')
  } finally {
    for (const [name, value] of [
      ['LATENTRY_SETTINGS_FILE', saved.settings],
      ['GALLERY_SAVE_DIR', saved.save],
      ['GALLERY_DIRS', saved.dirs],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
  .then(() => done('ratings'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
