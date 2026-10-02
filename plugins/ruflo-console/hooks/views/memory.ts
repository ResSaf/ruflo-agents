import type { RenderElement } from 'claude-code'

import type { MemoryStats, Namespaces } from '../data/cli'
import { ago, col, count, kv, live, rule, sourceLine, text, type Ctx } from './common'

/** AgentDB counts and namespaces from the ruflo CLI. */
export function memoryView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const memory = live<MemoryStats>(state.probes.get('memory'))
  const spaces = live<Namespaces>(state.probes.get('namespaces'))
  const rows: RenderElement[] = [rule(ctx, 'AgentDB', memory?.backend ?? '')]

  if (memory === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('memory'), nowMs, 'memory stats').text, { dimColor: true }))
  } else {
    rows.push(kv(ctx, 'entries', `${count(memory.total)} · ${count(memory.vectors)} with vectors`))
    rows.push(kv(ctx, 'storage', memory.storage ?? 'n/a'))
    rows.push(kv(ctx, 'span', `oldest ${ago(memory.oldestMs, nowMs)} · newest ${ago(memory.newestMs, nowMs)}`))
  }

  rows.push(rule(ctx, 'Namespaces', spaces === null ? '' : `newest ${spaces.sampled} entries`))

  if (spaces === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('namespaces'), nowMs, 'memory list').text, { dimColor: true }))
  } else if (spaces.byName.length === 0) {
    rows.push(text(ctx, 'no entries', { dimColor: true }))
  } else {
    const top = spaces.byName[0]?.count ?? 1
    const width = Math.max(4, Math.min(30, ctx.columns - 30))

    for (const space of spaces.byName.slice(0, 6)) {
      rows.push(text(ctx, `${space.name.slice(0, 20).padEnd(21)}${'█'.repeat(Math.max(1, Math.round((space.count / top) * width)))} ${space.count}`))
    }

    rows.push(text(ctx, 'a sample: counts over the newest entries `memory list` returns, not the whole store', { dimColor: true }))
  }

  rows.push(text(ctx, 'spend, budget gauge and burn: Cost (9)', { dimColor: true }))

  return col(ctx, rows, 'memory')
}
