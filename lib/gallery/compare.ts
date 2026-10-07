// What differs between two gallery pictures: their settings side by side,
// and the prompt tags only one of them has. Pure, so the verify script can
// pin it down; the compare dialog only lays it out.

import type { ImageMeta } from '../image-meta'
import { normalizeTag } from './query'

export interface CompareSide {
  meta: ImageMeta | null
  width: number | null
  height: number | null
}

export type SettingKey = 'model' | 'loras' | 'seed' | 'steps' | 'cfg' | 'sampler' | 'strength' | 'size'

export interface SettingRow {
  key: SettingKey
  a: string
  b: string
  differs: boolean
}

function settingOf(side: CompareSide, key: SettingKey): string {
  const meta = side.meta
  switch (key) {
    case 'loras':
      return meta?.loras?.join(', ') ?? ''
    case 'sampler':
      return [meta?.sampler, meta?.scheduler].filter(Boolean).join(' / ')
    case 'size':
      return side.width && side.height ? `${side.width}×${side.height}` : ''
    default: {
      const value = meta?.[key]
      return value === undefined || value === null ? '' : String(value)
    }
  }
}

const ROWS: SettingKey[] = ['model', 'loras', 'seed', 'steps', 'cfg', 'sampler', 'strength', 'size']

/** Each setting either picture has, with whether the two differ. */
export function settingRows(a: CompareSide, b: CompareSide): SettingRow[] {
  return ROWS.map((key) => {
    const left = settingOf(a, key)
    const right = settingOf(b, key)
    return { key, a: left, b: right, differs: left !== right }
  }).filter((row) => row.a || row.b)
}

/** A prompt's tags, bare (weights and emphasis off), in order, each once. LoRA calls are left out. */
export function promptTags(prompt: string | undefined): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const token of (prompt ?? '').split(',')) {
    if (token.trim().startsWith('<')) continue
    const tag = normalizeTag(token)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
  }
  return tags
}

/** The prompt tags only `a` has, only `b` has, and how many they share. */
export function tagDiff(a: string | undefined, b: string | undefined): { onlyA: string[]; onlyB: string[]; shared: number } {
  const tagsA = promptTags(a)
  const tagsB = promptTags(b)
  const inA = new Set(tagsA)
  const inB = new Set(tagsB)
  return {
    onlyA: tagsA.filter((tag) => !inB.has(tag)),
    onlyB: tagsB.filter((tag) => !inA.has(tag)),
    shared: tagsA.filter((tag) => inB.has(tag)).length,
  }
}

/** Whether two pictures have (nearly) the same shape, so one can slide over the other. */
export function sameShape(a: CompareSide, b: CompareSide): boolean {
  if (!a.width || !a.height || !b.width || !b.height) return false
  return Math.abs(a.width / a.height - b.width / b.height) < 0.01
}
