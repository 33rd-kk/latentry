// The page's side of wildcards: asks the server to replace them (the files
// are on the server) only when the prompt has any.

import { hasWildcards } from './syntax'

export type Expanded = { ok: true; prompt: string; negativePrompt: string } | { ok: false; error: string | null }

/** The prompt and negative prompt with their wildcards replaced; as they are when they have none. */
export async function expandWildcards(prompt: string, negativePrompt: string, seed: number): Promise<Expanded> {
  if (!hasWildcards(prompt) && !hasWildcards(negativePrompt)) return { ok: true, prompt, negativePrompt }
  try {
    const response = await fetch('/api/wildcards/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, negative_prompt: negativePrompt, seed }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || typeof data?.prompt !== 'string') return { ok: false, error: typeof data?.error === 'string' ? data.error : null }
    return { ok: true, prompt: data.prompt, negativePrompt: typeof data.negative_prompt === 'string' ? data.negative_prompt : '' }
  } catch {
    return { ok: false, error: null }
  }
}
