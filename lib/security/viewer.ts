// Who is asking, for what a paired device may see of this machine's
// pictures: the gallery folders shared with paired devices
// (lib/gallery/access.ts), and the runs it started itself.
//
//   all     this machine, an owner device, or any client with
//           SETTINGS_EDIT=lan: every folder and every run, as before
//   device  any other client (proxy.ts has made sure it is paired, or
//           pairing is off): its own runs, by its device's id. Clients of a
//           server without pairing have no id and share theirs with each
//           other, never with this machine's.
//
// Unlike the switches that hang on editRefusal, SETTINGS_EDIT=off does not
// make this machine a stranger to its own pictures.

import { deviceCookie, pairedDevice } from '@/lib/security/pairing'
import { editMode, mayAdminister } from '@/lib/settings/access'

type Env = Record<string, string | undefined>

export interface Viewer {
  /** Sees every folder and every run. */
  all: boolean
  /** The paired device's id when not `all`; null without one. */
  device: string | null
}

export function viewerOf(headers: Headers, env: Env = process.env): Viewer {
  if (editMode(env) === 'lan' || mayAdminister(headers, env)) return { all: true, device: null }
  return { all: false, device: pairedDevice(deviceCookie(headers), Date.now(), env)?.id ?? null }
}

/** Whether `viewer` may see a run `startedBy` started: all of them, or only its own. */
export function maySeeRun(viewer: Viewer, startedBy: Viewer | undefined): boolean {
  if (viewer.all) return true
  return startedBy !== undefined && !startedBy.all && startedBy.device === viewer.device
}
