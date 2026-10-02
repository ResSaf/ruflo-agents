import type { TestBody } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { MISSION_OBSERVATION } from './fixtures/missions'
import { HIVE_TOKEN, RUFLO_FILES } from './fixtures/ruflo-run'
import { command, elementsOf, fakeRuflo, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

const HOME_FILES = {
  '.claude/plugins/installed_plugins.json': JSON.stringify({
    version: 2,
    plugins: {
      'ruflo-core@ruflo': [{ scope: 'user', version: '0.2.6', lastUpdated: '2026-07-30T12:06:11.791Z' }],
      'ruflo-swarm@ruflo': [{ scope: 'user', version: '0.2.1' }],
    },
  }),
  '.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/.claude/plugins/marketplaces/ruflo', lastUpdated: '2026-09-03T18:45:31.282Z', autoUpdate: true } }),
  '.claude/plugins/marketplaces/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ name: 'ruflo', plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
}

type Engine = Parameters<TestBody>[0]

/** Opens the console on `view` via /ruflo, waits for its probes, and answers its drawing and its Raster keys. */
async function drawn($: Engine, view: string, columns = 110) {
  await $.command.run(command(view))
  await $.command.run(command('status'))

  const pane = await $.ui.mount({ ...paneAt(columns), plugin: PLUGIN })
  const tree = await pane.drawn()

  await pane.unmount()

  return { text: textOf(tree), tree, rasters: elementsOf(tree, 'Raster').map(keyOf) }
}

describe('views', () => {
  test('overview: every subsystem from disk, the CLI or the engine, health alerts, the activity raster', async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'overview')

    expect(rasters).toEqual(['header', 'activity'])
    expect(text).toContain('v3.50.0 (npx-offline)')
    expect(text).toContain('running per daemon-state.json')
    expect(text).toContain('1 ruflo server connected (plugin_ruflo-core_ruflo) · 2 tools callable now')
    expect(text).toContain('manifest v3.32.24')
    expect(text).toContain('seated · policy observe · routed 4')
    expect(text).toContain('swarm-1790903031804-y9rnjr · hierarchical · running · 2 agents')
    expect(text).toContain('marketplace clone stale: no ruflo-mods — /plugin marketplace update ruflo')
    expect(text).toContain('budget WARNING: $3.90 of $5.00')
  })

  test('swarm: the topology graph, selectable agents, the hive with its proposal, no hive token', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'swarm')

    expect(rasters).toEqual(['header', 'topology'])
    expect(text).toContain('hierarchical · specialized · running · max 6')
    expect(text).toMatch(/▸● \ncoder\s+coder\s+idle/)
    expect(text).toContain('design (raft) pending · for 0 · against 0')
    expect(text).not.toContain(HIVE_TOKEN)
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['agent-next', 'agent-prev', 'drill', 'palette', 'actions']))
  })

  test('claims: the flow diagram with lanes and rings, the board, and the act row', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters, tree } = await drawn($, 'claims')

    expect(rasters).toEqual(['header', 'flow'])
    expect(text).toContain('1 active · 1 stealable · 0 handoff')
    expect(text).toContain('no claims tool sets a TTL today')
    expect(text).toMatch(/console-demo-2.*stealable/)
    expect(elementsOf(tree, 'Button').map(keyOf)).toEqual(expect.arrayContaining(['claim', 'release', 'handoff', 'steal', 'agent-next', 'task-next']))
  })

  test('federation: the map, local identity and channels; the relay is never asked while the option is off', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'federation')

    expect(rasters).toEqual(['header', 'fedmap'])
    expect(text).toContain('agentbbs agentbbs-not-found')
    expect(text).toContain('Off: the roster is on the public relay')
    expect(world.runs.some(argv => argv.join(' ').includes('x_federation_roster'))).toBe(false)
  })

  test('plugins: the health matrix, and a clone without ruflo-mods reads STALE with the fix named', async ($, on) => {
    worldOf(on, RUFLO_FILES, { home: HOME_FILES })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'plugins')

    expect(rasters).toEqual(['header', 'health'])
    expect(text).toContain('STALE: the clone does not list ruflo-mods')
    expect(text).toContain('2 ruflo · 1 enabled · 2 total')
  })

  test('learning: last route, outcome rate with its N, the curve, the four-stage pipeline, pattern growth', async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'learning')

    expect(rasters).toEqual(['header', 'curve', 'pipeline', 'patterns'])
    expect(text).toContain('tester 60% · keyword match')
    expect(text).toMatch(/\d+\/9 succeeded \(\d+% success rate, N=9\)/)
    expect(text).toContain('consolidate: EWC consolidations')
  })

  test('metaharness: the radar, the audit trend, the flywheel ledger and the active policy', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const { text, rasters } = await drawn($, 'metaharness')

    expect(rasters).toEqual(['header', 'radar', 'trend'])
    expect(text).toContain('$0.024')
    expect(text).toContain('valid · 0 commits · 0 receipts')
  })

  test('memory and cost: entries, a namespace sample; spend, the gauge, the ladder and the burn', async ($, on) => {
    fakeRuflo().register(on, {})
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    const memory = await drawn($, 'memory')

    expect(memory.text).toContain('1 · 0 with vectors')
    expect(memory.text).toMatch(/console\s+█+ 1/)

    const cost = await drawn($, 'cost')

    expect(cost.rasters).toEqual(['header', 'gauge', 'burn'])
    expect(cost.text).toContain('$0.421')
    expect(cost.text).toContain('WARNING · $3.90 of $5.00 (78%)')
  })

  test('timeline, approvals and events draw from what was seen; the drill-down opens an agent', async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await drawn($, 'timeline')).rasters).toEqual(['header', 'gantt'])

    const approvals = await drawn($, 'approvals')

    expect(approvals.text).toContain('[proposal] hive-mind proposal: design (raft)')
    expect(approvals.text).toContain('[stealable] claim console-demo-2 offered for stealing')

    const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, Record<string, unknown>> }

    ;(Object.values(store.agents)[1] as Record<string, unknown>).status = 'busy'
    world.put('.claude-flow/agents/store.json', JSON.stringify(store))
    await $.command.run(command('status'))
    expect((await drawn($, 'events')).text).toContain('agent tester: idle → busy')

    await $.command.run(command('agent tester'))

    const agent = await drawn($, 'agent agent-1790903032591-x41b0y')

    expect(agent.text).toContain('tester · tester')
    expect(agent.text).toContain('console-demo-2 stealable')
    expect(world.runs.some(argv => argv.join(' ').includes('agent logs --id agent-1790903032591-x41b0y --tail 20'))).toBe(true)
  })

  test('missions: the ADR-406 observation, task status as recorded, evidence as verified, nothing invented', async ($, on) => {
    worldOf(on, { ...RUFLO_FILES, '.claude-flow/missions/observation.json': MISSION_OBSERVATION })
    mock.clock(on)
    await $.session.start(SESSION)

    const { text } = await drawn($, 'missions')

    expect(text).toContain('Ship a verified artifact')
    expect(text).toContain('planned · rev 2 · session-bound')
    expect(text).toContain('○ produce → ○ evaluate → ○ verify')
    expect(text).toContain('evidence 0/0 verified · budget $0.00 settled, $0.00 reserved of $10.00 (estimate $1.00)')
    expect(text).not.toMatch(/[\u001b\u202e]/)
  })

  test('missions: no observation file reads n/a with how to start one', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)

    expect((await drawn($, 'missions')).text).toContain('n/a — no .claude-flow/missions/observation.json')
  })
})
