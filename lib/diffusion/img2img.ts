// img2img starts partway down the noise schedule, so it runs fewer denoising
// steps than the form asks for. This is each pipeline's get_timesteps (the
// engine's img2img_steps); the progress bars use it as their opening value,
// before the backend's own "start" event confirms it.

export function img2imgSteps(steps: number, strength: number, profile?: string): number {
  // Python's int() truncates, which is what decides the count server-side.
  // Anima's pipeline truncates the skipped part; the SDXL pipelines (and A1111)
  // truncate the part that runs, so 28 steps at 0.85 are 24 on Anima and 23
  // everywhere else.
  if (profile === 'anima') {
    const initTimestep = Math.min(steps * strength, steps)
    const tStart = Math.trunc(Math.max(steps - initTimestep, 0))
    return Math.max(1, steps - tStart)
  }
  return Math.max(1, Math.min(Math.trunc(steps * strength), steps))
}
