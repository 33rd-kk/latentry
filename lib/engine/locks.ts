// The engine's pinned Python packages: one lock file per platform and PyTorch
// build in engine/locks/, made by scripts/lock-engine.mjs with the pinned uv
// (every package at one version, each file checked against its SHA-256 as it
// is installed). This module only decides; ./install.ts runs uv. Pure, so the
// rules are tested in __tests__/engine.verify.ts.
//
// Pinned means a package cannot be swapped under the user, but also that
// security fixes arrive only with a new lock. So there are ways out, each
// said in the log and on Setup:
//   - LATENTRY_ENGINE_PACKAGES=latest installs unpinned, newest within the
//     ranges in engine/pyproject.toml (for when Latentry is not updated);
//   - no lock for this machine, a GPU newer than the locked PyTorch knows, or
//     a locked file that is no longer offered installs unpinned too;
//   - a hash that does not match never does: that is what the lock is for.

/** The day the locks were resolved for (uv's --exclude-newer). scripts/lock-engine.mjs reads it from here. */
export const LOCKED_ON = '2026-10-21'

/** After this long the Setup page says the pinned packages may have known vulnerabilities. */
export const LOCK_STALE_DAYS = 180

/** The PyTorch builds a lock exists for, besides macOS's default one (see ./gpus.ts). */
export const LOCKED_BACKENDS = ['cpu', 'cu118', 'cu126', 'cu128', 'cu130'] as const

/** Why an install is not pinned; null when it is. */
export type UnpinnedReason = 'latest' | 'no-lock' | 'missing' | 'new-gpu'

type Env = Record<string, string | undefined>

/** The oldest macOS the Apple silicon lock is made for: PyTorch's current wheels need 14 (Sonoma). */
export const LOCKED_MACOS = 14

/**
 * The lock file's name (engine/locks/<name>.txt) for this machine and PyTorch
 * build, or null when there is none: Windows and Linux on x86_64 for each
 * locked backend, and macOS LOCKED_MACOS or later on Apple silicon with the
 * default build. `osRelease` is os.release(), whose Darwin major is the macOS
 * major plus 9 (Darwin 23 is macOS 14).
 */
export function lockName(platform: NodeJS.Platform, arch: string, backend: string | null, osRelease = ''): string | null {
  if (platform === 'darwin') {
    const macos = (parseInt(osRelease, 10) || 0) - 9
    return arch === 'arm64' && backend === null && macos >= LOCKED_MACOS ? 'macos-arm64' : null
  }
  if (arch !== 'x64' || !backend || !(LOCKED_BACKENDS as readonly string[]).includes(backend)) return null
  if (platform === 'win32') return `windows-x86_64-${backend}`
  if (platform === 'linux') return `linux-x86_64-${backend}`
  return null
}

/** Whether the user asked for the newest packages instead of the pinned ones. */
export function wantsLatest(env: Env = process.env): boolean {
  return env.LATENTRY_ENGINE_PACKAGES?.trim().toLowerCase() === 'latest'
}

/** Whole days from LOCKED_ON to `now`. */
export function lockAgeDays(now: Date = new Date(), lockedOn: string = LOCKED_ON): number {
  return Math.floor((now.getTime() - Date.parse(`${lockedOn}T00:00:00Z`)) / 86_400_000)
}

export function lockIsStale(now: Date = new Date(), lockedOn: string = LOCKED_ON): boolean {
  return lockAgeDays(now, lockedOn) > LOCK_STALE_DAYS
}

/**
 * What a failed `uv pip sync` from a lock means: "missing" when a pinned
 * version is no longer offered (the index dropped it), which may be retried
 * unpinned; "stop" for everything else. A hash mismatch is always "stop", and
 * so is anything not recognised: falling back is the exception, not the rule.
 */
export function lockFailure(output: string): 'missing' | 'stop' {
  if (/hash mismatch/i.test(output)) return 'stop'
  if (/there is no version of|404 Not Found/i.test(output)) return 'missing'
  return 'stop'
}

/**
 * Whether a PyTorch build runs on a GPU of compute capability `major.minor`,
 * from `torch.cuda.get_arch_list()`: a kernel for it (sm_XY), or PTX for an
 * earlier one that the driver can compile (compute_XY at or below it).
 */
export function torchRunsOn(archList: string[], capability: [number, number]): boolean {
  const wanted = capability[0] * 10 + capability[1]
  return archList.some((arch) => {
    const match = /^(sm|compute)_(\d+)/.exec(arch)
    if (!match) return false
    const value = Number(match[2])
    return match[1] === 'sm' ? value === wanted : value <= wanted
  })
}
