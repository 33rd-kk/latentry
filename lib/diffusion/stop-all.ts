import { getAdapter } from '@/lib/backends'
import { runningJobs } from '@/lib/diffusion/job-store'
import { allQueued, cancelGrid, cancelQueued } from '@/lib/diffusion/run-queue'
import { cancelFaceFix } from '@/lib/facefix/run'

/**
 * Every run going on any backend, for turning gallery-only mode on
 * (app/api/settings/route.ts). Once that mode is on, the pages can neither
 * watch nor stop a run, and the backends drop out of the list, so a run left
 * going would go on unseen on a backend of one's own, and the engine would
 * be stopped under it.
 */

/** How many runs draw or wait: a grid counts once, like a run in the queue. */
export function goingRuns(): number {
  const queued = allQueued()
  const gridJobs = new Set(queued.flatMap((run) => run.grid?.jobs ?? []))
  return queued.length + runningJobs().filter((job) => !gridJobs.has(job.id)).length
}

/**
 * Stops them all, as Cancel does for each: the waiting ones leave the queue
 * first, so none starts in between, then each backend is asked to stop the
 * run it draws. Asked, not waited for: a backend stops at its next step.
 */
export async function stopAllRuns(): Promise<void> {
  const grids: Promise<void>[] = []
  for (const run of allQueued()) {
    if (run.grid) grids.push(cancelGrid(run))
    else cancelQueued(run)
  }
  await Promise.all(grids)
  await Promise.all(
    runningJobs().map(async (job) => {
      const stopped = await cancelFaceFix(job.backend).catch(() => null)
      if (stopped) return
      await getAdapter(job.backend)
        ?.cancel(job.runId)
        .catch(() => null)
    })
  )
}
