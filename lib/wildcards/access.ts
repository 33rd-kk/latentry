// Who may use the wildcards folder: list its names, and have a prompt's
// wildcards replaced with its lines.
//
//   'edit'    a client that may change settings (this machine by default)
//   'shared'  any other client, when "Use on paired devices" is on;
//             proxy.ts has already made sure it is paired (or pairing is off)
//   null      nobody else
//
// Pure, so the verify script can pin it down.

import { editRefusal } from '@/lib/settings/access'
import type { Settings } from '@/lib/settings/schema'

type Env = Record<string, string | undefined>

export type WildcardsAccess = 'edit' | 'shared' | null

export function wildcardsAccess(headers: Headers, settings: Settings, env: Env = process.env): WildcardsAccess {
  if (!editRefusal(headers, env)) return 'edit'
  return settings.wildcards?.share === true ? 'shared' : null
}
