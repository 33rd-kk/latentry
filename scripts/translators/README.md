# Translation providers

`scripts/i18n-translate.mjs` turns `locales/en.json` into a catalog for another
language. It does the bookkeeping (what is missing or stale, protecting
placeholders, writing the files) and asks a **provider** for the translations.
A provider is one file here:

```js
// scripts/translators/<name>.mjs

/** Optional: how many texts to send per call (default 50). */
export const batchSize = 50

/**
 * @param {string[]} texts   English UI strings. Placeholders and markup have
 *                           been replaced with tokens like ⟦0⟧, which must come
 *                           back unchanged (order may change).
 * @param {{ from: string, to: string, keys: string[] }} options
 *                           Locale codes, and each text's key (e.g.
 *                           "generate.cancel") for context.
 * @returns {Promise<string[]>} One translation per text, in the same order.
 */
export async function translate(texts, { from, to, keys }) {
  // Call your machine translation service or LLM here.
}
```

Then:

```bash
TRANSLATOR=<name> npm run i18n:translate -- de     # writes locales/de.json
npm run i18n:check                                  # missing / stale / broken keys
```

The new language appears in the header's language menu on the next build.
Browsers whose language matches a catalog get it on their first visit.

Notes:

- Keep API keys in the environment, not in the provider file.
- The texts are short UI strings. Giving the provider the key (`keys[i]`) and
  telling it these are labels for an image-generation web UI improves results.
- A translation that loses a token is rejected and the key stays in English.
- Re-running only sends new or changed English strings. `--all` resends
  everything; `--dry-run` only counts.
- Generated catalogs can be edited by hand. A hand edit is kept until the
  English text of that key changes.

`pseudo.mjs` is a working example that needs no service: it produces
pseudo-localized text (`[Ĝéñéŕàţé ···]`) for checking layouts and for spotting
strings that are not translated.
