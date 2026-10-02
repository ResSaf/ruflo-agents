import type { RenderElement } from 'claude-code'

import { button, clip, col, kv, picture, row, rule, text, THEME, type Ctx } from './common'
import { selection } from './select'

const STATUS_COLOR = (status: string): string | undefined =>
  /busy|active|running/i.test(status) ? THEME.warn : /error|fail/i.test(status) ? THEME.bad : /stop|terminat|offline/i.test(status) ? undefined : THEME.info

/**
 * The swarm as ruflo wrote it: a graph of its members with the leader marked, the agents (pick one with j/k, open it
 * with d), and the hive's votes. The tile board is ruflo-swarm's pane (/ruflo swarm pane); this view does not redraw it.
 */
export function swarmView(ctx: Ctx): RenderElement {
  const snap = ctx.state.snapshot
  const swarm = snap?.swarm ?? null
  const hive = snap?.hive ?? null
  const agents = snap?.agents ?? []
  const picked = selection(ctx.state).agent
  const rows: RenderElement[] = [rule(ctx, 'Swarm', swarm?.id ?? '')]

  if (snap === null) return text(ctx, 'reading ruflo state…', { dimColor: true })

  if (swarm === null && hive === null && agents.length === 0) {
    rows.push(text(ctx, 'No swarm on disk here. `npx ruflo swarm init --topology hierarchical` starts one (or p → "start a swarm").', { dimColor: true }))

    return col(ctx, rows, 'swarm')
  }

  rows.push(kv(ctx, 'topology', swarm === null ? `${hive?.topology ?? 'n/a'} (hive-mind)` : `${swarm.topology}${swarm.strategy !== undefined ? ` · ${swarm.strategy}` : ''} · ${swarm.status}${swarm.maxAgents !== undefined ? ` · max ${swarm.maxAgents}` : ''}`))
  rows.push(picture(ctx, 'topology', `graph needs a terminal: ${agents.length} agents`))
  rows.push(text(ctx, '★ leader (its heartbeat is decoration) · ● idle / busy / stopped as ruflo wrote them · a white pulse = an event about that agent', { dimColor: true }))
  rows.push(rule(ctx, 'Agents', `${agents.length} · j/k pick · d open · x actions`))

  for (const agent of agents.slice(0, 10)) {
    const isPicked = picked?.id === agent.id
    const color = STATUS_COLOR(agent.status)

    rows.push(
      row(ctx, [
        ctx.kit.Text({ ...(color === undefined ? { dimColor: true } : { color }), children: `${isPicked ? '▸' : ' '}● ` }),
        ctx.kit.Text({
          wrap: 'truncate-end',
          ...(isPicked && { bold: true }),
          children: clip(`${(agent.name ?? agent.type).padEnd(14)} ${agent.type.padEnd(12)} ${agent.status.padEnd(9)} tasks ${agent.taskCount ?? 'n/a'} · health ${agent.health === undefined ? 'n/a' : `${Math.round(agent.health * 100)}%`} · ${agent.id}`, ctx.columns - 3),
        }),
      ]),
    )
  }

  if (agents.length > 10) rows.push(text(ctx, `+${agents.length - 10} more (j/k walks all of them)`, { dimColor: true }))

  if (ctx.columns >= 44 && agents.length > 0) {
    rows.push(row(ctx, [button(ctx, 'agent-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'agent-next', 'next', () => ctx.act.select(1), { hotkey: 'j' }), button(ctx, 'drill', 'Open agent', ctx.act.drill, { hotkey: 'd' })]))
  }

  rows.push(rule(ctx, 'Hive-mind', hive === null ? 'not initialised' : `${hive.strategy ?? 'consensus'}${hive.queen !== undefined ? ` · queen ${hive.queen}` : ''}`))

  if (hive === null) {
    rows.push(text(ctx, 'n/a — `npx ruflo hive-mind init` for queen-led consensus', { dimColor: true }))
  } else {
    for (const proposal of hive.pending.slice(-3)) rows.push(text(ctx, `◇ ${proposal.type} (${proposal.strategy}) ${proposal.status} · for ${proposal.votesFor} · against ${proposal.votesAgainst} · ${proposal.id}`, { color: THEME.warn }))
    for (const decision of hive.history.slice(-2)) rows.push(text(ctx, `◆ ${decision.type} → ${decision.result} · for ${decision.votesFor} · against ${decision.votesAgainst}`, { dimColor: true }))
    if (hive.pending.length === 0 && hive.history.length === 0) rows.push(text(ctx, 'no proposals yet', { dimColor: true }))
    if (hive.pending.length > 0) rows.push(text(ctx, 'vote from Approvals (q) or the palette (p → vote)', { dimColor: true }))
  }

  return col(ctx, rows, 'swarm')
}
