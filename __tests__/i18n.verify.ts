/**
 * The i18n core (lib/i18n/core.ts) and the catalog tooling
 * (scripts/i18n-translate.mjs): lookup with the English fallback, `{name}`
 * interpolation, `<tag>` markup, first-visit locale detection, the
 * server-message round trip, and the masking that keeps placeholders out of a
 * translator's reach. Every catalog in locales/ must use the same placeholders
 * as English.
 *
 * Run with: npm test -- i18n
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, done, eq } from './assert'
import { detectLocale, interpolate, localizeServerText, LOCALES, parseRich, serverMessage, setActiveLocale, translate, tStatic } from '../lib/i18n/core'

// A real dynamic import: these scripts are ES modules, and the CommonJS this
// file compiles to would otherwise turn import() into require().
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped .mjs modules
const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<any>
const load = (relative: string) => importModule(pathToFileURL(path.join(__dirname, relative)).href)

async function main() {
  eq(LOCALES[0], 'en', 'English is the source locale')
  eq(translate('en', 'generate.cancel'), 'Cancel', 'lookup')
  eq(translate('xx', 'generate.cancel'), 'Cancel', 'a locale without a catalog falls back to English')
  eq(translate('en', 'nope.missing' as never), 'nope.missing', 'an unknown key shows itself')
  eq(translate('en', 'generate.width', { value: 832 }), 'Width: 832', 'interpolation')
  eq(interpolate('{a} and {b}', { a: 1 }), '1 and {b}', 'unknown variables are left as written')

  const parts = parseRich('a <b>bold <i>both</i></b> c')
  check(parts.length === 3 && parts[0] === 'a ' && parts[2] === ' c', 'rich: text around a tag')
  eq(parseRich('<b>open'), ['open'], 'rich: an unclosed tag keeps its text')
  eq(parseRich('<lora:x>'), ['<lora:x>'], 'rich: angle brackets that are not a tag stay text')

  const available = ['en', 'de', 'pt-BR']
  eq(detectLocale(['fr-FR', 'de-AT'], available), 'de', 'the first browser language with a catalog, by base language')
  eq(detectLocale(['pt-br'], available), 'pt-BR', 'an exact match, case-insensitively')
  eq(detectLocale(['ja-JP'], available), 'en', 'no catalog means English')
  eq(detectLocale(undefined, available), 'en', 'no languages')

  const encoded = serverMessage('generate.saveFailed', { reason: 'EACCES' })
  check(localizeServerText('en', encoded).includes('EACCES'), 'a server message keeps its variables')
  eq(localizeServerText('en', 'plain backend text'), 'plain backend text', 'other text passes through')
  setActiveLocale('en')
  eq(tStatic('system.viewerClose'), 'Close', 'tStatic')

  // ── The translation tool ──
  const tool = await load('../scripts/i18n-translate.mjs')
  const masked = tool.mask('Added “{tag}” to <b>{where}</b>')
  eq(masked.text, 'Added “⟦0⟧” to ⟦1⟧⟦2⟧⟦3⟧', 'placeholders and markup become tokens')
  eq(tool.unmask('「⟦0⟧」を⟦1⟧⟦2⟧⟦3⟧に追加', masked.tokens), '「{tag}」を<b>{where}</b>に追加', 'tokens come back, in any order of words')
  eq(tool.unmask('「⟦0⟧」を追加', masked.tokens), null, 'a lost token is rejected')
  eq(tool.unmask('⟦0⟧⟦1⟧⟦2⟧⟦3⟧⟦9⟧', masked.tokens), null, 'an invented token is rejected')
  const flat = tool.flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })
  eq(flat, { 'a.b': 'x', 'a.c.d': 'y', e: 'z' }, 'flatten')
  eq(tool.unflatten({ e: 'z', 'a.b': 'x' }, Object.keys(flat)), { a: { b: 'x' }, e: 'z' }, 'unflatten keeps source order and skips missing keys')
  const pseudo = await load('../scripts/translators/pseudo.mjs')
  const [accented] = await pseudo.translate(['Save ⟦0⟧'], { from: 'en', to: 'en-XA' })
  check(accented.includes('⟦0⟧') && !accented.includes('Save'), 'the pseudo provider keeps tokens and changes letters')

  // ── Shipped catalogs ──
  const dir = path.join(__dirname, '..', 'locales')
  const english = tool.flatten(JSON.parse(readFileSync(path.join(dir, 'en.json'), 'utf8')))
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'en.json')) {
    const other = tool.flatten(JSON.parse(readFileSync(path.join(dir, file), 'utf8')))
    for (const [key, text] of Object.entries(other)) {
      if (key in english) eq(tool.placeholdersOf(text), tool.placeholdersOf(english[key]), `${file}: placeholders match at ${key}`)
    }
  }

  done('i18n')
}

void main()
