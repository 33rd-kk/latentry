// What GPUs this machine has, and which PyTorch build drives them.
//
// NVIDIA is asked through nvidia-smi, which ships with the driver. Apple
// silicon is recognised by platform. Anything else falls back to the CPU
// build: it works everywhere, slowly.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Gpu {
  index: number
  vendor: 'nvidia' | 'apple' | 'cpu'
  name: string
  vramMiB: number
  driver: string | null
  /** CUDA compute capability, e.g. "12.0" for Blackwell. */
  computeCap: string | null
}

export interface TorchChoice {
  /** pip index for torch, or null for the default index (Apple). */
  indexUrl: string | null
  label: string
}

/** Parses `nvidia-smi --query-gpu=index,name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits`. Pure. */
export function parseNvidiaSmi(output: string): Gpu[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4 && /^\d+$/.test(cells[0]))
    .map(([index, name, memory, driver, computeCap]) => ({
      index: Number(index),
      vendor: 'nvidia' as const,
      name,
      vramMiB: Number(memory) || 0,
      driver: driver || null,
      computeCap: computeCap && computeCap !== '[N/A]' ? computeCap : null,
    }))
}

export async function detectGpus(): Promise<Gpu[]> {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=index,name,memory.total,driver_version,compute_cap', '--format=csv,noheader,nounits'],
      { timeout: 10000, windowsHide: true }
    )
    const gpus = parseNvidiaSmi(stdout)
    if (gpus.length) return gpus
  } catch {
    // No NVIDIA driver; look further.
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return [{ index: 0, vendor: 'apple', name: 'Apple GPU', vramMiB: 0, driver: null, computeCap: null }]
  }
  return []
}

/**
 * The PyTorch build for these GPUs. For NVIDIA it is the newest CUDA the
 * driver can run (a driver runs every CUDA up to its own), and never older
 * than the GPU needs: Blackwell (compute 12.x) has kernels only from CUDA 12.8.
 * Pure.
 */
export function chooseTorch(gpus: Gpu[]): TorchChoice {
  const nvidia = gpus.filter((gpu) => gpu.vendor === 'nvidia')
  if (nvidia.length) {
    const driver = Math.min(...nvidia.map((gpu) => parseFloat(gpu.driver ?? '0') || 0))
    const newestCap = Math.max(...nvidia.map((gpu) => parseFloat(gpu.computeCap ?? '0') || 0))
    let cuda: string
    if (driver >= 580) cuda = 'cu130'
    else if (driver >= 570) cuda = 'cu128'
    else if (driver >= 560) cuda = 'cu126'
    else cuda = 'cu118'
    if (newestCap >= 12 && (cuda === 'cu126' || cuda === 'cu118')) {
      // The driver is too old for the GPU's own CUDA; installing would
      // succeed and every run fail. Say so instead.
      return { indexUrl: null, label: 'unsupported: update the NVIDIA driver (570 or newer) for this GPU' }
    }
    return { indexUrl: `https://download.pytorch.org/whl/${cuda}`, label: `CUDA (${cuda})` }
  }
  if (gpus.some((gpu) => gpu.vendor === 'apple')) return { indexUrl: null, label: 'Apple Metal (MPS)' }
  return { indexUrl: 'https://download.pytorch.org/whl/cpu', label: 'CPU only' }
}
