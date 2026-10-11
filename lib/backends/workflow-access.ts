// Who may see a ComfyUI backend's workflows (their file names) and run one.
//
//   'edit'    a client that may change settings (this machine by default)
//   'shared'  any other client, when "Show workflow names on paired devices"
//             is on for that backend; proxy.ts has already made sure it is
//             paired (or pairing is off)
//   null      nobody else, and nobody at all for a backend without a folder
//
// Pure, so the verify script can pin it down. The same shape as
// lib/engine/lora-access.ts.

import { editRefusal } from '@/lib/settings/access'
import type { BackendConfig } from './types'

type Env = Record<string, string | undefined>

export type WorkflowAccess = 'edit' | 'shared' | null

export function workflowAccess(headers: Headers, config: BackendConfig, env: Env = process.env): WorkflowAccess {
  if (config.kind !== 'comfyui' || !config.workflowsDir) return null
  if (!editRefusal(headers, env)) return 'edit'
  return config.shareWorkflows === true ? 'shared' : null
}
