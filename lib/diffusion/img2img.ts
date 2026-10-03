// img2img starts partway down the noise schedule, so it runs fewer denoising
// steps than the form asks for. This is diffusers' get_timesteps (and what
// A1111 does by default too); the progress bars use it as their opening value,
// before the backend's own "start" event confirms it.

export function img2imgSteps(steps: number, strength: number): number {
  const initTimestep = Math.min(steps * strength, steps)
  // Python's int() truncates, which is what decides the count server-side.
  const tStart = Math.trunc(Math.max(steps - initTimestep, 0))
  return Math.max(1, steps - tStart)
}
