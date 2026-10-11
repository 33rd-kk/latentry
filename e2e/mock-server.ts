// The mock backends as a process of their own, for playwright.config.ts to
// start and stop alongside Latentry: an A1111 web UI and a ComfyUI. The
// ComfyUI one starts first, so it is up once the A1111 one answers.

import { startMockA1111 } from '../__tests__/fixtures/mock-a1111'
import { startMockComfyUI } from '../__tests__/fixtures/mock-comfyui'

async function main() {
  const comfy = await startMockComfyUI({ port: Number(process.env.E2E_COMFY_PORT) || 3139 })
  console.log(`Mock ComfyUI on ${comfy.url}`)
  const a1111 = await startMockA1111({ port: Number(process.env.E2E_MOCK_PORT) || 3138 })
  console.log(`Mock A1111 web UI on ${a1111.url}`)
}
void main()
