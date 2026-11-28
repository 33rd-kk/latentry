// ComfyUI's partner nodes (its "API nodes"): nodes that hand their inputs to a
// paid service on the internet, through api.comfy.org. Latentry never queues a
// graph that has one, whatever the settings.
//
// Why always: such a node takes its comfy.org credentials from each queued
// prompt (`extra_data`), and Latentry sends none, so it can never succeed from
// here. It still sends its request, the prompt with it, before the service
// answers 401. So the only thing running one would do is send words off this
// computer, secret mode or not.
//
// How a node is known: ComfyUI's /object_info marks it `api_node: true`. Its
// category says so too, as a second sign: "partner/…" now, "api node/…" in
// earlier versions. A custom node that calls the internet on its own carries
// no such mark and cannot be told apart; the docs say so.
//
// Nothing here imports Next or the adapter: it is given a way to ask ComfyUI
// about one node class.

/** How long an answer about one node class is kept, per ComfyUI. */
export const CLOUD_CACHE_MS = 60 * 1000
/** A graph with more node classes than this is not checked, and not sent. */
export const MAX_NODE_CLASSES = 300
/** How many classes are asked about at once. */
const PARALLEL = 8

/** Asks ComfyUI's /object_info about one node class: the answer's body, or null when it does not answer. */
export type NodeLookup = (classType: string) => Promise<unknown | null>

/** Whether ComfyUI's /object_info answer for a class says it is a partner node. */
export function isCloudNode(body: unknown, classType: string): boolean {
  if (!body || typeof body !== 'object') return false
  const info = (body as Record<string, unknown>)[classType]
  if (!info || typeof info !== 'object') return false
  const { api_node: apiNode, category } = info as { api_node?: unknown; category?: unknown }
  return apiNode === true || (typeof category === 'string' && /^(api node|partner)(\/|$)/i.test(category.trim()))
}

/** The node classes a graph uses, each once, sorted. */
export function classTypes(graph: Record<string, unknown>): string[] {
  const types = new Set<string>()
  for (const node of Object.values(graph)) {
    const type = node && typeof node === 'object' ? (node as { class_type?: unknown }).class_type : undefined
    if (typeof type === 'string') types.add(type)
  }
  return [...types].sort()
}

export type CloudCheck =
  /** Every class was answered for; `cloud` lists the partner nodes (empty when there are none). */
  | { cloud: string[] }
  /** ComfyUI did not answer for these classes, or there were too many to ask about. */
  | { unchecked: string[] }

const globalForCloud = globalThis as typeof globalThis & { __comfyCloudNodes?: Map<string, { at: number; cloud: boolean }> }
const answers = (globalForCloud.__comfyCloudNodes ??= new Map())

/**
 * Which of a graph's node classes are partner nodes, asking ComfyUI about
 * each class it has not answered for within CLOUD_CACHE_MS. `scope` names the
 * ComfyUI (its backend id and address), so two servers never share answers.
 */
export async function cloudNodes(graph: Record<string, unknown>, lookup: NodeLookup, scope: string): Promise<CloudCheck> {
  const types = classTypes(graph)
  if (types.length > MAX_NODE_CLASSES) return { unchecked: types }
  const cloud: string[] = []
  const unchecked: string[] = []
  const now = Date.now()
  const ask = types.filter((type) => {
    const known = answers.get(`${scope}\0${type}`)
    if (!known || now - known.at >= CLOUD_CACHE_MS) return true
    if (known.cloud) cloud.push(type)
    return false
  })
  for (let start = 0; start < ask.length; start += PARALLEL) {
    const batch = ask.slice(start, start + PARALLEL)
    const bodies = await Promise.all(batch.map((type) => lookup(type).catch(() => null)))
    batch.forEach((type, index) => {
      const body = bodies[index]
      // No answer is not "no": the graph is not sent until ComfyUI says.
      if (body === null || typeof body !== 'object') {
        unchecked.push(type)
        return
      }
      const isCloud = isCloudNode(body, type)
      answers.set(`${scope}\0${type}`, { at: Date.now(), cloud: isCloud })
      if (isCloud) cloud.push(type)
    })
  }
  return unchecked.length ? { unchecked: unchecked.sort() } : { cloud: cloud.sort() }
}

/** Why a graph was not sent, for the page; null when it may be. */
export function cloudRefusal(check: CloudCheck): { status: 400 | 502; error: string } | null {
  if ('unchecked' in check) {
    if (check.unchecked.length > MAX_NODE_CLASSES) {
      return { status: 400, error: `This graph uses more than ${MAX_NODE_CLASSES} kinds of node, too many to check, so it was not sent` }
    }
    return { status: 502, error: `ComfyUI did not say what these nodes are, so the graph was not sent: ${check.unchecked.join(', ')}` }
  }
  if (!check.cloud.length) return null
  return {
    status: 400,
    error: `This uses ComfyUI's partner nodes, which send the prompt to an online service, so Latentry does not run it: ${check.cloud.join(', ')}`,
  }
}

/** Forgets every answer (for tests). */
export function forgetCloudNodes(): void {
  answers.clear()
}
