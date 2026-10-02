/**
 * Every diagram keeps its size across time (a blit must match the mounted Raster), counts on the real clock where its
 * motion is data, and stays inside the frame budget at 100 agents. Pure: run with `npx vitest run plugins/ruflo-console`.
 */
import { describe, expect, it } from 'vitest'

import { gaugePicture, pipelinePicture, radarPicture, samplesPicture, trendPicture } from '../hooks/gfx/charts'
import { flowModelOf, flowPicture, flowRows, ringOf } from '../hooks/gfx/flow'
import { federationPicture, ganttPicture, heatmapPicture } from '../hooks/gfx/maps'
import { activityPicture, curvePicture, edges, headerPicture, layout, markPicture, topologyPicture, type TopoModel } from '../hooks/gfx/pictures'
import type { Grid } from '../hooks/gfx/raster'
import { parseClaims, type ClaimRecord } from '../hooks/data/parse'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const glyphs = (grid: Grid, y = 0) => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y))).join('')
const claims = parseClaims(RUFLO_FILES['.claude-flow/claims/claims.json'] ?? null)
const swarmOf = (n: number, topology: string, busyEvery = 3): TopoModel => ({
  topology,
  nodes: [{ id: 'q', label: 'queen', status: 'leader', isLeader: true }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `a${i}`, label: `agent-${i}`, status: i % busyEvery === 0 ? 'busy' : 'idle', isLeader: false, pulseAtMs: 1_000 }))],
})

/** Every diagram, drawn at instant `t`, at a fixed size per diagram. */
function all(t: number): [string, Grid, number, number][] {
  const cards = flowModelOf(claims, [])

  return [
    ['topology', topologyPicture(swarmOf(4, 'hierarchical'), 90, 12, t), 90, 12],
    ['topology-mesh', topologyPicture(swarmOf(8, 'mesh'), 90, 14, t), 90, 14],
    ['activity', activityPicture([{ label: 'a', values: [1, 2, 3] }, { label: 'b', values: [] }], 80, t), 80, 2],
    ['curve', curvePicture([true, false, true], 80, 6, t, 500), 80, 6],
    ['mark', markPicture(true, t), 2, 1],
    ['header', headerPicture('◆ ruflo · proj', 40, t), 40, 1],
    ['flow', flowPicture(cards, 100, flowRows(cards), t), 100, flowRows(cards)],
    ['pipeline', pipelinePicture([{ name: 'RETRIEVE', count: 30_797, source: '' }, { name: 'JUDGE', count: 9, source: '' }, { name: 'DISTILL', count: null, source: '' }, { name: 'CONSOLIDATE', count: 0, source: '' }], 100, t, [null, 900, null, null]), 100, 4],
    ['radar', radarPicture([42, 12, 35, 90, 6].map((value, i) => ({ name: `d${i}`, value })), 80, 13, t, 0), 80, 13],
    ['trend', trendPicture([0, 2, 1, 3], 80, 4, 4, { top: 'critical', bottom: 'clean', empty: 'n/a' }), 80, 4],
    ['gauge', gaugePicture(3.9, 5, 60, 9), 60, 9],
    ['burn', samplesPicture('spend', [{ value: 0.1 }, { value: 0.4 }], 80), 80, 1],
    ['fedmap', federationPicture('this node', [{ label: 'peer-a', trust: 'pinned', trafficAtMs: 0 }, { label: '#ops', trust: 'channel' }, { label: 'npub1x', trust: 'roster' }], 80, 11, t), 80, 11],
    ['health', heatmapPicture([{ name: 'core', cells: [true, true, true, null] }, { name: 'mods', cells: [false, null, false, true] }], ['installed', 'enabled', 'clone', 'mod'], 80, 5), 80, 5],
    ['gantt', ganttPicture([{ label: 'coder', spans: [{ fromMs: 0, toMs: 500, busy: true }], ticks: [200] }], 80, 0, 1_000), 80, 2],
  ]
}

describe('diagrams', () => {
  it('every diagram keeps its size across t, so every frame fits the mounted Raster', () => {
    for (const t of [0, 1_234, 99_999]) {
      for (const [name, grid, columns, rows] of all(t)) {
        expect([name, grid.columns, grid.rows]).toEqual([name, columns, rows])
        expect(grid.encode().length, name).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
      }
    }
  })

  it('the topology lays out a tree, a ring and a mesh from the real topology, and wraps a large swarm into tiers', () => {
    expect(edges(swarmOf(5, 'hierarchical'))).toEqual([[0, 1], [0, 2], [0, 3], [0, 4]])
    expect(edges(swarmOf(4, 'ring'))).toEqual([[0, 1], [1, 2], [2, 3], [3, 0]])
    expect(edges(swarmOf(4, 'mesh'))).toHaveLength(6)
    expect(edges(swarmOf(100, 'mesh'))).toHaveLength(300)

    const tiers = new Set(layout(swarmOf(100, 'hierarchical'), 220, 96).slice(1).map(point => Math.round(point.y)))

    expect(tiers.size).toBeGreaterThan(1)
  })

  it('an event pulse is data: it runs only in the 1.4 s after its event, and the frames differ while it does', () => {
    const model = swarmOf(3, 'hierarchical', 99)
    const frame = (t: number) => topologyPicture(model, 60, 12, t).encode()

    expect(frame(1_300)).not.toBe(frame(1_900))
    // Before the event, at two instants where the heartbeat (decoration) rests: nothing else moves.
    expect(frame(0)).toBe(frame(Math.PI * 260))
  })

  it('claims fall in their lanes and a ring counts down a TTL on the real clock, else fills with age', () => {
    expect(flowModelOf(claims, []).map(card => [card.id, card.lane])).toEqual([
      ['console-demo-1', 'claimed'],
      ['console-demo-2', 'stealable'],
    ])

    const ttl = { id: 'c', owner: 'coder', lane: 'claimed' as const, claimedAtMs: 0, expiresAtMs: 100_000 }

    expect(ringOf(ttl, 10_000)).toMatchObject({ glyph: '●', words: 'ttl 90s', isExpired: false })
    expect(ringOf(ttl, 80_000)).toMatchObject({ glyph: '◔', isExpired: false })
    expect(ringOf(ttl, 200_000)).toMatchObject({ words: 'expired', isExpired: true })
    expect(ringOf({ ...ttl, expiresAtMs: undefined }, 12 * 3_600_000).glyph).toBe('◑')

    const handoff: ClaimRecord = { issueId: 'h1', status: 'handoff-pending', claimant: { kind: 'agent', id: 'a', agentType: 'coder' }, isStealable: false, handoffTo: 'tester-1' }

    expect(glyphs(flowPicture(flowModelOf([handoff], []), 100, 4, 0), 2)).toContain('╰─▶tester-1')
  })

  it('the gauge has no needle without a budget, and the learning stages print n/a for what nothing measures', () => {
    expect(glyphs(gaugePicture(1, null, 60, 9), 8)).toContain('no budget set')
    expect(glyphs(gaugePicture(3.9, 5, 60, 9), 8)).toContain('$3.90 of $5.00 (78%)')
    expect(glyphs(pipelinePicture([{ name: 'DISTILL', count: null, source: '' }], 40, 0, [null]), 2)).toContain('n/a')
  })

  it('a frame of the 100-agent topology stays within the 4 ms budget (median of 50)', () => {
    const model = swarmOf(100, 'hierarchical')
    const times: number[] = []

    for (let i = 0; i < 50; i++) {
      const start = performance.now()

      topologyPicture(model, 160, 24, i * 83).encode()
      times.push(performance.now() - start)
    }

    times.sort((a, b) => a - b)
    expect(times[25]).toBeLessThan(4)
  })
})
