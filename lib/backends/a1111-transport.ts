// The HTTP the A1111 adapter (./a1111.ts) needs, behind an interface so the
// verify script can play a web UI.

import { Agent, fetch as undiciFetch } from 'undici'
import { REDIRECT_REFUSED } from './http'
import type { BackendConfig } from './types'

// The generate call returns only when the last image is done. Node's fetch
// gives up on response headers after five minutes, which a large batch passes
// easily, so it goes through an agent with no header or body deadline.
const longAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 })

/** /sdapi/v1/progress's `state`. */
export interface ProgressState {
  job_count?: number
  job_no?: number
  job_timestamp?: string
  sampling_step?: number
  sampling_steps?: number
  interrupted?: boolean
}

/** The HTTP the adapter needs, separable so the verify script can play a web UI. */
export interface A1111Transport {
  get(path: string, timeoutMs: number): Promise<{ status: number; body: unknown }>
  post(path: string, body: unknown, options: { timeoutMs: number | null }): Promise<{ status: number; body: unknown }>
  sleep(ms: number): Promise<void>
}

export function httpTransport(config: BackendConfig): A1111Transport {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.token) headers.Authorization = `Basic ${Buffer.from(config.token).toString('base64')}`

  const call = async (path: string, init: { method: string; body?: string; timeoutMs: number | null }) => {
    // Redirects are refused, not followed: see refuseRedirect.
    const response = await undiciFetch(new URL(path, config.url), {
      method: init.method,
      headers,
      body: init.body,
      redirect: 'manual',
      ...(init.timeoutMs === null ? { dispatcher: longAgent } : { signal: AbortSignal.timeout(init.timeoutMs) }),
    })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {})
      return { status: 502, body: { error: REDIRECT_REFUSED } }
    }
    const text = await response.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { error: text.slice(0, 300) }
    }
    return { status: response.status, body }
  }

  return {
    get: (path, timeoutMs) => call(path, { method: 'GET', timeoutMs }),
    post: (path, body, options) => call(path, { method: 'POST', body: JSON.stringify(body), timeoutMs: options.timeoutMs }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}
