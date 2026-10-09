/**
 * The incremental half of every file-backed adapter (ADR-486): each candidate is stat-ed (a link is refused, a vanished file is dropped), and
 * it is read again only when its size or mtime changed. A read that fails keeps the earlier summary and says so (stale), never a blank row.
 * One pass reads at most PASS_BYTES; what does not fit waits for the next pass, which is how 20 busy sessions stay inside a tick.
 */
import { readWindow } from './harness-text'
import type { SessionFs } from './harness'

export type Candidate = { path: string; nativeId: string; folder: string; size: number; mtimeMs: number }
export type Held<S> = { mtimeMs: number; size: number; value: S | null; noPreview: string | null; stale: string | null; whole: boolean }
export type Memory<S> = Map<string, Held<S>>

export const PASS_BYTES = 12_000_000
const CONCURRENCY = 8

const WHY: Record<string, string> = { 'too-large': 'transcript is larger than this host can read', refused: 'the host refused the read', missing: 'file is gone', 'not-regular': 'not a regular file' }

export async function settle<S>(fs: SessionFs, memory: Memory<S>, cands: readonly Candidate[], summarize: (text: string, whole: boolean, cand: Candidate) => S): Promise<{ cand: Candidate; held: Held<S> }[]> {
  const out: { cand: Candidate; held: Held<S> }[] = []
  let budget = PASS_BYTES

  const one = async (cand: Candidate): Promise<void> => {
    let stat: Awaited<ReturnType<SessionFs['stat']>>

    try {
      stat = await fs.stat(cand.path)
    } catch {
      stat = undefined
    }

    if (stat === undefined) {
      memory.delete(cand.path)

      return
    }

    const before = memory.get(cand.path)
    const size = stat.size ?? cand.size
    const mtimeMs = stat.mtimeMs ?? cand.mtimeMs

    if (stat.isLink === true || (stat.kind !== undefined && stat.kind !== 'file')) {
      const held: Held<S> = { mtimeMs, size, value: null, noPreview: WHY['not-regular'] as string, stale: null, whole: false }

      memory.set(cand.path, held)
      out.push({ cand: { ...cand, size, mtimeMs }, held })

      return
    }

    if (before !== undefined && before.mtimeMs === mtimeMs && before.size === size && before.stale === null) {
      out.push({ cand: { ...cand, size, mtimeMs }, held: before })

      return
    }

    // A file that fits no more of this pass keeps its earlier summary (or none) until the next pass.
    const cost = Math.min(size, 300_000)

    if (budget - cost < 0 && before !== undefined) {
      const held = { ...before, stale: before.stale ?? 'newer than the last read' }

      memory.set(cand.path, held)
      out.push({ cand: { ...cand, size, mtimeMs }, held })

      return
    }

    budget -= cost

    const window = await readWindow(fs, cand.path, size)
    let held: Held<S>

    if (window.text !== null) held = { mtimeMs, size, value: summarize(window.text, window.whole, { ...cand, size, mtimeMs }), noPreview: null, stale: null, whole: window.whole }
    else if (before?.value !== undefined && before.value !== null) held = { ...before, mtimeMs, size, stale: `read failed: ${WHY[window.reason] ?? window.reason}` }
    else held = { mtimeMs, size, value: null, noPreview: WHY[window.reason] ?? window.reason, stale: null, whole: false }

    memory.set(cand.path, held)
    out.push({ cand: { ...cand, size, mtimeMs }, held })
  }

  for (let i = 0; i < cands.length; i += CONCURRENCY) await Promise.all(cands.slice(i, i + CONCURRENCY).map(cand => one(cand).catch(() => undefined)))

  return out
}
