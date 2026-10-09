/** The console's attention summary (ADR-486): counts only, written by ruflo-console into its own state folder and read here as a courtesy. */
export const ATTENTION_STATUS = '.claude-flow/console/attention.json'
export const ATTENTION_MAX_BYTES = 2048
/** A summary older than this is not shown as current: the console writes it only when a count changes, so a quiet queue stays unchanged for hours. */
const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 99_999) : undefined)

/**
 * The one `attention:` row of `/ruflo-mods`, or undefined when the file is absent, foreign or malformed. Only four counts and the time the
 * console wrote them are shown: no title, path or transcript text exists in the file, and none from it reaches the report. The file is written
 * by the console and not authenticated; it never decides anything, and nothing here gates, denies or delays a hook.
 */
export function attentionLine(text: string, nowMs: number): string | undefined {
  if (text.length > ATTENTION_MAX_BYTES) return undefined
  try {
    const o = JSON.parse(text) as { schema?: unknown; approve?: unknown; question?: unknown; failed?: unknown; unread?: unknown; atMs?: unknown }
    if (o.schema !== 'ruflo-console.attention/1') return undefined
    const approve = count(o.approve)
    const question = count(o.question)
    const failed = count(o.failed)
    const unread = count(o.unread)
    if (approve === undefined || question === undefined || failed === undefined || unread === undefined) return undefined
    const at = typeof o.atMs === 'number' && Number.isFinite(o.atMs) && o.atMs > 0 && o.atMs <= nowMs + 60_000 ? Math.max(0, Math.round((nowMs - o.atMs) / 1000)) : undefined
    const when = at === undefined ? 'time unknown' : at < 90 ? `${at}s ago` : at < 5400 ? `${Math.round(at / 60)}m ago` : `${Math.round(at / 3600)}h ago`
    return `  attention:   ${approve} to approve · ${question} question${question === 1 ? '' : 's'} · ${failed} failed · ${unread} finished unread (from the console, changed ${when}; unauthenticated)`
  } catch {
    return undefined
  }
}
