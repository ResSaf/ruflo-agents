/**
 * The management views: the agent timeline, the approvals queue and the event stream. Each acts through the palette's
 * entries (by id), so a button here runs exactly what the palette or `/ruflo run <id>` would.
 */
import type { RenderElement } from 'claude-code'

import { approvalsOf } from '../data/alerts'
import { ago, button, clip, col, picture, row, rule, text, THEME, type Ctx } from './common'

export function timelineView(ctx: Ctx): RenderElement {
  const agents = ctx.state.snapshot?.agents.length ?? 0
  const rows: RenderElement[] = [rule(ctx, 'Timeline', 'last 15 minutes · observed since the console loaded')]

  rows.push(picture(ctx, 'gantt', agents === 0 && ctx.state.toolsByAgent.size === 0 ? 'no agents and no tool calls seen yet' : `${agents} agents`))
  rows.push(text(ctx, '█ busy · ▁ idle (ruflo agent status, as each read saw it) · ▮ a tool call Claude Code made (main session and subagents)', { dimColor: true }))
  rows.push(text(ctx, "ruflo agents' own tool calls are not visible to Claude Code: their rows show status only", { dimColor: true }))

  return col(ctx, rows, 'timeline')
}

export function approvalsView(ctx: Ctx): RenderElement {
  const items = approvalsOf(ctx.state)
  const picked = items.length === 0 ? -1 : ((ctx.state.select.item % items.length) + items.length) % items.length
  const rows: RenderElement[] = [rule(ctx, 'Approvals', items.length === 0 ? 'nothing waiting' : `${items.length} waiting · j/k pick`)]

  if (items.length === 0) {
    rows.push(text(ctx, 'No hive-mind proposals, stealable claims, refused mods, permission denies or budget alerts waiting.', { dimColor: true }))
  }

  items.slice(0, 12).forEach((item, i) => {
    const isPicked = i === picked

    rows.push(text(ctx, `${isPicked ? '▸' : ' '} [${item.kind}] ${item.text}`, isPicked ? { bold: true, color: THEME.head } : { color: item.kind === 'policy-deny' || item.kind === 'mod-trust' ? THEME.bad : THEME.warn }))
    rows.push(text(ctx, `    ${item.detail}`, { dimColor: true }))

    if (isPicked && item.actions.length > 0 && ctx.columns >= 44) {
      rows.push(row(ctx, item.actions.map((action, a) => button(ctx, `approve-${a}`, action.label, () => void ctx.act.run(action.paletteId), a < 2 ? { hotkey: a === 0 ? 'v' : 'w' } : {}))))
    }
  })

  if (ctx.columns >= 44 && items.length > 1) rows.push(row(ctx, [button(ctx, 'item-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'item-next', 'next', () => ctx.act.select(1), { hotkey: 'j' })]))

  rows.push(text(ctx, 'each action asks y/n before it runs; a permission deny is shown, never loosened from here', { dimColor: true }))

  return col(ctx, rows, 'approvals')
}

const KIND_COLOR: Record<string, string> = { swarm: THEME.info, claims: THEME.warn, federation: THEME.ok, learning: THEME.head, tools: THEME.info, mods: THEME.bad, missions: THEME.head }

export function eventsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const filter = state.eventFilter
  const shown = state.events.filter(event => filter === 'all' || event.kind === filter)
  const rows: RenderElement[] = [rule(ctx, 'Events', `${shown.length} · filter ${filter} (f)`)]

  if (shown.length === 0) rows.push(text(ctx, state.events.length === 0 ? 'Nothing has changed since the console loaded. Events are what changed between reads, and what this session did.' : `no ${filter} events`, { dimColor: true }))

  for (const event of shown.slice(-18).reverse()) {
    rows.push(row(ctx, [ctx.kit.Text({ dimColor: true, children: `${ago(event.atMs, nowMs).padStart(8)} ` }), ctx.kit.Text({ color: KIND_COLOR[event.kind] ?? THEME.info, children: `${event.kind.padEnd(10)} ` }), ctx.kit.Text({ wrap: 'truncate-end', children: clip(event.text, Math.max(10, ctx.columns - 21)) })]))
  }

  if (ctx.columns >= 44) rows.push(row(ctx, [button(ctx, 'filter', `Filter: ${filter}`, ctx.act.filter, { hotkey: 'f' })]))

  return col(ctx, rows, 'events')
}
