/**
 * lib/diffusion/sse: reading a backend's event stream, however its bytes are
 * cut into chunks, and writing events for the browser.
 *
 * Run with: npm test -- sse
 */
import { check, done, eq } from './assert'
import { encodeSseEvent, readSseFrames, type SseEvent } from '../lib/diffusion/sse'

const encoder = new TextEncoder()

/** The chunks, then the end; with `onCancel`, open after them, as a backend between events. */
function streamOf(chunks: (string | Uint8Array)[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) return onCancel ? new Promise<void>(() => {}) : controller.close()
      const chunk = chunks[index++]
      controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
    },
    cancel: () => onCancel?.(),
  })
}

async function read(chunks: (string | Uint8Array)[], maxChars?: number): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  for await (const event of readSseFrames(streamOf(chunks), maxChars)) events.push(event)
  return events
}

/** Every byte its own chunk. */
function bytes(text: string): Uint8Array[] {
  return [...encoder.encode(text)].map((byte) => Uint8Array.of(byte))
}

async function main(): Promise<void> {
  eq(await read(['event: progress\ndata: {"step":1}\n\n', 'data: plain\n\n']), [
    { event: 'progress', data: '{"step":1}' },
    { event: 'message', data: 'plain' },
  ], 'named events, and message where none is named')

  eq(await read(['event: image\r', '\ndata: {"a":1}\r\n', '\r\n']), [{ event: 'image', data: '{"a":1}' }], 'a CRLF cut between two chunks ends no frame early')
  eq(await read(['data: a\r\rdata: b\r\r']), [{ event: 'message', data: 'a' }, { event: 'message', data: 'b' }], 'bare CR line endings too')

  eq(await read(['data:  two spaces \n\n']), [{ event: 'message', data: ' two spaces ' }], 'only the one space after data: is dropped, the rest of the value kept')
  eq(await read(['data: line one\ndata: line two\n\n']), [{ event: 'message', data: 'line one\nline two' }], 'data lines join with a newline')
  eq(await read([': keep-alive\n\n', 'event: lonely\n\n', 'id: 7\nretry: 1000\ndata: x\n\n']), [{ event: 'message', data: 'x' }], 'comments and frames without data are skipped; id and retry lines do not break a frame')

  const text = 'event: image\ndata: {"prompt":"桜と猫 🐈"}\n\n'
  eq(await read(bytes(text)), [{ event: 'image', data: '{"prompt":"桜と猫 🐈"}' }], 'a stream cut into single bytes, a character cut in two among them')
  eq(await read(['data: whole\n\n', 'data: never ended']), [{ event: 'message', data: 'whole' }], 'an event the stream ends in the middle of is dropped')

  const big = 'x'.repeat(5000)
  eq((await read([`data: ${big}\n\n`]))[0]?.data.length, 5000, 'a long event within the bound is read')
  let threw = false
  try {
    await read([`data: ${big.slice(0, 600)}`, big.slice(0, 600), '\n\n'], 1000)
  } catch {
    threw = true
  }
  check(threw, 'an event that outgrows the bound ends the stream with an error')

  let cancelled = false
  const stream = streamOf(['data: 1\n\n', 'data: 2\n\n', 'data: 3\n\n'], () => (cancelled = true))
  for await (const event of readSseFrames(stream)) if (event.data === '1') break
  // The cancel goes back up through the decoder and the parser, a moment later.
  await new Promise((resolve) => setTimeout(resolve, 50))
  check(cancelled, 'stopping early cancels the backend stream')

  const payload = { type: 'image', text: 'a\nb', n: 1 }
  const [roundTrip] = await read([encodeSseEvent('image', payload)])
  eq([roundTrip?.event, JSON.parse(roundTrip?.data ?? 'null')], ['image', payload], 'what encodeSseEvent writes reads back the same, newlines in strings and all')

  done('sse')
}

void main()
