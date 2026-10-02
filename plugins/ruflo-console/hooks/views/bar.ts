/**
 * The band above the prompt: one row naming what ruflo is doing here, with a mark that pulses while Claude works.
 * Each part is a fact on disk or n/a; a part with nothing to say is left out rather than shown as zero.
 */
import type { RenderElement } from 'claude-code'

import type { State } from '../state'
import { clip, count, type Kit } from './common'

export const BAR_KEY = 'mark'

/** The band's words, shortest-first droppable parts last. */
export function barText(state: State): string {
  const snap = state.snapshot
  const parts = ['ruflo']

  if (snap?.swarm != null) parts.push(`${snap.swarm.topology} ${snap.agents.filter(agent => /busy|active/i.test(agent.status)).length}/${snap.swarm.agentIds.length || snap.agents.length} busy`)

  const claims = snap?.claims ?? []

  if (claims.length > 0) {
    const stealable = claims.filter(claim => claim.isStealable).length

    parts.push(`${claims.length} claim${claims.length === 1 ? '' : 's'}${stealable > 0 ? ` (${stealable} stealable)` : ''}`)
  }

  if (snap?.neural?.patterns !== undefined) parts.push(`${count(snap.neural.patterns)} patterns`)
  if (state.ruflo.route !== null) parts.push(`→ ${state.ruflo.route.agent}`)
  if (snap?.plugins.missingFromClone.length) parts.push('marketplace STALE')
  if (state.usage?.costUsd !== undefined) parts.push(`$${state.usage.costUsd.toFixed(2)}`)

  return parts.join(' · ')
}

export function barView(kit: Kit, state: State, columns: number, mark: RenderElement | null, onOpen: () => void): RenderElement {
  const words = barText(state)
  const room = Math.max(8, columns - (state.pane.isOpen ? 14 : 30))

  return kit.Box({
    flexDirection: 'row',
    children: [
      ...(mark !== null ? [mark] : [kit.Text({ color: 'claude', children: '◆ ' })]),
      kit.Text({ wrap: 'truncate-end', ...(state.snapshot?.plugins.missingFromClone.length ? { color: 'warning' } : { dimColor: true }), children: clip(words, room) }),
      kit.Text({ children: ' ' }),
      ...(state.pane.isOpen ? [] : [kit.Text({ dimColor: true, children: '/ruflo to open ' })]),
      kit.Button({ key: 'open-console', label: 'console', plain: true, onPress: onOpen }),
    ],
  })
}
