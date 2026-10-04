/**
 * The gallery's search box (lib/gallery/query.ts): commas separate terms, a
 * tag of several words stays one term, and quotes match a tag exactly.
 *
 * Run with: npm test -- query
 */
import { check, done, eq } from './assert'
import { exactTagQuery, matchesQuery, normalizeTag, parseQuery, searchableOf } from '../lib/gallery/query'
import type { ImageMeta } from '../lib/gallery/png-meta'

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

done('query')
