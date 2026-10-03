/**
 * The i18n core (lib/i18n/core.ts): lookup with the English fallback,
 * `{name}` interpolation, `<tag>` markup, first-visit locale detection, and
 * the server-message round trip. That Japanese has every English key is the
 * type system's job (ja is typed as Messages); that it uses the same
 * placeholders is checked here.
 *
 * Run with: npm test -- i18n
 */
import { check, done, eq } from './assert'
import { detectLocale, interpolate, localizeServerText, parseRich, serverMessage, setActiveLocale, translate, tStatic } from '../lib/i18n/core'
import { en } from '../lib/i18n/messages/en'
import { ja } from '../lib/i18n/messages/ja'

eq(translate('en', 'generate.cancel'), 'Cancel', 'en lookup')
eq(translate('ja', 'generate.cancel'), 'キャンセル', 'ja lookup')
eq(translate('en', 'nope.missing' as never), 'nope.missing', 'an unknown key shows itself')
eq(translate('en', 'generate.width', { value: 832 }), 'Width: 832', 'interpolation')
eq(interpolate('{a} and {b}', { a: 1 }), '1 and {b}', 'unknown variables are left as written')

const parts = parseRich('a <b>bold <i>both</i></b> c')
check(parts.length === 3 && parts[0] === 'a ' && parts[2] === ' c', 'rich: text around a tag')
eq(parseRich('<b>open'), ['open'], 'rich: an unclosed tag keeps its text')
eq(parseRich('<lora:x>'), ['<lora:x>'], 'rich: angle brackets that are not a tag stay text')

eq(detectLocale(['ja-JP', 'en-US']), 'ja', 'Japanese browser')
eq(detectLocale(['en-US', 'fr']), 'en', 'others')
eq(detectLocale(undefined), 'en', 'no languages')

const encoded = serverMessage('generate.saveFailed', { reason: 'EACCES' })
check(localizeServerText('en', encoded).includes('EACCES'), 'server message in English keeps its variables')
check(localizeServerText('ja', encoded).includes('EACCES'), 'and in Japanese')
eq(localizeServerText('ja', 'plain backend text'), 'plain backend text', 'other text passes through')

setActiveLocale('ja')
eq(tStatic('system.viewerClose'), '閉じる', 'tStatic follows the active locale')
setActiveLocale('en')

function walk(a: Record<string, unknown>, b: Record<string, unknown>, at: string) {
  for (const key of Object.keys(a)) {
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'string' && typeof vb === 'string') {
      const vars = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',')
      eq(vars(vb), vars(va), `placeholders match at ${at}${key}`)
    } else if (va && typeof va === 'object') {
      walk(va as Record<string, unknown>, vb as Record<string, unknown>, `${at}${key}.`)
    }
  }
}
walk(en as unknown as Record<string, unknown>, ja as unknown as Record<string, unknown>, '')

done('i18n')
