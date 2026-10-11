// Your own ComfyUI workflows: API-format JSON files in a folder set for a
// comfyui backend, picked on the Generate page by file name and filled in
// here with the form's values. The browser only ever names a file; the
// graph is read and filled on this server.

import { open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { comfyGraphRoles, type ComfyRoles, type ComfySlot, type LoraUse } from '@/lib/image-meta'
import { WORKFLOW_NAME, type GenerateRequest } from './types'

export { WORKFLOW_NAME }

/** At most this many workflows are listed from one folder. */
export const MAX_WORKFLOWS = 200
/** A workflow file larger than this is not read. */
export const MAX_WORKFLOW_BYTES = 1024 * 1024

type GraphNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: unknown } }
export type ComfyGraph = Record<string, GraphNode>

/** What the Generate page is told about a workflow: what it could not find, or why it cannot run. */
export interface WorkflowInfo {
  name: string
  missing: ('negative' | 'seed' | 'size' | 'steps' | 'cfg' | 'sampler')[]
  problem?: string
}

/** A workflow's JSON as a graph to run, or why it is not one. */
export function asApiGraph(json: unknown): { graph: ComfyGraph } | { error: string } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { error: 'Not a ComfyUI workflow' }
  if (Array.isArray((json as { nodes?: unknown }).nodes)) {
    return { error: 'This is the editor format. In ComfyUI, save it with Export (API).' }
  }
  const nodes = Object.values(json as Record<string, unknown>)
  if (!nodes.length || !nodes.every((node) => node && typeof node === 'object' && typeof (node as GraphNode).class_type === 'string')) {
    return { error: 'Not a ComfyUI workflow in API format' }
  }
  return { graph: json as ComfyGraph }
}

/** What a workflow lacks for Latentry to fill it, or why it cannot run at all. */
export function describe(name: string, graph: ComfyGraph): WorkflowInfo {
  const roles = comfyGraphRoles(graph)
  const missing: WorkflowInfo['missing'] = []
  if (!roles.negative) missing.push('negative')
  if (!roles.seed) missing.push('seed')
  if (!roles.width || !roles.height) missing.push('size')
  if (!roles.steps) missing.push('steps')
  if (!roles.cfg) missing.push('cfg')
  if (!roles.samplerName) missing.push('sampler')
  const problem = !roles.positive ? 'No prompt found (mark its node latentry:prompt)' : !roles.outputs.length ? 'No SaveImage or PreviewImage node' : undefined
  return { name, missing, ...(problem ? { problem } : {}) }
}

/** The folder's real path, and a file's inside it, or null when the name or the file would leave it. */
async function insideFolder(dir: string, name: string): Promise<string | null> {
  if (!WORKFLOW_NAME.test(name)) return null
  try {
    const root = await realpath(dir)
    const file = await realpath(path.join(root, `${name}.json`))
    return path.dirname(file) === root ? file : null
  } catch {
    return null
  }
}

/** A file read whole, if it is a file of at most `max` bytes. */
async function readCapped(file: string, max: number): Promise<string | null> {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > max) return null
    return (await handle.readFile()).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** The workflows in a folder, by name, with what each lacks. Read-only; no subfolders. */
export async function listWorkflows(dir: string): Promise<WorkflowInfo[]> {
  let entries: string[]
  try {
    entries = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.json$/i.test(entry.name)).map((entry) => entry.name)
  } catch {
    return []
  }
  const names = entries
    .map((file) => file.slice(0, -'.json'.length))
    .filter((name) => WORKFLOW_NAME.test(name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_WORKFLOWS)
  const infos: WorkflowInfo[] = []
  for (const name of names) {
    const read = await readWorkflow(dir, name)
    infos.push('error' in read ? { name, missing: [], problem: read.error } : describe(name, read.graph))
  }
  return infos
}

/** One workflow's graph, by name, from inside the folder only. */
export async function readWorkflow(dir: string, name: string): Promise<{ graph: ComfyGraph } | { error: string }> {
  const file = await insideFolder(dir, name)
  if (!file) return { error: 'No such workflow' }
  let text: string | null
  try {
    text = await readCapped(file, MAX_WORKFLOW_BYTES)
  } catch {
    return { error: 'Could not read the workflow' }
  }
  if (text === null) return { error: `A workflow is at most ${MAX_WORKFLOW_BYTES / 1024 / 1024} MB` }
  try {
    return asApiGraph(JSON.parse(text))
  } catch {
    return { error: 'The workflow is not valid JSON' }
  }
}

/**
 * A copy of the workflow with the form's values put in, ready to queue:
 * - the prompt (without its LoRA calls) and negative, the seed, size (batch
 *   of one), steps and cfg where they were found; sampler and scheduler when
 *   not "Default"; `checkpoint`, if given, into the checkpoint loader
 * - one LoraLoader per call, after the checkpoint loader, with everything
 *   that used the loader's model and clip moved onto the last LoRA
 * - SaveImage swapped for PreviewImage, so nothing lands in ComfyUI's output
 *   folder; the picture is read from the first output
 */
export function fillWorkflow(
  graph: ComfyGraph,
  request: GenerateRequest,
  options: {
    seed: number
    prompt: string
    sizeMultiple: number
    checkpoint?: string
    loras: { file: string; use: LoraUse }[]
  }
): { graph: ComfyGraph; output: string } | { error: string } {
  const filled = structuredClone(graph)
  const roles: ComfyRoles = comfyGraphRoles(filled)
  if (!roles.positive) return { error: 'The workflow has no prompt Latentry can find (mark its node latentry:prompt)' }
  const output = roles.outputs[0]
  if (!output) return { error: 'The workflow has no SaveImage or PreviewImage node' }

  const set = (slot: ComfySlot | undefined, value: unknown) => {
    if (slot) filled[slot.node].inputs[slot.input] = value
  }
  const snap = (value: number) => Math.max(options.sizeMultiple, Math.round(value / options.sizeMultiple) * options.sizeMultiple)
  set(roles.positive, options.prompt)
  // The SDXL encoder reads two texts; both get the prompt.
  const positiveNode = filled[roles.positive.node]
  if (roles.positive.input === 'text_g' && typeof positiveNode.inputs.text_l === 'string') positiveNode.inputs.text_l = options.prompt
  set(roles.negative, request.negative_prompt)
  if (roles.negative?.input === 'text_g' && typeof filled[roles.negative.node].inputs.text_l === 'string') filled[roles.negative.node].inputs.text_l = request.negative_prompt
  set(roles.seed, options.seed)
  set(roles.width, snap(request.width))
  set(roles.height, snap(request.height))
  set(roles.batch, 1)
  set(roles.steps, request.num_inference_steps)
  set(roles.cfg, request.guidance_scale)
  if (request.sampler && request.sampler !== 'Default') set(roles.samplerName, request.sampler)
  if (request.scheduler && request.scheduler !== 'Default') set(roles.scheduler, request.scheduler)
  // A checkpoint goes only where a checkpoint is loaded: a UNET (diffusion model) loader keeps its own file.
  if (options.checkpoint && roles.model?.input === 'ckpt_name') set(roles.model, options.checkpoint)

  if (options.loras.length) {
    const loader = roles.checkpointLoader
    if (!loader) return { error: `LoRAs need a checkpoint loader in the workflow: ${options.loras.map(({ use }) => use.name).join(', ')}` }
    let model: [string, number] = [loader, 0]
    let clip: [string, number] = [loader, 1]
    const added = new Set<string>()
    options.loras.forEach(({ file, use }, index) => {
      const id = `latentry-lora-${index + 1}`
      filled[id] = {
        class_type: 'LoraLoader',
        inputs: { model, clip, lora_name: file, strength_model: use.weight, strength_clip: use.weight },
      }
      added.add(id)
      model = [id, 0]
      clip = [id, 1]
    })
    // Everything that read the loader's MODEL or CLIP reads the last LoRA's.
    for (const [id, node] of Object.entries(filled)) {
      if (added.has(id)) continue
      for (const [key, value] of Object.entries(node.inputs ?? {})) {
        if (Array.isArray(value) && String(value[0]) === loader && (value[1] === 0 || value[1] === 1)) {
          node.inputs[key] = value[1] === 0 ? model : clip
        }
      }
    }
  }

  for (const id of roles.outputs) {
    const node = filled[id]
    if (node.class_type === 'SaveImage') filled[id] = { class_type: 'PreviewImage', inputs: { images: node.inputs.images } }
  }
  return { graph: filled, output }
}
