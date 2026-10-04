/**
 * The built-in WD14 tagger (lib/tagger/wd14.ts), without a model: the tag
 * list, the input tensor, and which scores become tags. With
 * WD14_TEST_MODEL_DIR set to a real model folder, it also tags a picture.
 *
 * Run with: npm test -- wd14
 */
import sharp from 'sharp'
import { check, done, eq } from './assert'
import { hasModel, parseSelectedTags, selectTags, tagImage, toBgrTensor } from '../lib/tagger/wd14'
import { validateSettings, EMPTY_SETTINGS } from '../lib/settings/schema'

async function main() {
  const csv = 'tag_id,name,category,count\r\n9999999,general,9,1\r\n1,1girl,0,5\r\n2,long_hair,0,4\r\n3,hatsune_miku,4,3\r\n'
  const { names, categories } = parseSelectedTags(csv)
  eq(names, ['general', '1girl', 'long_hair', 'hatsune_miku'], 'names in order, CRLF handled')
  eq(categories, [9, 0, 0, 4], 'categories')

  eq(Array.from(toBgrTensor(new Uint8Array([10, 20, 30, 40, 50, 60]), 1).slice(0, 3)), [30, 20, 10], 'RGB becomes BGR, unscaled')

  const tags = selectTags([0.99, 0.9, 0.3, 0.8], names, categories, { general: 0.35, character: 0.85 })
  eq(tags.map((tag) => tag.name), ['1girl'], 'ratings dropped; general and character each against their own threshold')
  eq(
    selectTags([0, 0.5, 0.6, 0.9], names, categories, { general: 0.35, character: 0.85 }).map((tag) => [tag.name, tag.category]),
    [['hatsune_miku', 4], ['long_hair', 0], ['1girl', 0]],
    'best first, categories kept'
  )

  check(!hasModel(null) && !hasModel('Z:/definitely/not/here'), 'no folder, no model')

  // Settings: thresholds and the reserved id.
  const ok = validateSettings({ wd14: { modelDir: process.platform === 'win32' ? 'C:\\models\\wd' : '/models/wd', general: 0.4, character: '' }, tagger: 'builtin' }, EMPTY_SETTINGS)
  check(ok.ok && ok.settings.wd14?.general === 0.4 && ok.settings.wd14?.character === undefined && ok.settings.tagger === 'builtin', 'wd14 settings and tagger "builtin"')
  const bad = validateSettings({ wd14: { modelDir: 'relative', general: 2 }, backends: [{ id: 'builtin', kind: 'a1111', url: 'http://x', profile: 'sdxl' }] }, EMPTY_SETTINGS)
  check(!bad.ok && 'wd14.modelDir' in bad.errors && 'wd14.general' in bad.errors && bad.errors['backends.0.id'] === 'settings.errorBackendReserved', 'bad wd14 settings and the reserved backend id')

  // A real run, when a model is at hand.
  const dir = process.env.WD14_TEST_MODEL_DIR
  if (dir && hasModel(dir)) {
    const picture = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#4060c0' } }).png().toBuffer()
    const started = Date.now()
    const result = await tagImage(dir, picture.toString('base64'))
    console.log(`  real model: ${result.length} tags in ${Date.now() - started} ms: ${result.slice(0, 5).map((tag) => tag.name).join(', ')}`)
    check(Array.isArray(result) && result.every((tag) => tag.category !== 9), 'a real model tags a picture, without ratings')
  } else {
    console.log('  (set WD14_TEST_MODEL_DIR to also run a real model)')
  }

  done('wd14')
}

void main()
