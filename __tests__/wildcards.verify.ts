/**
 * Wildcards: the `__name__` syntax, how a line is picked (the same for the
 * same seed), nesting and its limits, reading a wildcards folder without
 * leaving it, who may use it, and the two routes. Settings and folders are a
 * temp folder's.
 *
 * Run with: npm test -- wildcards
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { formatTags } from '../lib/tags'
import { insertWildcard } from '../lib/generate/form'
import { parseLatentryRecord } from '../lib/image-meta'
import { EMPTY_SETTINGS, validateSettings } from '../lib/settings/schema'
import { wildcardsAccess } from '../lib/wildcards/access'
import { expandWildcards as expandOnPage } from '../lib/wildcards/client'
import { expandWildcards, WildcardError, type WildcardReader } from '../lib/wildcards/expand'
import { listWildcards, MAX_WILDCARD_BYTES, readWildcard } from '../lib/wildcards/folder'
import { findVariants, hasDynamicPrompt, hasVariants, hasWildcards, wildcardLines, wildcardPath } from '../lib/wildcards/syntax'

const ORIGIN = 'http://localhost:3000'

/** What expandWildcards threw, as `problem __name__`, or null when it did not. */
async function problem(run: Promise<unknown>): Promise<string | null> {
  try {
    await run
    return null
  } catch (error) {
    return error instanceof WildcardError ? `${error.problem} __${error.wildcard}__` : String(error)
  }
}

async function main(): Promise<void> {
  // ── Syntax ──
  eq(
    ['a __hair__ girl', '__dir/hair color__', 'snake_case', '__x_', '____', '__ x__', 'no wildcards'].map(hasWildcards),
    [true, true, false, false, false, false, false],
    'a wildcard is __name__, a name starting and ending with a letter or digit'
  )
  eq(
    ['hair', 'dir/hair', 'a/b/c', 'a/b/c/d', '../x', 'a/../b', 'a//b', 'a/ b', 'c:x', 'a\\b'].map(wildcardPath),
    ['hair', 'dir/hair', 'a/b/c', null, null, null, null, null, null, null],
    'a name may go 3 folders deep, and never out of the folder'
  )
  eq(wildcardLines('﻿red\r\n  blue  \n\n# a note\ngreen\n'), ['red', 'blue', 'green'], 'lines are trimmed; blank lines and # comments are skipped')

  // ── Expanding ──
  const files: Record<string, string[]> = {
    hair: ['red hair', 'blue hair', 'green hair', 'black hair'],
    outfit: ['__top__, jeans'],
    top: ['hoodie', 'shirt'],
    loop: ['__loop__'],
    empty: [],
    'dir/eyes': ['blue eyes', 'red eyes'],
  }
  const asked: string[] = []
  const read: WildcardReader = async (name) => {
    asked.push(name)
    return files[name] ?? null
  }
  const once = await expandWildcards(['1girl, __hair__, __outfit__', 'lowres, __dir/eyes__'], 42, read)
  check(files.hair.some((line) => once.texts[0].startsWith(`1girl, ${line}, `)), `the prompt takes a line of hair.txt (${once.texts[0]})`)
  check(/, (hoodie|shirt), jeans$/.test(once.texts[0]), 'and a line with a wildcard of its own is filled in too')
  check(/^lowres, (blue|red) eyes$/.test(once.texts[1]), 'the negative prompt too, from a subfolder')
  eq(once.picks.map(({ wildcard }) => wildcard), ['hair', 'outfit', 'top', 'dir/eyes'], 'each pick is reported, in order')
  const again = await expandWildcards(['1girl, __hair__, __outfit__', 'lowres, __dir/eyes__'], 42, read)
  eq(again.texts, once.texts, 'the same seed picks the same lines')
  const seeds = new Set<string>()
  for (let seed = 0; seed < 40; seed++) seeds.add((await expandWildcards(['__hair__'], seed, read)).texts[0])
  check(seeds.size >= 3, `other seeds pick other lines (${seeds.size} of 4 seen in 40 seeds)`)
  const random = new Set<string>()
  for (let run = 0; run < 40; run++) random.add((await expandWildcards(['__hair__'], -1, read)).texts[0])
  check(random.size >= 3, `seed -1 picks at random (${random.size} of 4 seen in 40 runs)`)
  const twice = new Set<string>()
  for (let seed = 0; seed < 20; seed++) {
    const [text] = (await expandWildcards(['__hair__ and __hair__'], seed, read)).texts
    const [a, b] = text.split(' and ')
    if (a !== b) twice.add(text)
  }
  check(twice.size > 0, 'a wildcard used twice can take two different lines')
  asked.length = 0
  await expandWildcards(['__hair__ __hair__ __hair__'], 1, read)
  eq(asked, ['hair'], 'and its file is read once a run')
  eq((await expandWildcards(['no wildcards here', ''], 7, read)).texts, ['no wildcards here', ''], 'text without wildcards comes back as it is')
  eq(await problem(expandWildcards(['__missing__'], 1, read)), 'unknown __missing__', 'a wildcard with no file is refused, by name')
  eq(await problem(expandWildcards(['__empty__'], 1, read)), 'empty __empty__', 'so is one with no lines')
  eq(await problem(expandWildcards(['__loop__'], 1, read)), 'tooDeep __loop__', 'a wildcard that holds itself stops at 3 levels')
  eq(await problem(expandWildcards(['__a/b/c/d__'], 1, read)), 'unknown __a/b/c/d__', 'a name too deep is no wildcard of the folder')
  const long: WildcardReader = async () => ['x'.repeat(6000)]
  eq(await problem(expandWildcards(['__a__ __b__ __c__ __d__'], 1, long)), 'tooLong __d__', 'a prompt that would grow past 20,000 characters is refused')
  // The line a seed picks is pinned: pictures made before keep drawing the same.
  const pinned = (seed: number, wildcard: string, occurrence: number, count: number) =>
    createHash('sha256').update(`${seed}\u0000${wildcard}\u0000${occurrence}`).digest().readUIntBE(0, 6) % count
  const hairTwice = `${files.hair[pinned(1234, 'hair', 0, 4)]} ${files.hair[pinned(1234, 'hair', 1, 4)]}`
  eq((await expandWildcards(['__hair__ __hair__'], 1234, read)).texts[0], hairTwice, 'a seed picks the line it always picked')

  // ── Variants ──
  const variants = (text: string) => findVariants(text).map(({ min, max, separator, choices }) => ({ min, max, separator, choices }))
  eq(variants('a {red|blue} b'), [{ min: 1, max: 1, separator: ', ', choices: ['red', 'blue'] }], '{a|b} is a variant of one choice')
  eq(
    ['{2$$a|b|c}', '{1-3$$a|b}', '{-2$$a|b}', '{2-$$a|b}', '{2$$ and $$a|b}'].map((text) => {
      const [{ min, max, separator }] = variants(text)
      return [min, max, separator]
    }),
    [[2, 2, ', '], [1, 3, ', '], [0, 2, ', '], [2, null, ', '], [2, 2, ' and ']],
    'with a count, a range, and a separator of its own'
  )
  eq(
    ['{masterpiece}', '{{best quality}}', '{a|b', 'a|b', '{{a|b}}'].map(hasVariants),
    [false, false, false, false, true],
    'braces with no | are emphasis, an unclosed one is a character, and a variant may sit inside emphasis'
  )
  eq(variants('{a|{b|c}} {d|e}').map(({ choices }) => choices), [['a', '{b|c}'], ['d', 'e']], 'outermost first: a choice may hold a variant')
  eq(['{a|b}', '__hair__', '{tag}, plain'].map(hasDynamicPrompt), [true, true, false], 'something to fill in is a wildcard or a variant')

  const drawn = await expandWildcards(['1girl, {red|blue} hair, {2$$a|b|c}'], 5, read)
  check(/^1girl, (red|blue) hair, (a|b|c), (a|b|c)$/.test(drawn.texts[0]), `a variant takes a choice, a count that many (${drawn.texts[0]})`)
  check(new Set(drawn.texts[0].split(' hair, ')[1].split(', ')).size === 2, 'never the same one twice')
  eq((await expandWildcards(['1girl, {red|blue} hair, {2$$a|b|c}'], 5, read)).texts, drawn.texts, 'the same seed draws the same')
  const colours = new Set<string>()
  for (let seed = 0; seed < 30; seed++) colours.add((await expandWildcards(['{red|blue|green}'], seed, read)).texts[0])
  eq([...colours].sort(), ['blue', 'green', 'red'], 'other seeds draw other choices')
  check(files.hair.includes((await expandWildcards(['{__hair__|__hair__}'], 3, read)).texts[0]), 'a choice may be a wildcard')
  check(['x', 'y', 'z'].includes((await expandWildcards(['{x|{y|z}}'], 9, read)).texts[0]), 'or a variant')
  eq((await expandWildcards(['{5$$a|b}'], 1, read)).texts[0].split(', ').sort(), ['a', 'b'], 'a count past the choices takes them all')
  const maybe = new Set<string>()
  for (let seed = 0; seed < 30; seed++) maybe.add((await expandWildcards(['x, {-1$$ y | z }'], seed, read)).texts[0])
  eq([...maybe].sort(), ['x, ', 'x, y', 'x, z'], '{-1$$…} may take none, and choices are trimmed')
  eq((await expandWildcards(['{masterpiece}, {a|a}'], 1, read)).texts[0], '{masterpiece}, a', 'emphasis braces are left as written')
  const moods: WildcardReader = async (name) => (name === 'mood' ? ['{happy|sad}'] : null)
  check(['happy', 'sad'].includes((await expandWildcards(['__mood__'], 2, moods)).texts[0]), "a wildcard's line may hold a variant")
  check(
    (await expandWildcards(['__hair__ {a|b} __hair__'], 1234, read)).texts[0].startsWith(files.hair[pinned(1234, 'hair', 0, 4)] + ' '),
    'a variant leaves the wildcards around it drawing as before'
  )
  const huge = 'x'.repeat(20_001)
  check(/^tooLong __\{x+…__$/.test((await problem(expandWildcards([`{${huge}|${huge}}`], 1, read))) ?? ''), 'a variant that grows too long is refused, named by its start')

  // ── Respelling leaves variants for after they are drawn ──
  eq(formatTags('long_hair, {red_hair, ahoge|blue_hair}, smile', 'space'), 'long hair, {red_hair, ahoge|blue_hair}, smile', 'a variant is one piece, commas and all')
  eq(formatTags('long hair, {red hair|blue hair}', 'underscore'), 'long_hair, {red hair|blue hair}', 'in underscores style too')
  eq(formatTags('{long hair}, blue eyes', 'underscore'), '{long_hair}, blue_eyes', 'emphasis braces are respelled as before')

  // ── Tag respelling leaves them alone ──
  eq(formatTags('long_hair, __hair_color__, __dir/eye colour__', 'space'), 'long hair, __hair_color__, __dir/eye colour__', 'spaces style keeps a wildcard as its file is named')
  eq(formatTags('long hair, __hair color__', 'underscore'), 'long_hair, __hair color__', 'and so does underscores style')
  eq(insertWildcard('1girl, smile', 'hair', 6), { prompt: '1girl, __hair__, smile', caret: 15 }, 'the picker puts __name__ in at the caret')

  // ── A folder on disk ──
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-wildcards-'))
  const folder = path.join(scratch, 'wildcards')
  try {
    mkdirSync(path.join(folder, 'people', 'deep', 'deeper'), { recursive: true })
    mkdirSync(path.join(folder, '.hidden'))
    writeFileSync(path.join(folder, 'hair.txt'), 'red hair\nblue hair\n')
    writeFileSync(path.join(folder, 'notes.md'), 'not a wildcard')
    writeFileSync(path.join(folder, 'people', 'pose.txt'), 'standing\n# sitting\n')
    writeFileSync(path.join(folder, 'people', 'deep', 'mood.txt'), 'happy')
    writeFileSync(path.join(folder, 'people', 'deep', 'deeper', 'far.txt'), 'too far')
    writeFileSync(path.join(folder, '.hidden', 'secret.txt'), 'no')
    writeFileSync(path.join(folder, 'huge.txt'), 'x'.repeat(MAX_WILDCARD_BYTES + 1))
    writeFileSync(path.join(scratch, 'outside.txt'), 'outside the folder')

    eq(await listWildcards(folder), ['hair', 'huge', 'people/deep/mood', 'people/pose'], 'the list has the .txt files, 3 folders deep at most, without hidden folders')
    eq(await readWildcard(folder, 'hair'), ['red hair', 'blue hair'], 'a wildcard is read by name')
    eq(await readWildcard(folder, 'people/pose'), ['standing'], 'from a subfolder too')
    eq(await readWildcard(folder, 'huge'), null, 'a file over 1 MB is not read')
    for (const name of ['../outside', 'people/../../outside', 'missing', 'notes', 'people']) {
      eq(await readWildcard(folder, name), null, `"${name}" reads nothing`)
    }
    eq(await readWildcard(path.join(scratch, 'nope'), 'hair'), null, 'a folder that is not there reads nothing')

    // ── YAML files ──
    const yamlFolder = path.join(scratch, 'yaml')
    mkdirSync(path.join(yamlFolder, 'people'), { recursive: true })
    writeFileSync(path.join(yamlFolder, 'colors.yaml'), '﻿warm:\n  - red\n  - orange # bright\n  - "# not a comment in YAML"\nshades:\n  cool: [blue, teal]\nhair: [green hair]\ncount: [1, 2]\n')
    writeFileSync(path.join(yamlFolder, 'hair.txt'), 'black hair\n')
    writeFileSync(path.join(yamlFolder, 'people', 'more.yml'), 'pose:\n  - sitting\n')
    writeFileSync(path.join(yamlFolder, 'people', 'pose.txt'), 'standing\n')
    writeFileSync(path.join(yamlFolder, 'people', 'looks.yaml'), 'look: [smile, wink]\n')
    writeFileSync(path.join(yamlFolder, 'aliases.yaml'), 'base: &b [a, b]\nuse: *b\n')
    writeFileSync(path.join(yamlFolder, 'broken.yaml'), 'x: [unclosed\n')
    writeFileSync(path.join(yamlFolder, 'large.yaml'), `big: [${'"x", '.repeat(MAX_WILDCARD_BYTES / 4)}"x"]\n`)
    writeFileSync(path.join(scratch, 'outside.yaml'), 'outside: [no]\n')

    eq(
      await listWildcards(yamlFolder),
      ['count', 'hair', 'people/look', 'people/pose', 'shades/cool', 'warm'],
      "YAML keys are names, nested keys a group, a file's own name no part of them; files with aliases, errors or over 1 MB give none"
    )
    eq(await readWildcard(yamlFolder, 'warm'), ['red', 'orange'], 'a YAML list is read as lines are: a choice starting with # is a comment there too')
    eq(await readWildcard(yamlFolder, 'shades/cool'), ['blue', 'teal'], 'a nested key by group/name')
    eq(await readWildcard(yamlFolder, 'people/look'), ['smile', 'wink'], 'a YAML file in a subfolder has the folder in its names')
    eq(await readWildcard(yamlFolder, 'count'), ['1', '2'], 'numbers are choices too')
    eq([await readWildcard(yamlFolder, 'hair'), await readWildcard(yamlFolder, 'people/pose')], [['black hair'], ['standing']], 'a .txt file of the same name wins')
    for (const name of ['shades', 'use', 'big', 'outside', '../outside', 'colors', 'colors/warm', 'warm/red']) {
      eq(await readWildcard(yamlFolder, name), null, `"${name}" reads nothing from YAML`)
    }

    // ── Settings, and who may use it ──
    const stored = (input: unknown) => {
      const result = validateSettings({ wildcards: input } as never, EMPTY_SETTINGS, {})
      return result.ok ? result.settings.wildcards : result.errors
    }
    eq(stored({ dir: ` ${folder} `, share: true }), { dir: folder, share: true }, 'a folder is stored trimmed, with its sharing')
    eq(stored({ dir: 'relative/path' }), { 'wildcards.dir': 'settings.errorAbsolute' }, 'a relative folder is refused')
    eq(stored({ dir: '\\\\server\\share' }), { 'wildcards.dir': 'settings.errorNetworkPath' }, 'so is a network share')
    eq(stored({ dir: '', share: 'yes' }), { dir: null, share: false }, 'an empty folder turns it off, and sharing is on only for true')
    const local = new Headers({ host: 'localhost:3000' })
    const phone = new Headers({ host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' })
    const sharing = { version: 1, wildcards: { dir: folder, share: true } } as const
    eq(
      [wildcardsAccess(local, EMPTY_SETTINGS, {}), wildcardsAccess(phone, EMPTY_SETTINGS, {}), wildcardsAccess(phone, sharing, {})],
      ['edit', null, 'shared'],
      'this machine always; a paired device only with sharing on'
    )

    // ── The routes ──
    const settingsFile = path.join(scratch, 'settings.json')
    const write = (wildcards: unknown) => writeFileSync(settingsFile, JSON.stringify({ version: 1, engine: { autoStart: false }, ...(wildcards ? { wildcards } : {}) }))
    Object.assign(process.env, { LATENTRY_SETTINGS_FILE: settingsFile, LATENTRY_ENGINE: 'off' })
    delete process.env.SETTINGS_EDIT
    write(null)
    const { GET: listRoute } = await import('../app/api/wildcards/route')
    const { POST: expandRoute } = await import('../app/api/wildcards/expand/route')
    const list = async (query = '', headers = local) => (await listRoute(new Request(`${ORIGIN}/api/wildcards${query}`, { headers }))).json()
    const expand = (body: unknown, headers = local) =>
      expandRoute(new Request(`${ORIGIN}/api/wildcards/expand`, { method: 'POST', headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    const answer = async (response: Response) => [response.status, await response.json()]

    eq(await list('?probe=1'), { available: false, shared: false }, 'with no folder set, there is no picker')
    eq((await expand({ prompt: '__hair__' })).status, 409, 'and nothing to fill in from')
    const [variantStatus, variantAnswer] = await answer(await expand({ prompt: '{red|red} hair', negative_prompt: '{2$$a|a}', seed: 1 }))
    eq([variantStatus, variantAnswer], [200, { prompt: 'red hair', negative_prompt: 'a, a' }], 'variants need no folder')
    write({ dir: folder })
    // getSettings re-reads only when the file's time changes; make sure it does.
    await new Promise((resolve) => setTimeout(resolve, 30))
    write({ dir: folder })
    eq(await list('?probe=1'), { available: true, shared: false }, 'with a folder, this machine gets a picker')
    eq(await list(), { available: true, shared: false, names: ['hair', 'huge', 'people/deep/mood', 'people/pose'] }, 'and the names when it opens, no paths')
    const filled = await expand({ prompt: '1girl, __hair__', negative_prompt: 'lowres, __people/pose__', seed: 3 })
    eq(filled.headers.get('cache-control'), 'no-store', 'an answer is not kept by the browser')
    const lines = (await filled.json()) as { prompt: string; negative_prompt: string }
    check(['1girl, red hair', '1girl, blue hair'].includes(lines.prompt), `the prompt is filled in (${lines.prompt})`)
    eq(lines.negative_prompt, 'lowres, standing', 'and the negative prompt')
    eq(((await (await expand({ prompt: '1girl, __hair__', seed: 3 })).json()) as { prompt: string }).prompt, lines.prompt, 'the same seed gives the same line')
    const [status, refused] = await answer(await expand({ prompt: '__nope__' }))
    eq([status, (refused as { error: string }).error], [400, 'i18n:generate.wildcards.unknown|{"name":"__nope__"}'], 'an unknown wildcard is refused by name')
    eq((await expand({ prompt: 'x'.repeat(10_001) })).status, 400, 'a prompt over 10,000 characters is refused')
    eq((await expand({ seed: 1 })).status, 400, 'so is a body without a prompt')

    eq(await list('?probe=1', phone), { available: false, shared: false }, 'a paired device gets no picker while sharing is off')
    eq((await expand({ prompt: '__hair__' }, phone)).status, 403, 'and cannot have wildcards filled in')
    eq((await expand({ prompt: '{__hair__|x}' }, phone)).status, 403, 'not even inside a variant')
    eq((await expand({ prompt: '{x|x}', seed: 1 }, phone)).status, 200, 'but variants alone are filled in')
    await new Promise((resolve) => setTimeout(resolve, 30))
    write({ dir: folder, share: true })
    eq(await list('?probe=1', phone), { available: true, shared: true }, 'with sharing on it gets one')
    eq((await expand({ prompt: '__hair__', seed: 1 }, phone)).status, 200, 'and can use them')

    // ── Kept with the picture ──
    const record = (extra: Record<string, unknown>) =>
      JSON.stringify({ schema: 1, backend: 'b', kind: 'a1111', profile: 'sdxl', model: null, mode: 'txt2img', prompt: '1girl, red hair', negative_prompt: '', seed: 1, width: 64, height: 64, sampler: 'Euler', scheduler: 'Default', steps: 1, cfg: 1, created: '2026-10-19T00:00:00.000Z', ...extra })
    eq(parseLatentryRecord(record({ prompt_template: '1girl, __hair__' }))?.promptTemplate, '1girl, __hair__', 'a picture keeps the prompt as typed, wildcards and all')
    eq(parseLatentryRecord(record({}))?.promptTemplate, undefined, 'and has none when it had no wildcards')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  // ── The page's side: asks the server only when there is something to fill in ──
  const realFetch = globalThis.fetch
  const sent: unknown[] = []
  let answer: () => Promise<Response> = async () => Response.json({ prompt: 'filled', negative_prompt: 'neg' })
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return answer()
  }) as typeof fetch
  try {
    eq(await expandOnPage('1girl', 'lowres', 7), { ok: true, prompt: '1girl', negativePrompt: 'lowres' }, 'without wildcards nothing is asked')
    eq(sent, [], 'and the server is not called')
    eq(await expandOnPage('1girl, __hair__', '', 7), { ok: true, prompt: 'filled', negativePrompt: 'neg' }, 'with one, the server fills it in')
    eq(sent, [{ prompt: '1girl, __hair__', negative_prompt: '', seed: 7 }], 'sent with the seed, so the same seed picks the same line')
    sent.length = 0
    await expandOnPage('{masterpiece}, 1girl', '', 7)
    eq(sent, [], 'emphasis braces ask nothing')
    await expandOnPage('1girl, {red|blue} hair', '', 7)
    eq(sent.length, 1, 'a variant does')
    answer = async () => Response.json({ error: 'There is no wildcard __x__' }, { status: 400 })
    eq(await expandOnPage('__x__', '', 1), { ok: false, error: 'There is no wildcard __x__' }, "the server's reason comes back")
    answer = async () => new Response('not json', { status: 500 })
    eq(await expandOnPage('__x__', '', 1), { ok: false, error: null }, 'an answer that is not JSON is a failure without a reason')
    answer = async () => {
      throw new TypeError('offline')
    }
    eq(await expandOnPage('', '__x__', 1), { ok: false, error: null }, 'so is no answer, and a wildcard in the negative prompt asks too')
  } finally {
    globalThis.fetch = realFetch
  }
}

main()
  .then(() => done('wildcards'))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
