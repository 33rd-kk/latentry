// A stand-in for a ComfyUI server, for tests that run a whole generation
// without a GPU: the HTTP calls lib/backends/comfyui.ts makes, answered with a
// small real PNG that carries ComfyUI-style `prompt` and `workflow` chunks
// (naming a model in a folder, as ComfyUI's do). It has no WebSocket: the
// upgrade is refused, so the adapter's /history polling is what runs.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import sharp from 'sharp'
import { writePngText } from '../../lib/image-meta'

export interface MockComfyUI {
  /** Base URL, with a trailing slash, as a backend's `url` setting. */
  url: string
  /** Every graph queued with POST /prompt, in order. */
  graphs: Record<string, { class_type: string; inputs: Record<string, unknown> }>[]
  /** The model path its pictures' graph chunks name. */
  modelPath: string
  close(): Promise<void>
}

const MODEL_PATH = 'private-folder/sdxl/base.safetensors'

/** Listens on 127.0.0.1 only; port 0 (the default) picks a free one. */
export async function startMockComfyUI(options: { port?: number } = {}): Promise<MockComfyUI> {
  // Without this sharp keeps what it read open on Windows, and a test cannot delete its folder.
  sharp.cache(false)
  const pixels = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#7a6b93' } }).png().toBuffer()
  const graphs: MockComfyUI['graphs'] = []
  const finished = new Set<string>()

  const server: Server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => {
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(body))
      }
      const url = new URL(request.url ?? '/', 'http://mock')
      const route = `${request.method} ${url.pathname}`
      const combo = (node: string, input: string, names: string[]) => ({ [node]: { input: { required: { [input]: [names] } } } })
      if (route === 'GET /system_stats') return reply(200, { system: { comfyui_version: 'mock' }, devices: [] })
      if (route === 'GET /queue') return reply(200, { queue_running: [], queue_pending: [] })
      if (route === 'GET /object_info/CheckpointLoaderSimple') return reply(200, combo('CheckpointLoaderSimple', 'ckpt_name', [MODEL_PATH]))
      if (route === 'GET /object_info/KSampler') {
        return reply(200, { KSampler: { input: { required: { sampler_name: [['euler', 'dpmpp_2m']], scheduler: [['normal', 'karras']] } } } })
      }
      if (route === 'GET /object_info/LoraLoader') return reply(200, combo('LoraLoader', 'lora_name', ['styles/ink.safetensors']))
      if (route === 'POST /prompt') {
        let body: { prompt?: MockComfyUI['graphs'][number] }
        try {
          body = JSON.parse(text)
        } catch {
          return reply(400, { error: { message: 'Invalid JSON' } })
        }
        if (!body.prompt) return reply(400, { error: { message: 'No prompt' } })
        graphs.push(body.prompt)
        const id = `mock-${graphs.length}`
        finished.add(id)
        return reply(200, { prompt_id: id, number: graphs.length, node_errors: {} })
      }
      const history = /^GET \/history\/(.+)$/.exec(route)
      if (history) {
        const id = decodeURIComponent(history[1])
        if (!finished.has(id)) return reply(200, {})
        return reply(200, {
          [id]: {
            outputs: { '7': { images: [{ filename: `${id}.png`, subfolder: '', type: 'temp' }] } },
            status: { status_str: 'success', completed: true, messages: [] },
          },
        })
      }
      if (route === 'GET /view') {
        const graph = graphs[Number(/mock-(\d+)\.png$/.exec(url.searchParams.get('filename') ?? '')?.[1]) - 1]
        if (!graph || url.searchParams.get('type') !== 'temp') return reply(404, { error: 'Not found' })
        const png = writePngText(pixels, {
          prompt: JSON.stringify({ ...graph, '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: MODEL_PATH } } }),
          workflow: JSON.stringify({ nodes: [{ id: 1, type: 'CheckpointLoaderSimple', widgets_values: [MODEL_PATH] }], links: [] }),
        })
        response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
        return response.end(png)
      }
      if (route === 'POST /interrupt' || route === 'POST /queue') return reply(200, {})
      return reply(404, { error: 'Not found' })
    })
  })
  // No WebSocket here: an upgrade is turned away.
  server.on('upgrade', (_request, socket) => socket.destroy())
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/`,
    graphs,
    modelPath: MODEL_PATH,
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
