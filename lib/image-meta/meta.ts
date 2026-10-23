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
  /** Hires fix; `width` and `height` are then the first pass's size. */
  hires?: HiresUse
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
  /** Latentry only: the prompt as typed, with its wildcards, when it had any. */
  promptTemplate?: string
  /** Latentry only: the X/Y grid it was drawn for, and its place there. */
  grid?: GridUse
}

/**
 * Where a picture sits in an X/Y grid: the grid's id (random, shared by its
 * cells) and the value each axis set. A grid's sheet has every value of an
 * axis, joined with ", ".
 */
export interface GridUse {
  id: string
  x: { axis: string; value: string }
  y?: { axis: string; value: string }
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
  /** The prompt with its `__wildcards__`, before they were replaced; only when it had any. */
  prompt_template?: string
  negative_prompt: string
  seed: number
  width: number
  height: number
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  strength?: number
  /** Hires fix; `width` and `height` are then the first pass's size, as in A1111's infotext. */
  hires?: HiresUse
  /**
   * The LoRAs the backend says it applied. Left out when it applied none or
   * cannot say: a `<lora:…>` call in the prompt alone proves nothing.
   */
  loras?: LoraUse[]
  /** The ComfyUI workflow (its file name) the picture was drawn with, instead of a built-in graph. */
  workflow?: string
  /** The X/Y grid it is a cell of (or the sheet of, when `mode` is "sheet"). */
  grid?: GridUse
  created: string
}

/** A hires fix pass: upscaled by `scale` with `upscaler`, then redrawn for `steps` (0: as many as the first pass) at `denoise`. */
export interface HiresUse {
  scale: number
  steps: number
  denoise: number
  upscaler: string
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
  // With hires fix the denoising strength is the second pass's, not an img2img source's.
  const hiresScale = num('Hires upscale')
  const hires: HiresUse | undefined =
    hiresScale !== undefined
      ? { scale: hiresScale, steps: num('Hires steps') ?? 0, denoise: num('Denoising strength') ?? 0.4, upscaler: settings['Hires upscaler'] || 'Latent' }
      : undefined
  return {
    source: 'a1111',
    prompt,
    negativePrompt,
    seed: num('Seed'),
    steps: num('Steps'),
    cfg: num('CFG scale'),
    sampler: settings.Sampler,
    scheduler: settings['Schedule type'],
    ...(hires ? { hires } : { strength: num('Denoising strength') }),
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
    ...(record.hires
      ? [
          `Denoising strength: ${record.hires.denoise}`,
          `Hires upscale: ${record.hires.scale}`,
          ...(record.hires.steps ? [`Hires steps: ${record.hires.steps}`] : []),
          `Hires upscaler: ${quoteIfNeeded(record.hires.upscaler)}`,
        ]
      : []),
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

  const roles = comfyGraphRoles(graph)
  const at = (slot: ComfySlot | undefined) => (slot ? graph[slot.node]?.inputs?.[slot.input] : undefined)
  const num = (slot: ComfySlot | undefined) => {
    const value = at(slot)
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const str = (slot: ComfySlot | undefined) => {
    const value = at(slot)
    return typeof value === 'string' && value ? value : undefined
  }

  const prompt = str(roles.positive) ?? ''
  if (!prompt && !roles.sampler) return null
  const denoise = num(roles.denoise)
  const model = str(roles.model)
  return {
    source: 'comfyui',
    prompt,
    negativePrompt: str(roles.negative) ?? '',
    seed: num(roles.seed),
    steps: num(roles.steps),
    cfg: num(roles.cfg),
    sampler: str(roles.samplerName),
    scheduler: str(roles.scheduler),
    strength: denoise !== undefined && denoise < 1 ? denoise : undefined,
    model: model && model !== 'None' ? modelFileName(model) : undefined,
    width: num(roles.width),
    height: num(roles.height),
    loras: uniqueLoras([...lorasInPrompt(prompt), ...comfyLoras(Object.values(graph))]),
  }
}

/** Where one value of a ComfyUI graph lives: a node id and one of its inputs. */
export interface ComfySlot {
  node: string
  input: string
}

/**
 * Which node of a ComfyUI graph (API format) holds what, for reading a
 * picture's settings and for filling a workflow with new ones.
 */
export interface ComfyRoles {
  /** The base pass's sampler (see parseComfyPrompt). */
  sampler?: string
  positive?: ComfySlot
  negative?: ComfySlot
  seed?: ComfySlot
  steps?: ComfySlot
  cfg?: ComfySlot
  denoise?: ComfySlot
  samplerName?: ComfySlot
  scheduler?: ComfySlot
  width?: ComfySlot
  height?: ComfySlot
  batch?: ComfySlot
  /** The model file: a checkpoint loader's ckpt_name, else any loader's ckpt_name / unet_name. */
  model?: ComfySlot
  /** A CheckpointLoader* node, whose outputs 0 and 1 are MODEL and CLIP: where LoRA loaders go. */
  checkpointLoader?: string
  /** SaveImage / PreviewImage nodes, a `latentry:output` one first. */
  outputs: string[]
}

/** The roles a node's title can claim, as `latentry:<role>` (e.g. "Prompt latentry:prompt"). */
export const COMFY_MARKERS = ['prompt', 'negative', 'seed', 'size', 'steps', 'cfg', 'sampler', 'output'] as const

const NUMBER_KEYS = ['value', 'seed', 'noise_seed', 'int', 'number']
const TEXT_KEYS = ['text', 'text_g', 'prompt', 'value', 'string']
const OUTPUT_CLASS = /^(SaveImage|PreviewImage)$/

/**
 * Finds the roles in a graph: from the base sampler, following links to the
 * nodes that hold each value (text encoders through passthroughs, seed and
 * primitive nodes, SamplerCustomAdvanced's noise, guider, sampler and sigmas).
 * A node titled with a `latentry:<role>` marker takes that role instead.
 */
export function comfyGraphRoles(graph: Record<string, ComfyNode & { _meta?: { title?: unknown } }>): ComfyRoles {
  const ids = Object.keys(graph)
  const idOf = (link: unknown) => (isComfyLink(link) && graph[String(link[0])] ? String(link[0]) : undefined)
  const classOf = (id: string | undefined) => {
    const type = id ? graph[id]?.class_type : undefined
    return typeof type === 'string' ? type : ''
  }
  const inputsOf = (id: string | undefined) => (id ? (graph[id]?.inputs ?? {}) : {})

  // Where a number is held: in place, or on the node a link leads to.
  const numberSlot = (id: string | undefined, input: string, depth = 0): ComfySlot | undefined => {
    if (!id) return undefined
    const value = inputsOf(id)[input]
    if (typeof value === 'number' && Number.isFinite(value)) return { node: id, input }
    if (!isComfyLink(value) || depth >= MAX_LINK_DEPTH) return undefined
    const next = idOf(value)
    for (const key of NUMBER_KEYS) {
      const found = numberSlot(next, key, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const stringSlot = (id: string | undefined, input: string): ComfySlot | undefined =>
    id && typeof inputsOf(id)[input] === 'string' ? { node: id, input } : undefined
  // Where a prompt's text is held, from a conditioning link.
  const textSlot = (link: unknown, depth = 0): ComfySlot | undefined => {
    const id = idOf(link)
    if (!id || depth > MAX_LINK_DEPTH) return undefined
    const inputs = inputsOf(id)
    for (const key of TEXT_KEYS) {
      if (typeof inputs[key] === 'string') return { node: id, input: key }
      if (isComfyLink(inputs[key])) return textSlot(inputs[key], depth + 1)
    }
    // A conditioning passthrough (e.g. a combine node): follow its first link.
    const next = Object.values(inputs).find(isComfyLink)
    return next ? textSlot(next, depth + 1) : undefined
  }

  const samplers = ids.filter((id) => SAMPLER_CLASS.test(classOf(id)))
  const sampler = samplers.find((id) => EMPTY_LATENT_CLASS.test(classOf(idOf(inputsOf(id).latent_image)))) ?? samplers[0]
  const inputs = inputsOf(sampler)
  // SamplerCustom(Advanced) spreads its settings over the nodes it links to.
  const guider = idOf(inputs.guider)
  const sigmas = idOf(inputs.sigmas)
  const chosen = idOf(inputs.sampler)
  const noise = idOf(inputs.noise)
  const latent = idOf(inputs.latent_image)

  const loaders = ids.filter((id) => /Loader/i.test(classOf(id)) && ['ckpt_name', 'unet_name'].some((key) => typeof inputsOf(id)[key] === 'string'))
  const loader = loaders.find((id) => /^CheckpointLoader/.test(classOf(id))) ?? loaders[0]

  const roles: ComfyRoles = {
    sampler,
    positive: textSlot(inputs.positive ?? inputsOf(guider).positive ?? inputsOf(guider).conditioning),
    negative: textSlot(inputs.negative ?? inputsOf(guider).negative),
    seed: numberSlot(sampler, 'seed') ?? numberSlot(sampler, 'noise_seed') ?? numberSlot(noise, 'noise_seed'),
    steps: numberSlot(sampler, 'steps') ?? numberSlot(sigmas, 'steps'),
    cfg: numberSlot(sampler, 'cfg') ?? numberSlot(guider, 'cfg'),
    denoise: numberSlot(sampler, 'denoise') ?? numberSlot(sigmas, 'denoise'),
    samplerName: stringSlot(sampler, 'sampler_name') ?? stringSlot(chosen, 'sampler_name'),
    scheduler: stringSlot(sampler, 'scheduler') ?? stringSlot(sigmas, 'scheduler'),
    width: numberSlot(latent, 'width'),
    height: numberSlot(latent, 'height'),
    batch: numberSlot(latent, 'batch_size'),
    model: loader ? (stringSlot(loader, 'ckpt_name') ?? stringSlot(loader, 'unet_name')) : undefined,
    checkpointLoader: ids.find((id) => /^CheckpointLoader/.test(classOf(id))),
    outputs: ids.filter((id) => OUTPUT_CLASS.test(classOf(id))),
  }

  // Markers win over what was found.
  for (const id of ids) {
    const title = graph[id]?._meta?.title
    if (typeof title !== 'string') continue
    for (const marker of COMFY_MARKERS) {
      if (!title.includes(`latentry:${marker}`)) continue
      const own = inputsOf(id)
      const firstOf = (keys: string[], type: 'string' | 'number') => keys.find((key) => typeof own[key] === type)
      if (marker === 'prompt' || marker === 'negative') {
        const key = firstOf(TEXT_KEYS, 'string')
        if (key) roles[marker === 'prompt' ? 'positive' : 'negative'] = { node: id, input: key }
      } else if (marker === 'seed') {
        const key = firstOf(['seed', 'noise_seed', ...NUMBER_KEYS], 'number')
        if (key) roles.seed = { node: id, input: key }
      } else if (marker === 'steps' || marker === 'cfg') {
        if (typeof own[marker] === 'number') roles[marker] = { node: id, input: marker }
      } else if (marker === 'sampler') {
        if (typeof own.sampler_name === 'string') roles.samplerName = { node: id, input: 'sampler_name' }
        if (typeof own.scheduler === 'string') roles.scheduler = { node: id, input: 'scheduler' }
      } else if (marker === 'size') {
        if (typeof own.width === 'number') roles.width = { node: id, input: 'width' }
        if (typeof own.height === 'number') roles.height = { node: id, input: 'height' }
        if (typeof own.batch_size === 'number') roles.batch = { node: id, input: 'batch_size' }
      } else if (marker === 'output') {
        roles.outputs = [id, ...roles.outputs.filter((other) => other !== id)]
      }
    }
  }
  return roles
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
    // The text widget's place: first on the plain encoder, after six size
    // widgets (width, height, crop and target) as text_g on the SDXL one.
    const textAt = typeOf(node) === 'CLIPTextEncode' ? { input: 'text', index: 0 } : typeOf(node) === 'CLIPTextEncodeSDXL' ? { input: 'text_g', index: 6 } : null
    if (textAt) {
      // The text may come from another node (a primitive or a string node).
      const from = feeding(node, textAt.input)
      if (from) return str(widgets(from)[0]) ?? ''
      return str(widgets(node)[textAt.index]) ?? ''
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
    ...(recordHires(record.hires) ?? {}),
    model: str(record.model),
    backend: str(record.backend),
    kind: str(record.kind),
    profile: str(record.profile),
    mode: str(record.mode),
    created: str(record.created),
    loras: recordLoras(record),
    ...(str(record.prompt_template) ? { promptTemplate: record.prompt_template } : {}),
    ...(recordGrid(record.grid) ?? {}),
  }
}

/** A record's grid place, when it is well-formed. */
function recordGrid(value: unknown): { grid: GridUse } | null {
  const grid = value as Partial<GridUse> | null | undefined
  const axis = (part: unknown): part is { axis: string; value: string } =>
    typeof (part as { axis?: unknown })?.axis === 'string' && typeof (part as { value?: unknown })?.value === 'string'
  if (!grid || typeof grid.id !== 'string' || !/^[\w-]{1,64}$/.test(grid.id) || !axis(grid.x)) return null
  return {
    grid: {
      id: grid.id,
      x: { axis: grid.x.axis, value: grid.x.value },
      ...(axis(grid.y) ? { y: { axis: grid.y.axis, value: grid.y.value } } : {}),
    },
  }
}

/** A record's hires fix, when every field of it is well-formed. */
function recordHires(value: unknown): { hires: HiresUse } | null {
  const hires = value as Partial<HiresUse> | null | undefined
  const finite = (field: unknown): field is number => typeof field === 'number' && Number.isFinite(field)
  if (!hires || !finite(hires.scale) || !finite(hires.steps) || !finite(hires.denoise) || typeof hires.upscaler !== 'string') return null
  return { hires: { scale: hires.scale, steps: hires.steps, denoise: hires.denoise, upscaler: hires.upscaler } }
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
