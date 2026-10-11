// The mock backends as a process of their own, for playwright.config.ts to
// start and stop alongside Latentry: an A1111 web UI, a ComfyUI and two
// diffusers-compatible servers with pose (one takes a list of people, one
// only one or everyone). The others start first, so they are up once the
// A1111 one answers.

import { startMockA1111 } from '../__tests__/fixtures/mock-a1111'
import { startMockComfyUI } from '../__tests__/fixtures/mock-comfyui'
import { startMockDiffusers } from '../__tests__/fixtures/mock-diffusers'

async function main() {
  const comfy = await startMockComfyUI({ port: Number(process.env.E2E_COMFY_PORT) || 3139 })
  console.log(`Mock ComfyUI on ${comfy.url}`)
  const diffusers = await startMockDiffusers({ port: Number(process.env.E2E_POSE_PORT) || 3140 })
  console.log(`Mock diffusers server on ${diffusers.url}`)
  const single = await startMockDiffusers({ port: Number(process.env.E2E_POSE_SINGLE_PORT) || 3141, subsets: false })
  console.log(`Mock diffusers server, one or everyone, on ${single.url}`)
  const a1111 = await startMockA1111({ port: Number(process.env.E2E_MOCK_PORT) || 3138 })
  console.log(`Mock A1111 web UI on ${a1111.url}`)
}
void main()
