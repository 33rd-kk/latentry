// Server-Sent Events helpers: the diffusers-compatible backend speaks SSE to
// this server, and /api/gen/<id>/job/stream speaks it on to the browser.

export interface SseEvent {
  event: string
  data: string
}

/**
 * Parses one SSE frame (the text between two blank lines). Returns null for a
 * frame with no `data:` line — comments (`: keep-alive`) and bare `event:`
 * lines carry nothing to act on.
 */
export function parseSseEvent(rawEvent: string): SseEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  return dataLines.length ? { event, data: dataLines.join('\n') } : null
}

/** Serialises one named event with a JSON payload, terminator included. */
export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Splits a byte stream into SSE frames. CRLF line endings are folded to LF
 * first, since the spec allows either and a frame boundary is a blank line.
 */
export async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
      let separatorIndex: number
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const parsed = parseSseEvent(buffer.slice(0, separatorIndex))
        buffer = buffer.slice(separatorIndex + 2)
        if (parsed) yield parsed
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
