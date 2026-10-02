import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, SESSION, worldOf } from './fixtures/world'

/** Every palette action that changes something: the selection it needs, and the head of the argv it must run. */
const CASES: { id: string; setup?: string[]; text?: string; head: string[] }[] = [
  { id: 'task-claim', head: ['mcp', 'exec', '-t', 'claims_claim'] },
  { id: 'claim-release', head: ['mcp', 'exec', '-t', 'claims_release'] },
  { id: 'claim-pause', head: ['mcp', 'exec', '-t', 'claims_status'] },
  { id: 'claim-handoff', setup: ['swarm', 'next'], head: ['mcp', 'exec', '-t', 'claims_handoff'] },
  { id: 'claim-steal', setup: ['claims', 'next'], head: ['mcp', 'exec', '-t', 'claims_steal'] },
  { id: 'agent-stop', head: ['agent', 'stop', 'agent-1790903032181-97m25s'] },
  { id: 'spawn-tester', head: ['agent', 'spawn', '--type', 'tester'] },
  { id: 'swarm-init', head: ['swarm', 'init', '--topology', 'hierarchical', '--max-agents', '8', '--strategy', 'specialized'] },
  { id: 'swarm-stop', head: ['swarm', 'stop'] },
  { id: 'vote-no-proposal-1790903321981-23aov7', head: ['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', 'proposal-1790903321981-23aov7', '--vote', 'no'] },
  { id: 'mh-audit', head: ['metaharness', 'oia-audit'] },
  { id: 'worker-optimize', head: ['hooks', 'worker', 'dispatch', '--trigger', 'optimize'] },
  { id: 'store', text: 'remember the login fix', head: ['memory', 'store', '--key'] },
]

describe('every confirm-gated action', () => {
  for (const entry of CASES) {
    test(`${entry.id}: asks first, runs nothing until yes, then exactly its fixed argv`, async ($, on) => {
      const world = worldOf(on, RUFLO_FILES)
      mock.clock(on)
      await $.session.start(SESSION)

      for (const step of entry.setup ?? []) await $.command.run(command(step))

      const before = world.runs.length
      const asked = await $.command.run(command(`run ${entry.id}${entry.text !== undefined ? ` ${entry.text}` : ''}`))

      expect(asked.text).toMatch(/^Asked: /)
      expect(world.runs.slice(before).filter(argv => argv.join(' ').includes(entry.head.slice(0, 2).join(' ')))).toHaveLength(0)

      await $.command.run(command('yes'))

      const ran = world.runs.slice(before).filter(argv => argv.slice(4, 4 + entry.head.length).join(' ') === entry.head.join(' '))

      expect(ran).toHaveLength(1)
      expect(ran[0]?.slice(0, 4)).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest'])
    })
  }
})
