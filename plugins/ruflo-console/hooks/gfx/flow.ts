/**
 * The claims flow: five lanes left to right (open tasks → claimed → working → done, and stealable), one card per claim
 * with a ring and a handoff arrow where one is pending. Pure: `flowModelOf` reads the snapshot, `flowPicture` draws it
 * for an instant on the real clock. The ring is data: time left to `expiresAt` where ruflo set one, else the claim's
 * age on a 24 h scale; an expired claim's ring blinks.
 */
import type { AgentRecord, ClaimRecord, TaskRecord } from '../data/parse'
import { COLOR, Grid, mix } from './raster'

export const LANES = ['open', 'claimed', 'working', 'done', 'stealable'] as const
export type LaneId = (typeof LANES)[number]

export const LANE_TITLES: Record<LaneId, string> = { open: 'open tasks', claimed: 'claimed', working: 'working', done: 'done', stealable: 'stealable' }

export type FlowCard = { id: string; owner: string; lane: LaneId; claimedAtMs?: number; expiresAtMs?: number; handoffTo?: string; progress?: number }

const DAY = 86_400_000
const RINGS = ['○', '◔', '◑', '◕', '●'] as const

/** The lane a claim stands in: ruflo's statuses folded into the five lanes. */
export function laneOf(claim: ClaimRecord): LaneId {
  if (claim.isStealable) return 'stealable'
  if (claim.status === 'completed') return 'done'
  if (claim.status === 'active' && (claim.progress ?? 0) === 0) return 'claimed'

  return 'working'
}

/** Cards for the lanes; a handoff names its target by the agent's name where the store has one. */
export function flowModelOf(claims: readonly ClaimRecord[], openTasks: readonly TaskRecord[], agents: readonly AgentRecord[] = []): FlowCard[] {
  const nameOf = (id: string) => agents.find(agent => agent.id === id)?.name ?? agents.find(agent => agent.id === id)?.type ?? id

  return [
    ...openTasks.slice(0, 40).map(task => ({ id: task.id, owner: task.description || task.type, lane: 'open' as const })),
    ...claims.slice(0, 200).map(claim => ({
      id: claim.issueId,
      owner: claim.claimant.agentType ?? claim.claimant.name ?? claim.claimant.id,
      lane: laneOf(claim),
      ...(claim.claimedAtMs !== undefined && { claimedAtMs: claim.claimedAtMs }),
      ...(claim.expiresAtMs !== undefined && { expiresAtMs: claim.expiresAtMs }),
      ...(claim.handoffTo !== undefined && { handoffTo: nameOf(claim.handoffTo) }),
      ...(claim.progress !== undefined && { progress: claim.progress }),
    })),
  ]
}

/** The ring of a card at `nowMs`: its glyph, colour and words. */
export function ringOf(card: FlowCard, nowMs: number): { glyph: string; color: number; words: string; isExpired: boolean } {
  if (card.expiresAtMs !== undefined && card.claimedAtMs !== undefined && card.expiresAtMs > card.claimedAtMs) {
    const left = card.expiresAtMs - nowMs
    const fraction = Math.max(0, Math.min(1, left / (card.expiresAtMs - card.claimedAtMs)))

    return { glyph: RINGS[Math.round(fraction * 4)] as string, color: fraction < 0.2 ? COLOR.bad : fraction < 0.5 ? COLOR.warn : COLOR.ok, words: left > 0 ? `ttl ${Math.ceil(left / 1000)}s` : 'expired', isExpired: left <= 0 }
  }

  if (card.claimedAtMs === undefined) return { glyph: '·', color: COLOR.dim, words: '', isExpired: false }

  const age = Math.max(0, nowMs - card.claimedAtMs)

  return { glyph: RINGS[Math.min(4, Math.floor((age / DAY) * 4))] as string, color: mix(COLOR.info, COLOR.warn, Math.min(1, age / DAY)), words: '', isExpired: false }
}

/** Rows the flow needs for these cards: a header and two rows per card in the fullest lane, at most `maxCards`. */
export function flowRows(cards: readonly FlowCard[], maxCards = 6): number {
  const fullest = Math.max(1, ...LANES.map(lane => cards.filter(card => card.lane === lane).length))

  return 1 + 2 * Math.min(maxCards, fullest) + 1
}

export function flowPicture(cards: readonly FlowCard[], columns: number, rows: number, nowMs: number): Grid {
  const grid = new Grid(columns, rows)
  const width = Math.max(6, Math.floor(columns / LANES.length))
  const maxCards = Math.max(0, Math.floor((rows - 2) / 2))
  const blink = Math.floor(nowMs / 500) % 2 === 0

  LANES.forEach((lane, li) => {
    const x0 = li * width
    const inLane = cards.filter(card => card.lane === lane)
    const title = `${LANE_TITLES[lane]} ${inLane.length}`

    grid.text(x0, 0, title.slice(0, width - 2), lane === 'stealable' ? COLOR.warn : lane === 'done' ? COLOR.ok : COLOR.accent)
    if (li < LANES.length - 1) grid.text(x0 + width - 2, 0, '▸', COLOR.line)
    for (let y = 1; y < rows && li > 0; y++) grid.set(x0 - 1, y, '│', COLOR.line)

    inLane.slice(0, maxCards).forEach((card, ci) => {
      const y = 1 + ci * 2
      const ring = ringOf(card, nowMs)
      const inner = width - 3

      grid.set(x0, y, ring.isExpired && blink ? ' ' : ring.glyph, ring.color)
      grid.text(x0 + 2, y, card.id.slice(0, inner), lane === 'stealable' ? COLOR.warn : 0xd0d0d0)

      if (card.handoffTo !== undefined) {
        const target = `→ ${card.handoffTo}`

        grid.text(x0 + 1, y + 1, '╰─▶', COLOR.warn)
        grid.text(x0 + 4, y + 1, target.slice(2, 2 + inner - 3), COLOR.warn)
      } else {
        grid.text(x0 + 2, y + 1, `${card.owner}${card.progress !== undefined && card.progress > 0 ? ` ${card.progress}%` : ''}`.slice(0, inner), COLOR.dim)
      }
    })

    if (inLane.length > maxCards) grid.text(x0, rows - 1, `+${inLane.length - maxCards} more`.slice(0, width - 2), COLOR.dim)
  })

  return grid
}
