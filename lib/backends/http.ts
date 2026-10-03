// Small fetch helpers shared by the adapters: bounded waits and readable errors.

/** fetch with a deadline on the whole exchange (headers and body). */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit & { timeoutMs: number }
): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init
  const timeout = AbortSignal.timeout(timeoutMs)
  return fetch(input, { ...rest, cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
}

/** fetch + JSON with a deadline; null for anything that is not a 2xx JSON body. */
export async function getJson<T>(url: URL, headers: HeadersInit, timeoutMs: number): Promise<T | null> {
  try {
    const response = await fetchWithTimeout(url, { headers, timeoutMs })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/** The message an error body carries, in the shapes FastAPI and A1111 use. */
export function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of ['detail', 'error', 'message', 'errors']) {
      const value = record[key]
      if (typeof value === 'string' && value) return value
      // FastAPI's 422: a list of { loc, msg }.
      if (Array.isArray(value) && value.length) {
        const first = value[0] as { msg?: unknown; loc?: unknown }
        if (typeof first?.msg === 'string') {
          const where = Array.isArray(first.loc) ? first.loc.join('.') : ''
          return where ? `${where}: ${first.msg}` : first.msg
        }
      }
    }
  }
  return fallback
}

/** The base64 payload of a data: URL, or the string itself when it is bare base64. */
export function stripDataUrl(value: string): string {
  return value.startsWith('data:') ? value.slice(value.indexOf(',') + 1) : value
}
