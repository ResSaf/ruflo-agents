import type { RenderElement } from 'claude-code'

import { col, kv, pct, picture, rule, text, THEME, type Ctx } from './common'

const LADDER = [0.5, 0.75, 0.9, 1] as const

/** The budget ladder as a text bar: marks at 50/75/90/100% of the limit, the spend filled to where it stands. */
export function ladder(usd: number, limit: number, width: number): string {
  const cells = Math.max(10, width)
  const at = Math.min(cells, Math.round((usd / limit) * cells))
  const marks = new Set(LADDER.map(step => Math.min(cells - 1, Math.round(step * cells) - 1)))

  return Array.from({ length: cells }, (_, i) => (marks.has(i) ? '│' : i < at ? '█' : '·')).join('')
}

/** This session's spend from Claude Code, against the ruflo-mods budget ladder where one is set, and its burn since load. */
export function costView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const budget = state.ruflo.snapshot?.budget
  const spend = state.usage?.costUsd
  const rows: RenderElement[] = [rule(ctx, 'Cost', 'this session')]

  rows.push(picture(ctx, 'gauge', budget === undefined ? 'no budget set' : `$${(budget.usd ?? spend ?? 0).toFixed(2)} of $${budget.limit.toFixed(2)}`))
  rows.push(kv(ctx, 'session spend', spend === undefined ? 'n/a — Claude Code did not report a cost' : `$${spend.toFixed(3)}`))
  rows.push(kv(ctx, 'context', state.usage?.contextPercent === undefined ? 'n/a' : `${Math.round(state.usage.contextPercent)}% of the window`))

  if (budget === undefined) {
    rows.push(kv(ctx, 'budget', state.ruflo.snapshot === null ? 'n/a — ruflo-mods not seated' : 'none set (ruflo-mods costBudgetUsd = 0)'))
  } else {
    const used = budget.usd ?? spend
    const color = budget.level === 'OK' || budget.level === 'INFO' ? THEME.ok : budget.level === 'WARNING' ? THEME.warn : THEME.bad

    rows.push(kv(ctx, 'budget', `${budget.level} · ${used === undefined ? 'n/a' : `$${used.toFixed(2)}`} of $${budget.limit.toFixed(2)} (${used === undefined ? 'n/a' : pct(used / budget.limit)})`, color))
    if (used !== undefined) rows.push(text(ctx, `${' '.repeat(17)}${ladder(used, budget.limit, Math.min(40, ctx.columns - 20))}  50·75·90·100%`, { color }))
  }

  rows.push(rule(ctx, 'Burn', `${state.history.spend.length} samples since the console loaded`))
  rows.push(picture(ctx, 'burn', `spend since load: ${state.history.spend.map(sample => `$${sample.value.toFixed(2)}`).join(' ') || 'n/a'}`))
  rows.push(text(ctx, 'gauge: needle at spend / limit, arc green to 50%, amber to 90%, red past · burn: each change of spend Claude Code reported', { dimColor: true }))

  return col(ctx, rows, 'cost')
}
