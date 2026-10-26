// The browser's side of /api/models/info. Nothing is kept here: the info
// lives in a file on the server, and only this computer and owner devices
// may read it.

import type { ModelInfo } from '@/lib/models/info'

/** What is sent to keep a model's info: everything but its name and time. */
export type ModelInfoDraft = Omit<ModelInfo, 'name' | 'updatedAt'>

/** A failed save: the server's error, with its field errors when it named fields. */
export interface ModelInfoFailure {
  error: string
  errors?: Record<string, string>
}

async function failure(response: Response | null): Promise<ModelInfoFailure> {
  const body = await response?.json().catch(() => null)
  return { error: String(body?.error ?? (response ? `HTTP ${response.status}` : 'unreachable')), errors: body?.errors }
}

const query = (name: string) => `/api/models/info?name=${encodeURIComponent(name)}`

/** Every model's info by key, or null for a client that may not see it. */
export async function listModelInfo(): Promise<Record<string, ModelInfo> | null> {
  const response = await fetch('/api/models/info', { cache: 'no-store' }).catch(() => null)
  if (!response?.ok) return null
  return ((await response.json().catch(() => null))?.models as Record<string, ModelInfo> | undefined) ?? null
}

/** One model's info (null when none is kept), or undefined for a client that may not see it. */
export async function getModelInfo(name: string): Promise<ModelInfo | null | undefined> {
  const response = await fetch(query(name), { cache: 'no-store' }).catch(() => null)
  if (!response?.ok) return undefined
  return ((await response.json().catch(() => null))?.info as ModelInfo | null | undefined) ?? null
}

export async function putModelInfo(name: string, draft: ModelInfoDraft): Promise<{ info: ModelInfo } | ModelInfoFailure> {
  const response = await fetch('/api/models/info', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, info: draft }),
  }).catch(() => null)
  if (!response?.ok) return failure(response)
  return { info: (await response.json()).info as ModelInfo }
}

/** Forgets a model's info; resolves to null, or the server's error. */
export async function deleteModelInfo(name: string): Promise<string | null> {
  const response = await fetch(query(name), { method: 'DELETE' }).catch(() => null)
  return response?.ok ? null : (await failure(response)).error
}
