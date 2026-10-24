// Translations written beforehand, read from a JSON file on this computer
// instead of asked of a service: for translating by hand, or with a tool that
// runs offline. Nothing is sent anywhere.
//
//   I18N_FILE=path/to/ja.json TRANSLATOR=file npm run i18n:translate -- ja --all
//
// The file has the shape of locales/en.json (nested, or flat "a.b" keys),
// with each text translated and its placeholders and markup ({name}, <b>)
// written as in English. A key the file lacks, or whose placeholders do not
// match the English, stays in English and is listed.

import { readFileSync } from 'node:fs'
import { flatten, mask } from '../i18n-translate.mjs'

export const batchSize = 1000

const TOKEN_PATTERN = /\{\w+\}|<\/?\w+>/g

const readFlat = (file) => flatten(JSON.parse(readFileSync(file, 'utf8')))
let found = null
let english = null

function translations() {
  const file = process.env.I18N_FILE?.trim()
  if (!file) throw new Error('Set I18N_FILE to the JSON file with the translations.')
  found ??= readFlat(file)
  return found
}

function sourceText(key) {
  english ??= readFlat(new URL('../../locales/en.json', import.meta.url))
  return english[key]
}

/** The translation with its tokens swapped for the English text's ⟦n⟧, matched by what they are. */
function remask(text, english) {
  const { tokens } = mask(english)
  const used = new Set()
  return text.replace(TOKEN_PATTERN, (token) => {
    const index = tokens.findIndex((candidate, at) => candidate === token && !used.has(at))
    if (index === -1) return token
    used.add(index)
    return `⟦${index}⟧`
  })
}

/** @param {string[]} _texts @param {{ keys: string[] }} options */
export async function translate(_texts, { keys }) {
  const texts = translations()
  return keys.map((key) => (typeof texts[key] === 'string' ? remask(texts[key], sourceText(key)) : null))
}
