/**
 * Bounded reading of a harness's JSONL (ADR-486). A session file is another process's output and may be huge, truncated, binary or hostile:
 * a window is at most TAIL_BYTES from the end (where the host offers `readTail`) or the whole file when it is under READ_MAX; a line over
 * LINE_CAP is skipped unparsed; at most MAX_LINES lines are looked at; nothing here uses a backtracking pattern on file text.
 */
import { READ_MAX } from './files'
import type { SessionFs } from './harness'
import { cleanText } from './wf-clean'
import { plain } from './parse'

export const TAIL_BYTES = 262_144
export const LINE_CAP = 400_000
export const MAX_LINES = 30_000

export type Window = { text: string; whole: boolean } | { text: null; reason: 'missing' | 'refused' | 'not-regular' | 'too-large' }

/** The text one session file can be summarised from, given its size from a stat that already ruled out links. Never reads what the host cannot bound. */
export async function readWindow(fs: SessionFs, path: string, size: number): Promise<Window> {
  try {
    if (size <= READ_MAX) return { text: (await fs.read(path)).slice(0, READ_MAX), whole: true }
    if (fs.readTail === undefined) return { text: null, reason: 'too-large' }

    const tail = (await fs.readTail(path, TAIL_BYTES)).slice(-TAIL_BYTES * 2)
    const cut = tail.indexOf('\n')

    // The first line of a window starts somewhere inside a line: it is dropped, never parsed.
    return { text: cut < 0 ? '' : tail.slice(cut + 1), whole: false }
  } catch {
    return { text: null, reason: 'refused' }
  }
}

export type ScanStats = { lines: number; skipped: number; bad: number }

/** Calls `on` with each JSON object line, in order. Skips over-long and non-object lines; stops at MAX_LINES. */
export function scanRecords(text: string, on: (record: Record<string, unknown>) => void): ScanStats {
  const stats: ScanStats = { lines: 0, skipped: 0, bad: 0 }
  let at = 0

  while (at < text.length && stats.lines < MAX_LINES) {
    let end = text.indexOf('\n', at)

    if (end < 0) end = text.length

    stats.lines += 1

    if (end - at > LINE_CAP) stats.skipped += 1
    else if (text.charCodeAt(at) === 123 /* { */) {
      try {
        const value: unknown = JSON.parse(text.slice(at, end))

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) on(value as Record<string, unknown>)
        else stats.bad += 1
      } catch {
        stats.bad += 1
      }
    } else if (end > at) stats.bad += 1

    at = end + 1
  }

  return stats
}

/** Free text for a cell: whole escape sequences gone, control and invisible characters gone, credentials masked, one line, cut with an ellipsis. */
export const shown = (value: unknown, max: number): string => cleanText(plain(typeof value === 'string' ? value.slice(0, max * 4) : '', max))

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
export const timeMs = (value: unknown): number | undefined => {
  const ms = typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : Number.NaN

  return Number.isFinite(ms) && ms > 946_684_800_000 && ms < 8.64e15 ? ms : undefined
}

/** A test runner's summary line in a tool's output, found without a backtracking pattern. Null when none is there. */
export function testLine(output: string): string | null {
  const lines = output.slice(-6000).split('\n')

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? '').trim()

    if (line.length > 0 && line.length < 300 && /\b\d+ (?:passed|failed|passing|failing)\b|\btest result:|\bTests?:\s+\d+/.test(line)) return shown(line, 90)
  }

  return null
}

const TEST_COMMAND = /\b(?:vitest|jest|pytest|mocha|cargo (?:test|nextest)|npm (?:run )?test|pnpm (?:run )?test|yarn test|go test|node --test)\b/

export const isTestCommand = (command: string): boolean => TEST_COMMAND.test(command.slice(0, 600))
