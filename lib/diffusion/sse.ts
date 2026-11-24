// Server-Sent Events helpers: the diffusers-compatible backend speaks SSE to
// this server, and /api/gen/<id>/job/stream speaks it on to the browser.
//
// Reading is eventsource-parser's (MIT, no dependencies, pinned in
// package.json): it follows the spec where a hand-written splitter is easy to
// get wrong, such as a CRLF cut between two chunks, the one space after
// `data:` that is not part of the value, and `id:` and `retry:` lines.

import { EventSourceParserStream } from 'eventsource-parser/stream'

export interface SseEvent {
  event: string
  data: string
}

/**
 * The most characters one unfinished event may hold. The largest real one is
 * a picture: 4096 pixels a side as a base64 PNG is about 67M characters at
 * worst. A stream past this is ended, so a broken backend cannot make the
 * server hold without bound.
 */
export const MAX_SSE_EVENT_CHARS = 128 * 1024 * 1024

/** Serialises one named event with a JSON payload, terminator included. */
export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * The events of a byte stream, `message` where none is named. Comments
 * (`: keep-alive`) and frames with no `data:` line carry nothing and are
 * skipped. Throws when the stream breaks or an event outgrows
 * MAX_SSE_EVENT_CHARS; the stream is cancelled when the caller stops early.
 */
export async function* readSseFrames(body: ReadableStream<Uint8Array>, maxChars: number = MAX_SSE_EVENT_CHARS): AsyncGenerator<SseEvent> {
  // TextDecoderStream takes any BufferSource; TypeScript's lib types will not
  // pair that with a stream of Uint8Array, though every Uint8Array is one.
  const decoder = new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>
  const reader = body
    .pipeThrough(decoder)
    .pipeThrough(new EventSourceParserStream({ maxBufferSize: maxChars }))
    .getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield { event: value.event || 'message', data: value.data }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
