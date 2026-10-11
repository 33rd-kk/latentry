// SPDX-License-Identifier: MIT
//
// What a picture's text means: the settings it was made with, read from
// whichever tool wrote them (Latentry's own record, A1111 / Forge infotext,
// ComfyUI's executed graph), and the WD14 tags written back.
//
// Part of lib/image-meta: no imports outside node's built-ins (see README.md).

import { LATENTRY_KEY, PARAMETERS_KEY, TAGS_KEY } from './png'

export interface ImageTag {
  name: string
  category: number
  score: number
}

/** The settings a picture was made with, whichever tool wrote them. */
export interface ImageMeta {
  source: 'latentry' | 'a1111' | 'comfyui' | 'unknown'
  prompt: string
  negativePrompt: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  strength?: number
  model?: string
  /** Latentry only: which backend and profile drew it. */
  backend?: string
  kind?: string
  profile?: string
  mode?: string
  /** WD14 tags written back by the gallery. */
  tags?: ImageTag[]
  created?: string
  /** LoRA (and LyCORIS) names, without folder or extension, each once. */
  loras?: string[]
}

/** The JSON stored under the `latentry` keyword. */
export interface LatentryRecord {
  schema: 1
  backend: string
  kind: string
  profile: string
  model: string | null
  mode: string
  prompt: string
  negative_prompt: string
  seed: number
  width: number
  height: number
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  strength?: number
  /**
   * The LoRAs the backend says it applied. Left out when it applied none or
   * cannot say: a `<lora:…>` call in the prompt alone proves nothing.
   */
  loras?: LoraUse[]
  created: string
}

/** One LoRA as applied to a run: its name (no folder or extension) and weight. */
export interface LoraUse {
  name: string
  weight: number
  /** A1111's short hash of the file, when the backend was asked for it. Never kept in the record. */
  hash?: string
}

/** A LoRA as it is named across tools: no folder, no model-file extension. */
export function loraName(raw: string): string {
  const base = raw.trim().split(/[\\/]/).pop() ?? ''
  return base.replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '').trim()
}

/** The LoRAs a prompt calls: `<lora:name:weight>` and `<lyco:name:weight>`. */
export function lorasInPrompt(prompt: string): string[] {
  const names: string[] = []
  for (const match of prompt.matchAll(/<(?:lora|lyco):([^:>]+)(?::[^>]*)?>/gi)) names.push(loraName(match[1]))
  return names
}

/** The LoRA calls in a prompt with their weights: the first number after the name, else 1. */
export function loraCallsInPrompt(prompt: string): LoraUse[] {
  const calls: LoraUse[] = []
  // Each part stops where the next one starts, and none runs past a "<", so an unclosed call cannot backtrack.
  for (const match of prompt.matchAll(/<(?:lora|lyco):([^:<>]+)(?::([^:<>]*))?(?::[^<>]*)?>/gi)) {
    const weight = Number(match[2])
    const name = loraName(match[1])
    if (name) calls.push({ name, weight: match[2]?.trim() && Number.isFinite(weight) ? weight : 1 })
  }
  return calls
}

/** Names once each, in the order first met; undefined when there are none. */
function uniqueLoras(names: string[]): string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out.length ? out : undefined
}

/**
 * A1111's infotext: the prompt, an optional "Negative prompt:" line, and a
 * last line of "Key: value, Key: value" settings (values may be quoted).
 */
export function parseA1111Parameters(text: string): ImageMeta {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let settingsLine = ''
  if (lines.length && /^Steps: /.test(lines[lines.length - 1].trim())) settingsLine = lines.pop()!.trim()

  const negativeIndex = lines.findIndex((line) => line.startsWith('Negative prompt:'))
  const prompt = (negativeIndex === -1 ? lines : lines.slice(0, negativeIndex)).join('\n').trim()
  const negativePrompt =
    negativeIndex === -1
      ? ''
      : [lines[negativeIndex].slice('Negative prompt:'.length), ...lines.slice(negativeIndex + 1)].join('\n').trim()

  const settings: Record<string, string> = {}
  const pattern = /\s*([^:,]+):\s*("(?:\\.|[^\\"])*"|[^,]*)(?:,|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(settingsLine)) && match[0]) {
    let value = match[2].trim()
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value)
      } catch {
        // keep it quoted
      }
    }
    settings[match[1].trim()] = value
  }

  const num = (key: string) => {
    const value = Number(settings[key])
    return settings[key] !== undefined && Number.isFinite(value) ? value : undefined
  }
  const size = /^(\d+)x(\d+)$/.exec(settings.Size ?? '')
  return {
    source: 'a1111',
    prompt,
    negativePrompt,
    seed: num('Seed'),
    steps: num('Steps'),
    cfg: num('CFG scale'),
    sampler: settings.Sampler,
    scheduler: settings['Schedule type'],
    strength: num('Denoising strength'),
    model: settings.Model,
    loras: uniqueLoras([
      ...lorasInPrompt(prompt),
      // "Lora hashes": "name: hash, name: hash" (quoted, as it holds commas).
      ...(settings['Lora hashes'] ?? '').split(',').map((pair) => loraName(pair.split(':')[0] ?? '')),
    ]),
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
  }
}

/**
 * Writes the A1111 infotext for a record, so other tools can read our files.
 * `loraHashes` adds A1111's "Lora hashes" (only when the user turned it on).
 */
export function formatA1111Parameters(record: LatentryRecord, loraHashes: LoraUse[] = []): string {
  const hashed = loraHashes.filter((lora) => lora.hash)
  const settings: string[] = [
    `Steps: ${record.steps}`,
    `Sampler: ${record.sampler}`,
    ...(record.scheduler && record.scheduler !== 'Default' ? [`Schedule type: ${record.scheduler}`] : []),
    `CFG scale: ${record.cfg}`,
    `Seed: ${record.seed}`,
    `Size: ${record.width}x${record.height}`,
    ...(record.model ? [`Model: ${quoteIfNeeded(record.model)}`] : []),
    ...(record.strength !== undefined ? [`Denoising strength: ${record.strength}`] : []),
    ...(hashed.length ? [`Lora hashes: ${JSON.stringify(hashed.map((lora) => `${lora.name}: ${lora.hash}`).join(', '))}`] : []),
    `Version: Latentry (${record.backend})`,
  ]
  const lines = [record.prompt]
  if (record.negative_prompt) lines.push(`Negative prompt: ${record.negative_prompt}`)
  lines.push(settings.join(', '))
  return lines.join('\n')
}

function quoteIfNeeded(value: string): string {
  return /[,:"]/.test(value) ? JSON.stringify(value) : value
}

type ComfyNode = { class_type?: unknown; inputs?: Record<string, unknown> }

/**
 * A model file as it is shown to people: its file name, without the folders
 * it sits in on someone's disk (ComfyUI names models by their path under its
 * models folder, e.g. "sdxl\anime\x.safetensors").
 */
export function modelFileName(raw: string): string {
  return (raw.trim().split(/[\\/]/).pop() ?? '').trim()
}

/** How far a link is followed: past this, a graph is more likely a loop than a chain. */
const MAX_LINK_DEPTH = 4

/** The samplers in a graph: KSampler and its variants, SamplerCustom(Advanced); not KSamplerSelect. */
const SAMPLER_CLASS = /KSampler(?!Select)|SamplerCustom/
/** Where a first pass starts: EmptyLatentImage, EmptySD3LatentImage and the like. */
const EMPTY_LATENT_CLASS = /^Empty.*Latent/i

const isComfyLink = (value: unknown): value is [string | number, number] =>
  Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number'

/**
 * ComfyUI's `prompt` chunk is the executed graph: node id -> { class_type, inputs },
 * with links as [node id, output index]. The sampler's `positive` / `negative`
 * links lead to the text encoders, which is how the two prompts are told apart.
 * With two samplers (a hires or refiner pass), the one that starts from an
 * empty latent is the picture's base. SamplerCustomAdvanced keeps its settings
 * on the nodes it links to (noise, guider, sampler, sigmas), and any number may
 * come from a primitive or seed node by a link.
 */
export function parseComfyPrompt(text: string): ImageMeta | null {
  let graph: Record<string, ComfyNode>
  try {
    graph = JSON.parse(text)
  } catch {
    return null
  }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return null

  const nodes = Object.values(graph)
  const nodeAt = (link: unknown) => (isComfyLink(link) ? graph[String(link[0])] : undefined)
  const classOf = (node: ComfyNode | undefined) => (typeof node?.class_type === 'string' ? node.class_type : '')
  const inputsAt = (link: unknown) => nodeAt(link)?.inputs ?? {}

  // A number given in place, or by a link to the node holding it.
  const num = (value: unknown, depth = 0): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (!isComfyLink(value) || depth >= MAX_LINK_DEPTH) return undefined
    const inputs = inputsAt(value)
    for (const key of ['value', 'seed', 'noise_seed', 'int', 'number']) {
      const found = num(inputs[key], depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

  const textOf = (link: unknown, depth = 0): string => {
    if (!isComfyLink(link) || depth > MAX_LINK_DEPTH) return ''
    const inputs = inputsAt(link)
    for (const key of ['text', 'text_g', 'prompt']) {
      if (typeof inputs[key] === 'string') return inputs[key] as string
      if (isComfyLink(inputs[key])) return textOf(inputs[key], depth + 1)
    }
    // A conditioning passthrough (e.g. a combine node): follow its first link.
    const next = Object.values(inputs).find(isComfyLink)
    return next ? textOf(next, depth + 1) : ''
  }

  const samplers = nodes.filter((node) => SAMPLER_CLASS.test(classOf(node)))
  const sampler = samplers.find((node) => EMPTY_LATENT_CLASS.test(classOf(nodeAt(node.inputs?.latent_image)))) ?? samplers[0]
  const inputs = sampler?.inputs ?? {}
  // SamplerCustom(Advanced) spreads its settings over the nodes it links to.
  const guider = inputsAt(inputs.guider)
  const sigmas = inputsAt(inputs.sigmas)
  const chosen = inputsAt(inputs.sampler)
  const noise = inputsAt(inputs.noise)
  const latent = inputsAt(inputs.latent_image)

  const prompt = textOf(inputs.positive ?? guider.positive ?? guider.conditioning)
  if (!prompt && !sampler) return null
  const denoise = num(inputs.denoise) ?? num(sigmas.denoise)
  const model = comfyModel(nodes)
  return {
    source: 'comfyui',
    prompt,
    negativePrompt: textOf(inputs.negative ?? guider.negative),
    seed: num(inputs.seed) ?? num(inputs.noise_seed) ?? num(noise.noise_seed),
    steps: num(inputs.steps) ?? num(sigmas.steps),
    cfg: num(inputs.cfg) ?? num(guider.cfg),
    sampler: str(inputs.sampler_name) ?? str(chosen.sampler_name),
    scheduler: str(inputs.scheduler) ?? str(sigmas.scheduler),
    strength: denoise !== undefined && denoise < 1 ? denoise : undefined,
    model,
    width: num(latent.width),
    height: num(latent.height),
    loras: uniqueLoras([...lorasInPrompt(prompt), ...comfyLoras(nodes)]),
  }
}

/**
 * The model file of a graph, by name only: a checkpoint loader's `ckpt_name`
 * first, else any loader's `ckpt_name` / `unet_name` (UNETLoader, the
 * Efficiency and custom checkpoint loaders).
 */
function comfyModel(nodes: ComfyNode[]): string | undefined {
  const fileOf = (node: ComfyNode) => {
    const value = node?.inputs?.ckpt_name ?? node?.inputs?.unet_name
    return typeof value === 'string' && value && value !== 'None' ? modelFileName(value) : undefined
  }
  const loaders = nodes.filter((node) => typeof node?.class_type === 'string' && /Loader/i.test(node.class_type) && fileOf(node))
  const loader = loaders.find((node) => /^CheckpointLoader/.test(node.class_type as string)) ?? loaders[0]
  return loader ? fileOf(loader) : undefined
}

type WorkflowNode = {
  id?: unknown
  type?: unknown
  mode?: unknown
  inputs?: { name?: unknown; link?: unknown }[]
  widgets_values?: unknown
}

/** ComfyUI's frontend values for a sampler's seed widget's "control after generate". */
const SEED_CONTROLS = new Set(['fixed', 'increment', 'decrement', 'randomize'])

/**
 * ComfyUI's `workflow` chunk, for pictures that carry only that: the editor's
 * graph, with nodes in an array, settings as each node's `widgets_values` in
 * widget order, and links as [id, from node, from slot, to node, to slot, type].
 * Only the stock nodes are read (KSampler, KSamplerAdvanced, CLIPTextEncode,
 * the checkpoint and LoRA loaders, EmptyLatentImage), whose widget order is
 * known; muted and bypassed nodes are left out.
 */
export function parseComfyWorkflow(text: string): ImageMeta | null {
  let workflow: { nodes?: unknown; links?: unknown }
  try {
    workflow = JSON.parse(text)
  } catch {
    return null
  }
  if (!workflow || !Array.isArray(workflow.nodes)) return null

  // Mode 2 is muted and 4 is bypassed: neither ran.
  const nodes = (workflow.nodes as WorkflowNode[]).filter((node) => node && typeof node === 'object' && node.mode !== 2 && node.mode !== 4)
  const byId = new Map(nodes.map((node) => [String(node.id), node]))
  const sources = new Map<string, string>()
  for (const link of Array.isArray(workflow.links) ? workflow.links : []) {
    if (Array.isArray(link) && link.length >= 2) sources.set(String(link[0]), String(link[1]))
  }
  const typeOf = (node: WorkflowNode | undefined) => (typeof node?.type === 'string' ? node.type : '')
  const widgets = (node: WorkflowNode | undefined): unknown[] => (Array.isArray(node?.widgets_values) ? node.widgets_values : [])
  // The node feeding one of this node's inputs, by the input's name.
  const feeding = (node: WorkflowNode | undefined, name: string) => {
    const link = node?.inputs?.find((input) => input?.name === name)?.link
    return link === null || link === undefined ? undefined : byId.get(sources.get(String(link)) ?? '')
  }
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

  const textOf = (node: WorkflowNode | undefined, depth = 0): string => {
    if (!node || depth > MAX_LINK_DEPTH) return ''
    // Only the plain encoder: the SDXL one has its size widgets first.
    if (typeOf(node) === 'CLIPTextEncode') {
      // The text may come from another node (a primitive or a string node).
      const from = feeding(node, 'text')
      if (from) return str(widgets(from)[0]) ?? ''
      return str(widgets(node)[0]) ?? ''
    }
    // A conditioning passthrough (e.g. a combine node): follow its first input.
    const first = node.inputs?.find((input) => input?.link !== null && input?.link !== undefined)
    return first ? textOf(feeding(node, String(first.name)), depth + 1) : ''
  }

  const samplers = nodes.filter((node) => typeOf(node) === 'KSampler' || typeOf(node) === 'KSamplerAdvanced')
  const sampler = samplers.find((node) => EMPTY_LATENT_CLASS.test(typeOf(feeding(node, 'latent_image')))) ?? samplers[0]
  if (!sampler) return null

  // KSampler: seed, control, steps, cfg, sampler, scheduler, denoise.
  // KSamplerAdvanced: add_noise, seed, control, steps, cfg, sampler, scheduler, start, end, leftover.
  // The control widget is missing from some older files; it is told apart by its values.
  let values = widgets(sampler)
  if (typeOf(sampler) === 'KSamplerAdvanced') values = values.slice(1)
  const [seed, ...rest] = values
  const [steps, cfg, samplerName, scheduler, denoise] = SEED_CONTROLS.has(rest[0] as string) ? rest.slice(1) : rest
  const latent = feeding(sampler, 'latent_image')
  const [width, height] = EMPTY_LATENT_CLASS.test(typeOf(latent)) ? widgets(latent) : []
  const checkpoint = nodes.find((node) => /^CheckpointLoader/.test(typeOf(node)))
  const loras = nodes.filter((node) => /^LoraLoader/.test(typeOf(node))).map((node) => str(widgets(node)[0]))

  const prompt = textOf(feeding(sampler, 'positive'))
  const strength = typeOf(sampler) === 'KSampler' ? num(denoise) : undefined
  const model = str(widgets(checkpoint)[0])
  return {
    source: 'comfyui',
    prompt,
    negativePrompt: textOf(feeding(sampler, 'negative')),
    seed: num(seed),
    steps: num(steps),
    cfg: num(cfg),
    sampler: str(samplerName),
    scheduler: str(scheduler),
    strength: strength !== undefined && strength < 1 ? strength : undefined,
    model: model ? modelFileName(model) : undefined,
    width: num(width),
    height: num(height),
    loras: uniqueLoras([
      ...lorasInPrompt(prompt),
      ...loras.flatMap((name) => (name && name !== 'None' ? [loraName(name)] : [])),
    ]),
  }
}

/**
 * The LoRA loaders in a ComfyUI graph: `lora_name` on the stock loaders, and
 * the `lora_N: { on, lora }` slots that multi-LoRA loader nodes use. A slot
 * switched off is left out.
 */
function comfyLoras(nodes: ComfyNode[]): string[] {
  const names: string[] = []
  for (const node of nodes) {
    if (typeof node?.class_type !== 'string' || !/lora/i.test(node.class_type)) continue
    for (const [key, value] of Object.entries(node.inputs ?? {})) {
      if (key === 'lora_name' && typeof value === 'string' && value !== 'None') names.push(loraName(value))
      if (/^lora_\d+$/.test(key) && value && typeof value === 'object') {
        const slot = value as { on?: unknown; lora?: unknown }
        if (slot.on !== false && typeof slot.lora === 'string' && slot.lora !== 'None') names.push(loraName(slot.lora))
      }
    }
  }
  return names
}

function isTagList(value: unknown): value is ImageTag[] {
  return (
    Array.isArray(value) &&
    value.every((tag) => typeof tag?.name === 'string' && typeof tag?.score === 'number' && typeof tag?.category === 'number')
  )
}

export function parseLatentryRecord(text: string): ImageMeta | null {
  let record: Partial<LatentryRecord>
  try {
    record = JSON.parse(text)
  } catch {
    return null
  }
  if (!record || record.schema !== 1 || typeof record.prompt !== 'string') return null
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    source: 'latentry',
    prompt: record.prompt,
    negativePrompt: typeof record.negative_prompt === 'string' ? record.negative_prompt : '',
    seed: num(record.seed),
    width: num(record.width),
    height: num(record.height),
    steps: num(record.steps),
    cfg: num(record.cfg),
    sampler: str(record.sampler),
    scheduler: str(record.scheduler),
    strength: num(record.strength),
    model: str(record.model),
    backend: str(record.backend),
    kind: str(record.kind),
    profile: str(record.profile),
    mode: str(record.mode),
    created: str(record.created),
    loras: recordLoras(record),
  }
}

/**
 * A record's LoRAs. Records from before `loras` was written fall back to the
 * prompt only when A1111 drew them, as no other backend applied the calls.
 */
function recordLoras(record: Partial<LatentryRecord>): string[] | undefined {
  if (Array.isArray(record.loras)) {
    return uniqueLoras(record.loras.flatMap((lora) => (typeof lora?.name === 'string' ? [loraName(lora.name)] : [])))
  }
  return record.kind === 'a1111' ? uniqueLoras(lorasInPrompt(record.prompt ?? '')) : undefined
}

export function parseTags(text: string | undefined): ImageTag[] | null {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return isTagList(value) ? value : null
  } catch {
    return null
  }
}

/**
 * The settings in a picture's text chunks, preferring the most structured
 * source: our own record, then A1111's infotext, then ComfyUI's executed
 * graph, then its editor graph. WD14 tags written back by the gallery join
 * whichever source supplies the rest.
 */
export function metaFromText(text: Record<string, string>): ImageMeta | null {
  const tags = parseTags(text[TAGS_KEY])
  const meta =
    (text[LATENTRY_KEY] ? parseLatentryRecord(text[LATENTRY_KEY]) : null) ??
    (text[PARAMETERS_KEY] ? parseA1111Parameters(text[PARAMETERS_KEY]) : null) ??
    (text.prompt ? parseComfyPrompt(text.prompt) : null) ??
    (text.workflow ? parseComfyWorkflow(text.workflow) : null)
  if (!meta && !tags) return null
  return { ...(meta ?? { source: 'unknown', prompt: '', negativePrompt: '' }), ...(tags ? { tags } : {}) }
}
