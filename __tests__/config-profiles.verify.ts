/**
 * Reading GEN_BACKENDS and GALLERY_* (lib/backends/config.ts,
 * lib/gallery/dirs.ts), and what the model profiles do to a prompt and a
 * canvas (lib/profiles).
 *
 * Run with: npm test -- config-profiles
 */
import path from 'node:path'
import { check, done, eq } from './assert'
import { parseBackends } from '../lib/backends/config'
import { parseGalleryDirs } from '../lib/gallery/dirs'
import { composePrompt, fitToImage, formatForProfile, getProfile, listProfiles } from '../lib/profiles'
import { appendTag, appendTags, formatTags, prependTags, splitTags, tagKey, toSpacedTags, wildcardMatch } from '../lib/tags'

// ── GEN_BACKENDS ──
const mixed = parseBackends({
  GEN_BACKENDS:
    ' Anima|diffusers|http://localhost:7865|anima ; sdxl|a1111|http://192.168.1.5:7860/|illustrious;;',
  GEN_TOKEN_ANIMA: 'bearer-secret',
  GEN_TOKEN_SDXL: 'user:pass',
})
eq(mixed.problems, [], 'a well-formed list has no problems')
eq(
  mixed.backends.map((backend) => [backend.id, backend.kind, backend.profile, backend.token]),
  [
    ['anima', 'diffusers', 'anima', 'bearer-secret'],
    ['sdxl', 'a1111', 'illustrious', 'user:pass'],
  ],
  'ids are lowercased, tokens found by id'
)
eq(mixed.backends[1].url, 'http://192.168.1.5:7860/', 'the URL is kept')

const broken = parseBackends({
  GEN_BACKENDS: 'ok|diffusers|http://a:1|generic;ok|a1111|http://b:2;bad id|diffusers|http://c:3;x|comfy|http://d:4;y|a1111|not a url;z|a1111|file:///etc;w|a1111|http://e:5|flux',
})
eq(broken.backends.map((backend) => backend.id), ['ok'], 'only the valid entry survives')
eq(broken.problems.length, 6, 'each bad entry is reported')
eq(parseBackends({ GEN_BACKENDS: 'p|a1111|http://e:5' }).backends[0].profile, 'generic', 'profile defaults to generic')

const legacy = parseBackends({ DIFFUSION_SERVER_URL: 'http://localhost:7865', DIFFUSION_API_TOKEN: 't' })
eq(
  legacy.backends.map((backend) => [backend.id, backend.kind, backend.profile, backend.token]),
  [['default', 'diffusers', 'generic', 't']],
  'DIFFUSION_SERVER_URL alone is one generic diffusers backend'
)
eq(parseBackends({}).backends, [], 'nothing configured')

// ── GALLERY_* ──
const dirs = parseGalleryDirs({ GALLERY_SAVE_DIR: './output', GALLERY_DIRS: 'a;  b ;./output;' })
eq(
  dirs.map((dir) => [dir.index, dir.label, dir.writable]),
  [
    [0, 'output', true],
    [1, 'a', false],
    [2, 'b', false],
  ],
  'the save folder first and writable, duplicates dropped'
)
check(dirs.every((dir) => path.isAbsolute(dir.path)), 'paths are absolute')
eq(parseGalleryDirs({ GALLERY_DIRS: 'x' })[0].writable, false, 'without a save folder nothing is writable')

// ── Profiles ──
check(listProfiles().length >= 5, 'the built-in profiles')
eq(getProfile('nope').id, 'generic', 'an unknown profile is generic')

const anima = getProfile('anima')
const illustrious = getProfile('illustrious')
const pony = getProfile('pony')
eq(composePrompt('1girl, solo', { profile: anima, artist: '@@ name ' }), '@name, 1girl, solo', 'Anima writes the artist as @name')
eq(composePrompt('1girl', { profile: illustrious, artist: 'name', quality: true }), 'masterpiece, best_quality, amazing_quality, very_aesthetic, name, 1girl', 'quality tags lead, then the artist')
eq(composePrompt('masterpiece, 1girl', { profile: illustrious, quality: true }).split('masterpiece').length - 1, 1, 'a quality tag already present is not repeated')
eq(composePrompt('1girl', { profile: pony, artist: 'ignored' }), '1girl', 'Pony has no artist notation')
eq(composePrompt('  ', { profile: anima }), '', 'an empty prompt stays empty')
const sdxl = getProfile('sdxl')
eq(composePrompt('long hair, blue_eyes', { profile: sdxl, artist: 'some one' }), 'by some one, long_hair, blue_eyes', 'SDXL spells tags with underscores; the artist is left as written')
eq(composePrompt('long_hair, score_9', { profile: anima }), 'long hair, score_9', 'Anima spells tags with spaces and keeps score tags')
eq(composePrompt('long hair', { profile: pony, quality: true }), 'score_9, score_8_up, score_7_up, long_hair', 'Pony keeps its score tags')
eq(composePrompt('best_quality, 1girl', { profile: illustrious, quality: true }).split('best').length - 1, 1, 'a quality tag in the other spelling is not repeated')
eq(composePrompt('long_hair', { profile: getProfile('generic') }), 'long_hair', 'Generic sends the prompt as typed')
eq(formatForProfile('worst quality', sdxl), 'worst_quality', 'the negative prompt goes through the same rule')

const portrait = { width: 600, height: 900 }
const fitted16 = fitToImage(portrait, 1216, 832, 16)
const fitted8 = fitToImage(portrait, 1216, 832, 8)
check(fitted16.width % 16 === 0 && fitted16.height % 16 === 0, 'Anima sizes are multiples of 16')
check(fitted8.width % 8 === 0 && fitted8.height % 8 === 0, 'SDXL sizes are multiples of 8')
check(fitted8.height > fitted8.width, 'the source aspect is kept')
check(Math.abs(fitted8.width * fitted8.height - 1216 * 832) / (1216 * 832) < 0.05, 'at about the requested area')

// ── Prompt strings ──
eq(toSpacedTags('long_hair, >_<, ^_^, school_uniform, a_b c'), 'long hair, >_<, ^_^, school uniform, a b c', 'underscores to spaces, face tags kept')
eq(toSpacedTags('snake_case_word and _leading'), 'snake case word and _leading', 'only between word characters')
eq(toSpacedTags('hatsune_miku_(cosplay)'), 'hatsune miku (cosplay)', 'a qualifier is a word break too')
eq(formatTags('long hair,  blue eyes , 1girl', 'underscore'), 'long_hair,  blue_eyes , 1girl', 'spaces to underscores, spacing around tags kept')
eq(formatTags('long_hair, blue eyes', 'space'), 'long hair, blue eyes', 'underscores to spaces')
eq(formatTags('score_9, score_8_up, Score 7', 'space', 'score_*'), 'score_9, score_8_up, Score 7', 'kept tags are left in space style')
eq(formatTags('score_9, score 7', 'underscore', 'score_*'), 'score_9, score_7', 'underscore style needs no keeping')
eq(formatTags('^_^, >_<', 'space'), '^_^, >_<', 'face tags kept')
eq(formatTags('(long hair:1.2), [[blue eyes]]', 'underscore'), '(long_hair:1.2), [[blue_eyes]]', 'only the tag inside weighting')
eq(formatTags('<lora:my lora:0.8>, a b BREAK c d', 'underscore'), '<lora:my lora:0.8>, a b BREAK c d', 'LoRA calls and BREAK kept')
eq(formatTags('a girl standing in the rain, sunset. warm light', 'underscore'), 'a girl standing in the rain, sunset. warm light', 'prose is not joined up')
eq(formatTags('long\thair,\tsmile', 'space'), 'long hair, smile', 'tabs are spaces')
eq(formatTags('long\thair', 'underscore'), 'long_hair', 'tabs are word breaks')
eq(formatTags('my_tag, other_tag', 'space', 'my_*'), 'my_tag, other tag', 'a custom keep list with a wildcard')
eq(formatTags('long_hair\tx', 'asis'), 'long_hair\tx', 'as typed leaves everything')
eq(tagKey(' Long_Hair '), tagKey('long hair'), 'one tag in two spellings')
eq(appendTags('long_hair', ['long hair', 'smile']), 'long_hair, smile', 'append treats spellings as one tag')
eq(splitTags(' a, ,b ,'), ['a', 'b'], 'split and trim')
eq(appendTag('a, B', 'b'), 'a, B', 'append skips a tag already there')
eq(appendTag('', 'x'), 'x', 'append to empty')
eq(appendTags('a, B', ['b', 'c', 'C', ' d ', '']), 'a, B, c, d', 'bulk append skips tags already there and repeats among the new')
eq(appendTags('a', ['A']), 'a', 'bulk append of only known tags leaves the prompt')
eq(appendTags('', ['x', 'y']), 'x, y', 'bulk append to empty')
eq(prependTags('scene, a', ['a', 'char']), 'char, scene, a', 'prepend skips what is there')

// keepTags wildcards: matched without a regex, so a pattern from settings
// cannot stall the server on a long tag (privacy audit 2026-10, F10).
eq(
  [['score_*', 'score_8_up'], ['SCORE_*', 'score_9'], ['*_up', 'score_8_up'], ['a*b*c', 'axxbyyc'], ['a*b*c', 'axxbyy'], ['*', ''], ['a', 'ab'], ['a*', 'a'], ['**a**', 'xa']].map(
    ([pattern, text]) => wildcardMatch(pattern.toLowerCase(), text)
  ),
  [true, true, true, true, false, true, false, true, true],
  'wildcard matching'
)
eq(formatTags('Score_9, rating_safe', 'space', 'score_*'), 'Score_9, rating safe', 'patterns ignore case')
const started = performance.now()
formatTags(Array.from({ length: 10 }, () => 'a'.repeat(2000)).join(', '), 'space', 'a*a*a*a*a*a*a*a*b, ' + 'a*'.repeat(500) + 'b')
const took = performance.now() - started
check(took < 1000, `F10: keepTags with many wildcards on 2000-character tags stays fast (${Math.round(took)} ms)`)

done('config-profiles')
