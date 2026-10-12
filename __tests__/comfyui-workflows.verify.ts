/**
 * Your own ComfyUI workflows (lib/backends/comfy-workflows.ts): which node
 * gets which value (comfyGraphRoles, and node-title markers), filling a
 * workflow, reading a folder without leaving it, who may see and run them,
 * the settings that point at the folder, and a run through the routes
 * against fixtures/mock-comfyui.ts.
 *
 * Run with: npm test -- comfyui-workflows
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, done, eq } from './assert'
import { startMockComfyUI } from './fixtures/mock-comfyui'
import { asApiGraph, describe, fillWorkflow, listWorkflows, MAX_WORKFLOWS, poseSlots, readWorkflow, WORKFLOW_NAME, type ComfyGraph } from '../lib/backends/comfy-workflows'
import { workflowAccess } from '../lib/backends/workflow-access'
import { comfyGraphRoles, readPngText } from '../lib/image-meta'
import { validateSettings } from '../lib/settings/schema'
import type { BackendConfig, GenerateRequest } from '../lib/backends/types'

const REQUEST: GenerateRequest = {
  prompt: 'a lighthouse, <lora:ink:0.7>',
  negative_prompt: 'blurry',
  width: 830,
  height: 1216,
  seed: 5,
  image_count: 1,
  sampler: 'Default',
  scheduler: 'karras',
  num_inference_steps: 20,
  guidance_scale: 6,
}

/** A workflow as ComfyUI's Export (API) writes it, with a seed node and SaveImage. */
const TXT2IMG: ComfyGraph = {
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl/base.safetensors' } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['4', 1] } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 4 } },
  '10': { class_type: 'Seed (rgthree)', inputs: { seed: 1 } },
  '3': {
    class_type: 'KSampler',
    inputs: { seed: ['10', 0], steps: 30, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
}

async function main() {
  // ── Roles ──
  const roles = comfyGraphRoles(TXT2IMG)
  eq(
    [roles.sampler, roles.positive, roles.negative, roles.seed, roles.width, roles.batch, roles.model, roles.checkpointLoader, roles.outputs],
    ['3', { node: '6', input: 'text' }, { node: '7', input: 'text' }, { node: '10', input: 'seed' }, { node: '5', input: 'width' }, { node: '5', input: 'batch_size' }, { node: '4', input: 'ckpt_name' }, '4', ['9']],
    'roles: the sampler, both prompts, the seed on its own node, the latent, the model, the output'
  )
  const marked: ComfyGraph = {
    ...TXT2IMG,
    '20': { class_type: 'PrimitiveString', inputs: { value: 'mine' }, _meta: { title: 'Style latentry:prompt' } },
    '21': { class_type: 'PreviewImage', inputs: { images: ['8', 0] }, _meta: { title: 'latentry:output' } },
  }
  const markedRoles = comfyGraphRoles(marked)
  eq([markedRoles.positive, markedRoles.outputs[0]], [{ node: '20', input: 'value' }, '21'], 'a latentry: marker in a node title wins over what was found')

  // ── The file format ──
  check('error' in asApiGraph({ nodes: [], links: [] }) && /Export \(API\)/.test((asApiGraph({ nodes: [] }) as { error: string }).error), "the editor's format is refused, saying how to export it")
  check('error' in asApiGraph([1, 2]) && 'error' in asApiGraph({ a: { inputs: {} } }), 'something that is not a graph is refused')
  eq(describe('t', TXT2IMG), { name: 't', missing: [] }, 'a full workflow lacks nothing')
  const bare: ComfyGraph = { '1': { class_type: 'CLIPTextEncode', inputs: { text: 'x' } }, '2': { class_type: 'SaveImage', inputs: {} } }
  eq(describe('b', bare).problem?.startsWith('No prompt'), true, 'a workflow without a sampler-linked prompt cannot run')

  // ── Filling ──
  const loras = [{ file: 'styles/ink.safetensors', use: { name: 'ink', weight: 0.7 } }]
  const filled = fillWorkflow(TXT2IMG, REQUEST, { seed: 42, prompt: 'a lighthouse', sizeMultiple: 8, checkpoint: 'other.safetensors', loras })
  if ('error' in filled) throw new Error(filled.error)
  const g = filled.graph
  eq([g['6'].inputs.text, g['7'].inputs.text, g['10'].inputs.seed], ['a lighthouse', 'blurry', 42], 'the prompt, negative and seed go where they were found')
  eq([g['5'].inputs.width, g['5'].inputs.height, g['5'].inputs.batch_size], [832, 1216, 1], 'the size snapped to the multiple, one picture per prompt')
  eq([g['3'].inputs.steps, g['3'].inputs.cfg, g['3'].inputs.sampler_name, g['3'].inputs.scheduler], [20, 6, 'euler', 'karras'], 'steps and cfg; "Default" sampler leaves the workflow\'s, the scheduler asked for is set')
  eq(g['4'].inputs.ckpt_name, 'other.safetensors', 'the model set for the backend replaces the workflow\'s')
  eq(g['latentry-lora-1']?.inputs, { model: ['4', 0], clip: ['4', 1], lora_name: 'styles/ink.safetensors', strength_model: 0.7, strength_clip: 0.7 }, 'a LoRA loader after the checkpoint')
  eq([g['3'].inputs.model, g['6'].inputs.clip, g['7'].inputs.clip, g['8'].inputs.vae], [['latentry-lora-1', 0], ['latentry-lora-1', 1], ['latentry-lora-1', 1], ['4', 2]], 'what used its model and clip now uses the LoRA\'s; the VAE stays')
  eq([g['9'].class_type, g['9'].inputs, filled.output], ['PreviewImage', { images: ['8', 0] }, '9'], 'SaveImage becomes PreviewImage, so nothing lands in ComfyUI\'s output folder')
  eq([TXT2IMG['6'].inputs.text, TXT2IMG['9'].class_type], ['old prompt', 'SaveImage'], 'the workflow itself is left as it was')
  const unet: ComfyGraph = { ...TXT2IMG, '4': { class_type: 'UNETLoader', inputs: { unet_name: 'flux.safetensors' } } }
  const unetFilled = fillWorkflow(unet, REQUEST, { seed: 1, prompt: 'x', sizeMultiple: 8, checkpoint: 'other.safetensors', loras: [] })
  eq('error' in unetFilled ? null : unetFilled.graph['4'].inputs.unet_name, 'flux.safetensors', 'a UNET loader keeps its own file: the backend\'s checkpoint is not put there')
  const noLoader = fillWorkflow(unet, REQUEST, { seed: 1, prompt: 'x', sizeMultiple: 8, loras })
  check('error' in noLoader && noLoader.error.includes('ink'), 'a LoRA without a checkpoint loader to hang it on is refused, by name')
  const sdxl: ComfyGraph = { ...TXT2IMG, '6': { class_type: 'CLIPTextEncodeSDXL', inputs: { text_g: 'g', text_l: 'l', clip: ['4', 1], width: 1024, height: 1024 } } }
  const sdxlFilled = fillWorkflow(sdxl, REQUEST, { seed: 1, prompt: 'both', sizeMultiple: 8, loras: [] })
  check(!('error' in sdxlFilled) && sdxlFilled.graph['6'].inputs.text_g === 'both' && sdxlFilled.graph['6'].inputs.text_l === 'both', "the SDXL encoder gets the prompt in both its texts")

  // ── Pose: a LoadImage marked latentry:pose ──
  const posed: ComfyGraph = {
    ...TXT2IMG,
    '30': { class_type: 'LoadImage', inputs: { image: 'example.png' }, _meta: { title: 'Skeleton latentry:pose' } },
    '31': { class_type: 'SomePoseApply', inputs: { strength: 1, image: ['30', 0] }, _meta: { title: 'latentry:pose_strength' } },
  }
  eq(poseSlots(posed), { image: '30', style: 'dwpose', strength: '31' }, 'pose: the marked LoadImage, drawn dwpose by default, and the strength node')
  eq(poseSlots({ ...posed, '30': { ...posed['30'], _meta: { title: 'latentry:pose OpenPose' } } })?.style, 'openpose', '"openpose" in its title asks for OpenPose drawing')
  eq(poseSlots(TXT2IMG), null, 'no marker, no pose')
  eq(
    poseSlots({ '1': { class_type: 'LoadImage', inputs: { image: 'x' }, _meta: { title: 'latentry:pose_strength' } } }),
    null,
    'latentry:pose_strength is not latentry:pose'
  )
  eq(poseSlots({ '1': { class_type: 'CLIPTextEncode', inputs: { text: 'x' }, _meta: { title: 'latentry:pose' } } }), null, 'only a LoadImage takes the skeleton')
  eq([describe('p', posed).pose, describe('t', TXT2IMG).pose], [true, undefined], 'the list says which workflows can follow a skeleton')
  const poseFilled = fillWorkflow(posed, REQUEST, { seed: 1, prompt: 'x', sizeMultiple: 8, loras: [], pose: { image: 'latentry/comfy-pose.png', strength: 0.6 } })
  eq(
    'error' in poseFilled ? poseFilled.error : [poseFilled.graph['30'].inputs.image, poseFilled.graph['31'].inputs.strength],
    ['latentry/comfy-pose.png', 0.6],
    'a pose run puts the uploaded skeleton in it, and the pose strength in the strength node'
  )
  eq(posed['30'].inputs.image, 'example.png', 'the workflow itself is left as it was')
  const noPose = fillWorkflow(TXT2IMG, REQUEST, { seed: 1, prompt: 'x', sizeMultiple: 8, loras: [], pose: { image: 'p.png', strength: 1 } })
  eq('error' in noPose ? noPose.error : null, 'This workflow cannot follow a skeleton: mark its pose LoadImage latentry:pose', 'a pose run on a workflow without the marker is refused')
  const promptOnly = fillWorkflow(posed, REQUEST, { seed: 1, prompt: 'x', sizeMultiple: 8, loras: [] })
  eq('error' in promptOnly ? null : promptOnly.graph['30'].inputs.image, 'example.png', 'without a pose, a marked workflow runs with its own picture there')

  // ── Reading a folder, and only that folder ──
  const scratch = mkdtempSync(path.join(tmpdir(), 'latentry-workflows-'))
  const dir = path.join(scratch, 'workflows')
  mkdirSync(path.join(dir, 'sub'), { recursive: true })
  writeFileSync(path.join(dir, 'portrait.json'), JSON.stringify(TXT2IMG))
  writeFileSync(path.join(dir, 'editor.json'), JSON.stringify({ nodes: [], links: [] }))
  writeFileSync(path.join(dir, 'broken.json'), '{ not json')
  writeFileSync(path.join(dir, 'huge.json'), 'x'.repeat(1024 * 1024 + 1))
  writeFileSync(path.join(dir, 'notes.txt'), 'not a workflow')
  writeFileSync(path.join(dir, 'sub', 'nested.json'), JSON.stringify(TXT2IMG))
  writeFileSync(path.join(scratch, 'outside.json'), JSON.stringify(TXT2IMG))
  try {
    const listed = await listWorkflows(dir)
    eq(listed.map(({ name }) => name), ['broken', 'editor', 'huge', 'portrait'], 'the JSON files directly in the folder, by name: no subfolders, nothing else')
    eq(listed.find(({ name }) => name === 'portrait'), { name: 'portrait', missing: [] }, 'a good one, lacking nothing')
    check(listed.every(({ name, problem }) => name === 'portrait' || Boolean(problem)), 'the others say why they cannot run')
    check(!('error' in (await readWorkflow(dir, 'portrait'))), 'a workflow is read by name')
    for (const name of ['../outside', '..', 'sub/nested', 'sub\\nested', 'C:/x', '', 'a'.repeat(129)]) {
      check('error' in (await readWorkflow(dir, name)), `"${name.slice(0, 20)}" is not read: names stay inside the folder`)
      check(!WORKFLOW_NAME.test(name), `and is not a workflow name the page may send ("${name.slice(0, 20)}")`)
    }
    eq(await listWorkflows(path.join(scratch, 'missing')), [], 'a folder that is not there lists nothing')
    const many = path.join(scratch, 'many')
    mkdirSync(many)
    for (let n = 0; n < MAX_WORKFLOWS + 5; n += 1) writeFileSync(path.join(many, `w${String(n).padStart(3, '0')}.json`), '{}')
    eq((await listWorkflows(many)).length, MAX_WORKFLOWS, `at most ${MAX_WORKFLOWS} are listed`)

    // ── Who may see and run them ──
    const config: BackendConfig = { id: 'comfy', kind: 'comfyui', url: 'http://c/', profile: 'sdxl', workflowsDir: dir }
    const local = new Headers({ host: 'localhost:3000' })
    const phone = new Headers({ host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' })
    eq(
      [workflowAccess(local, config, {}), workflowAccess(phone, config, {}), workflowAccess(phone, { ...config, shareWorkflows: true }, {})],
      ['edit', null, 'shared'],
      'this machine always; a paired device only with sharing on'
    )
    eq(workflowAccess(local, { ...config, workflowsDir: undefined }, {}), null, 'no folder, no workflows')
    eq(workflowAccess(local, { ...config, kind: 'a1111' }, {}), null, 'only for ComfyUI')

    // ── The settings that point at the folder ──
    const backend = (fields: Record<string, unknown>) => {
      const checked = validateSettings({ backends: [{ id: 'c', kind: 'comfyui', url: 'http://c:1', profile: 'sdxl', ...fields }] }, { version: 1 }, {})
      return checked.ok ? checked.settings.backends?.[0] : checked.errors
    }
    eq(backend({ workflowsDir: dir, shareWorkflows: true }), { id: 'c', kind: 'comfyui', url: 'http://c:1/', profile: 'sdxl', workflowsDir: dir, shareWorkflows: true }, 'a comfyui backend keeps its folder and the switch')
    eq(backend({ workflowsDir: 'relative/dir' }), { 'backends.0.workflowsDir': 'settings.errorAbsolute' }, 'the folder must be absolute')
    eq(backend({ workflowsDir: '\\\\server\\share' }), { 'backends.0.workflowsDir': 'settings.errorNetworkPath' }, 'and not a network share')
    eq(backend({ shareWorkflows: true }), { id: 'c', kind: 'comfyui', url: 'http://c:1/', profile: 'sdxl' }, 'sharing means nothing without a folder')
    const a1111 = validateSettings({ backends: [{ id: 'w', kind: 'a1111', url: 'http://w:1', profile: 'sdxl', workflowsDir: dir }] }, { version: 1 }, {})
    eq(a1111.ok ? a1111.settings.backends?.[0].workflowsDir : 'error', undefined, 'other kinds keep no folder')

    await throughRoutes(scratch, dir)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  done('comfyui-workflows')
}

/** The list and a run with a workflow, through the API routes, against the mock ComfyUI. */
async function throughRoutes(scratch: string, dir: string): Promise<void> {
  const saveDir = path.join(scratch, 'out')
  const mock = await startMockComfyUI()
  writeFileSync(
    path.join(scratch, 'settings.json'),
    JSON.stringify({ version: 1, backends: [{ id: 'comfy', kind: 'comfyui', url: mock.url, profile: 'sdxl', workflowsDir: dir }], gallery: { saveDir, dirs: [] }, engine: { autoStart: false } })
  )
  Object.assign(process.env, { LATENTRY_SETTINGS_FILE: path.join(scratch, 'settings.json'), LATENTRY_RUNTIME_DIR: path.join(scratch, 'runtime'), LATENTRY_ENGINE: 'off' })
  for (const name of ['GEN_BACKENDS', 'DIFFUSION_SERVER_URL', 'GALLERY_SAVE_DIR', 'GALLERY_DIRS', 'GALLERY_AUTO_TAG', 'SETTINGS_EDIT']) delete process.env[name]
  const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) }) as never
  const { GET: workflowsRoute } = await import('../app/api/gen/[backend]/workflows/route')
  const { POST: generateRoute } = await import('../app/api/gen/[backend]/generate/route')
  const { getJob } = await import('../lib/diffusion/job-store')
  const local = { host: 'localhost:3000' }
  const phone = { host: '192.168.1.20:3000', 'x-forwarded-for': '192.168.1.30' }

  try {
    const list = async (headers: Record<string, string>) =>
      ((await (await workflowsRoute(new Request('http://localhost:3000/api/gen/comfy/workflows', { headers }), params({ backend: 'comfy' }))).json()) as {
        workflows: { name: string }[]
      }).workflows
    eq((await list(local)).map(({ name }) => name), ['broken', 'editor', 'huge', 'portrait'], 'this machine sees the workflows')
    eq(await list(phone), [], 'a paired device does not, with sharing off')
    check(!JSON.stringify(await list(local)).includes(scratch), 'the list never says where the folder is')

    const generate = (body: Record<string, unknown>, headers: Record<string, string>) =>
      generateRoute(
        new Request('http://localhost:3000/api/gen/comfy/generate', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
        params({ backend: 'comfy' })
      )
    eq((await generate({ prompt: 'x', workflow: 'portrait' }, phone)).status, 403, 'nor may it run one')
    const { POST: poseRoute } = await import('../app/api/gen/[backend]/pose/route')
    const askPose = (headers: Record<string, string>) =>
      poseRoute(
        new Request('http://localhost:3000/api/gen/comfy/pose', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ image_base64: 'abc', workflow: 'portrait' }),
        }),
        params({ backend: 'comfy' })
      )
    eq((await askPose(phone)).status, 403, 'nor have a skeleton drawn for one')
    eq((await askPose(local)).status, 400, 'this machine may: a workflow without latentry:pose is refused, before anything is drawn')
    eq((await generate({ prompt: 'x', workflow: 'editor' }, local)).status, 400, 'a workflow that cannot run is refused before anything is queued')
    eq(mock.graphs.length, 0, 'and nothing was queued')

    const started = await generate({ prompt: 'a harbour at dawn, <lora:ink:0.5>', negative_prompt: 'fog', width: 640, height: 960, seed: 7, workflow: 'portrait' }, local)
    eq(started.status, 200, 'a run with a workflow starts')
    const id = ((await started.json()) as { job?: { id?: string } }).job?.id ?? ''
    const end = Date.now() + 15_000
    while (Date.now() < end) {
      const job = getJob('comfy', id)
      if (job && job.status !== 'running' && job.pendingSaves === 0) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    eq(getJob('comfy', id)?.status, 'done', 'and ends done')
    const queued = mock.graphs[0]
    eq(
      [queued?.['6']?.inputs.text, queued?.['7']?.inputs.text, queued?.['10']?.inputs.seed, queued?.['5']?.inputs.width, queued?.['9']?.class_type, queued?.['latentry-lora-1']?.inputs.lora_name],
      ['a harbour at dawn', 'fog', 7, 640, 'PreviewImage', 'styles/ink.safetensors'],
      'ComfyUI got the workflow filled in: prompts, seed, size, PreviewImage, the LoRA'
    )
    const saved = readdirSync(saveDir)
    eq(saved.length, 1, 'the picture is saved')
    const record = JSON.parse(readPngText(readFileSync(path.join(saveDir, saved[0]))).latentry ?? '{}') as { workflow?: string; model?: string | null }
    eq([record.workflow, record.model], ['portrait', null], 'its record names the workflow; the model is the workflow\'s own, so not guessed')
  } finally {
    await mock.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
