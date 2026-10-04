// A child process's output arrives in chunks that can end mid-line; this
// hands on whole lines only, so a log does not show "==0" and ".4" apart.

export function lineSplitter(onLine: (line: string) => void): { write: (chunk: Buffer | string) => void; flush: () => void } {
  let rest = ''
  return {
    write(chunk) {
      const parts = (rest + chunk.toString()).split(/\r?\n|\r/)
      rest = parts.pop() ?? ''
      for (const part of parts) if (part.trim()) onLine(part.trimEnd())
    },
    flush() {
      if (rest.trim()) onLine(rest.trimEnd())
      rest = ''
    },
  }
}
