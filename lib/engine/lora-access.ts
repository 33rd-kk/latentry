// Who may see the engine's LoRA list (its file names).
//
//   'edit'    a client that may change settings (this machine by default)
//   'shared'  any other client, when "Show LoRAs on paired devices" is on;
//             proxy.ts has already made sure it is paired (or pairing is off)
//   null      nobody else
//
// Pure, so the verify script can pin it down.

import { editRefusal } from '@/lib/settings/access'
import type { Settings } from '@/lib/settings/schema'

type Env = Record<string, string | undefined>

export type LoraAccess = 'edit' | 'shared' | null

export function loraAccess(headers: Headers, settings: Settings, env: Env = process.env): LoraAccess {
  if (!editRefusal(headers, env)) return 'edit'
  return settings.engine?.shareLoras === true ? 'shared' : null
}
