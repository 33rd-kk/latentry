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
import { composePrompt, fitToImage, getProfile, listProfiles } from '../lib/profiles'
import { appendTag, prependTags, splitTags, toSpacedTags } from '../lib/tags'

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
eq(composePrompt('1girl', { profile: illustrious, artist: 'name', quality: true }), 'masterpiece, best quality, amazing quality, very aesthetic, name, 1girl', 'quality tags lead, then the artist')
eq(composePrompt('masterpiece, 1girl', { profile: illustrious, quality: true }).split('masterpiece').length - 1, 1, 'a quality tag already present is not repeated')
eq(composePrompt('1girl', { profile: pony, artist: 'ignored' }), '1girl', 'Pony has no artist notation')
eq(composePrompt('  ', { profile: anima }), '', 'an empty prompt stays empty')

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
eq(splitTags(' a, ,b ,'), ['a', 'b'], 'split and trim')
eq(appendTag('a, B', 'b'), 'a, B', 'append skips a tag already there')
eq(appendTag('', 'x'), 'x', 'append to empty')
eq(prependTags('scene, a', ['a', 'char']), 'char, scene, a', 'prepend skips what is there')

done('config-profiles')
