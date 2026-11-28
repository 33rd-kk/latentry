/**
 * ComfyUI's partner nodes (lib/backends/comfy-cloud-nodes.ts): how one is
 * told from /object_info, the answers kept per ComfyUI, a graph not sent when
 * ComfyUI does not answer, and that the adapter queues every graph through
 * the one place that asks (ComfyUIAdapter.queue).
 *
 * Run with: npm test -- comfy-cloud-nodes
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { check, done, eq } from './assert'
import { classTypes, cloudNodes, cloudRefusal, forgetCloudNodes, isCloudNode, MAX_NODE_CLASSES } from '../lib/backends/comfy-cloud-nodes'

const info = (type: string, fields: Record<string, unknown>) => ({ [type]: { input: { required: {} }, ...fields } })

/** Every .ts file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name)
    return statSync(file).isDirectory() ? sources(file) : /\.tsx?$/.test(name) ? [file] : []
  })
}

async function main() {
  // ── Telling one ──
  check(isCloudNode(info('GeminiImageNode', { api_node: true, category: 'partner/image/Gemini' }), 'GeminiImageNode'), 'api_node: true is a partner node')
  check(isCloudNode(info('Unflagged', { category: 'partner/video/Kling' }), 'Unflagged'), 'so is one filed under "partner/", even without the flag')
  check(isCloudNode(info('OldNode', { category: 'api node/video/Kling' }), 'OldNode'), 'or under "api node/", as earlier ComfyUI versions file them')
  check(!isCloudNode(info('Partnered', { category: 'partnership/x' }), 'Partnered'), 'but not one whose category only starts with the same letters')
  check(isCloudNode(info('Top', { category: 'API Node' }), 'Top'), 'the category itself, in any case')
  check(!isCloudNode(info('KSampler', { category: 'sampling', api_node: false }), 'KSampler'), 'a core node is not')
  check(!isCloudNode(info('Mine', { category: 'api nodes are fun/custom' }), 'Mine'), 'nor one whose category only starts with the same letters')
  check(!isCloudNode({}, 'Missing'), 'nor a class ComfyUI does not have (it refuses that itself)')
  check(!isCloudNode(null, 'X') && !isCloudNode(info('Y', {}), 'X'), 'nor an answer about another class')

  eq(
    classTypes({ '1': { class_type: 'KSampler', inputs: {} }, '2': { class_type: 'CLIPTextEncode', inputs: {} }, '3': { class_type: 'CLIPTextEncode', inputs: {} }, '4': { inputs: {} } }),
    ['CLIPTextEncode', 'KSampler'],
    'each class once, sorted; a node without one is skipped'
  )

  // ── Asking ComfyUI ──
  forgetCloudNodes()
  const asked: string[] = []
  const comfy = (cloud: string[]) => async (type: string) => {
    asked.push(type)
    return info(type, cloud.includes(type) ? { api_node: true } : { category: 'sampling' })
  }
  const graph = { '1': { class_type: 'KSampler', inputs: {} }, '2': { class_type: 'GeminiImageNode', inputs: {} } }
  eq(await cloudNodes(graph, comfy(['GeminiImageNode']), 'a'), { cloud: ['GeminiImageNode'] }, 'the partner nodes of a graph are named')
  eq(asked, ['GeminiImageNode', 'KSampler'], 'each class is asked about')
  asked.length = 0
  eq(await cloudNodes(graph, comfy([]), 'a'), { cloud: ['GeminiImageNode'] }, 'an answer is kept for a while')
  eq(asked, [], 'so the same ComfyUI is not asked again')
  eq(await cloudNodes(graph, comfy([]), 'b'), { cloud: [] }, 'another ComfyUI is asked on its own')
  eq(cloudRefusal({ cloud: [] }), null, 'a graph with none may be sent')
  const refused = cloudRefusal({ cloud: ['GeminiImageNode'] })
  eq(refused?.status, 400, 'one with a partner node is refused')
  check(refused?.error.includes('GeminiImageNode') === true && refused.error.includes('online service'), 'saying which node, and why')

  forgetCloudNodes()
  eq(await cloudNodes(graph, async () => null, 'a'), { unchecked: ['GeminiImageNode', 'KSampler'] }, 'no answer is not "no"')
  eq(await cloudNodes(graph, async () => { throw new Error('down') }, 'a'), { unchecked: ['GeminiImageNode', 'KSampler'] }, 'nor is a failed request')
  const unanswered = cloudRefusal({ unchecked: ['KSampler'] })
  check(unanswered?.status === 502 && unanswered.error.includes('not sent'), 'and the graph is not sent')
  asked.length = 0
  eq(await cloudNodes(graph, comfy([]), 'a'), { cloud: [] }, 'failures are not kept: ComfyUI is asked again')
  eq(asked.length, 2, 'about both')

  const wide = Object.fromEntries(Array.from({ length: MAX_NODE_CLASSES + 1 }, (_, n) => [String(n), { class_type: `Node${n}`, inputs: {} }]))
  asked.length = 0
  const tooMany = await cloudNodes(wide, comfy([]), 'c')
  check('unchecked' in tooMany && asked.length === 0, `more than ${MAX_NODE_CLASSES} classes are not asked about`)
  eq(cloudRefusal(tooMany)?.status, 400, 'and not sent')

  // ── One place queues ──
  const lib = path.join(process.cwd(), 'lib')
  const posting = sources(lib).flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    return text.includes("'/prompt'") ? [{ file: path.relative(lib, file), text }] : []
  })
  eq(posting.map(({ file }) => file.replaceAll('\\', '/')), ['backends/comfyui.ts'], 'only the ComfyUI adapter names /prompt')
  const adapter = posting[0]?.text ?? ''
  eq(adapter.split("'/prompt'").length - 1, 1, 'once')
  const start = adapter.indexOf('private async queue(')
  const at = adapter.indexOf("'/prompt'")
  const next = adapter.indexOf('\n  }\n', start)
  check(start > 0 && at > start && at < next, 'inside queue(), which asks about partner nodes first')
  check(adapter.slice(start, at).includes('cloudRefusal(await this.cloudCheck(graph))'), 'and refuses before the post')

  done('comfy-cloud-nodes')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
