// Pseudo-localization: not a language, a test. Accents every letter and pads
// the text by about a third, so untranslated strings (still plain) and layouts
// that break on longer text both stand out.
//
//   TRANSLATOR=pseudo npm run i18n:translate -- en-XA

const ACCENTED = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter, index) => [
    letter,
    [...'àƀçđéƒĝĥíĵķĺɱñóƥʠŕšţúṽŵẋýžÀƁÇĐÉƑĜĤÍĴĶĹṀÑÓƤǪŔŠŢÚṼŴẊÝŽ'][index],
  ])
)

export const batchSize = 200

/** @param {string[]} texts @param {{ from: string, to: string }} _options */
export async function translate(texts, _options) {
  return texts.map((text) => {
    // Tokens (⟦0⟧) pass through untouched; only letters outside them change.
    const accented = text.replace(/⟦\d+⟧|[A-Za-z]/g, (part) => (part.length > 1 ? part : ACCENTED[part] ?? part))
    const padding = '·'.repeat(Math.max(1, Math.round(text.length / 3)))
    return `[${accented} ${padding}]`
  })
}
