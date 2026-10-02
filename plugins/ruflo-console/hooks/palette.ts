/**
 * The command palette: every action the console can take, as a flat list filtered by a fuzzy query. Pure: it builds
 * entries from the state; the controller runs the one picked. Text-taking entries (route, store, search) read their
 * argument from the query after their keyword: `route fix the login bug`.
 */
import { claimTask, handoffClaim, releaseClaim, stealClaim, type ActionSpec } from './actions'
import { AGENT_TYPES, agentLogs, dispatchWorker, harnessAudit, harnessScore, memorySearch, memoryStore, reroute, setClaimStatus, spawnAgent, stopAgent, swarmInit, swarmStop, vote, WORKERS } from './ops'
import { VIEWS, type State, type ViewId } from './state'
import { selection } from './views/select'

export type PaletteRun =
  | { kind: 'spec'; spec: ActionSpec | null; why: string }
  | { kind: 'view'; view: ViewId }
  | { kind: 'drill'; agentId: string }
  | { kind: 'text'; keyword: string; make: (text: string) => ActionSpec | null }
  | { kind: 'command'; name: 'refresh' | 'help' | 'close' }

export type PaletteEntry = { id: string; label: string; group: string; run: PaletteRun }

/** A subsequence match score: higher is better, null when the query's letters are not all there in order. */
export function fuzzy(query: string, label: string): number | null {
  const q = query.trim().toLowerCase()
  const text = label.toLowerCase()

  if (q === '') return 0

  let at = 0
  let score = 0
  let streak = 0

  for (const ch of q) {
    if (ch === ' ') continue

    const found = text.indexOf(ch, at)

    if (found < 0) return null

    streak = found === at ? streak + 1 : 0
    score += 1 + streak * 2 - Math.min(5, found - at) * 0.1 + (found === 0 || text[found - 1] === ' ' ? 2 : 0)
    at = found + 1
  }

  // A contiguous match beats a scattered one, most of all at a word's start.
  const whole = text.indexOf(q)

  return whole < 0 ? score : score + 5 + (whole === 0 || text[whole - 1] === ' ' ? 3 : 0)
}

const TEXT_KEYWORDS = ['route', 'store', 'search'] as const

/** Every entry for the state as it is, before filtering. */
export function paletteEntries(state: State, nowMs: number): PaletteEntry[] {
  const { claim, agent, task } = selection(state)
  const out: PaletteEntry[] = []
  const add = (id: string, group: string, label: string, run: PaletteRun) => out.push({ id, group, label, run })

  if (agent !== null) {
    const name = agent.name ?? agent.type

    add('agent-drill', 'agent', `open ${name}: role, task, claims, logs, timeline`, { kind: 'drill', agentId: agent.id })
    add('agent-logs', 'agent', `show the logs of ${name}`, { kind: 'spec', spec: agentLogs(agent), why: 'that agent id cannot be passed to ruflo' })
    add('agent-stop', 'agent', `stop agent ${name}`, { kind: 'spec', spec: stopAgent(agent), why: 'that agent id cannot be passed to ruflo' })
  }

  if (claim !== null) {
    const paused = claim.status === 'paused'

    add('claim-pause', 'claims', `${paused ? 'resume' : 'pause'} the claim on ${claim.issueId}`, { kind: 'spec', spec: setClaimStatus(claim, paused ? 'active' : 'paused'), why: 'that claim cannot be passed to ruflo' })
    add('claim-release', 'claims', `release ${claim.issueId}`, { kind: 'spec', spec: releaseClaim(claim), why: 'that claimant cannot be named to ruflo' })

    if (agent !== null) {
      add('claim-handoff', 'claims', `hand ${claim.issueId} off to ${agent.name ?? agent.type}`, { kind: 'spec', spec: handoffClaim(claim, agent), why: 'the picked agent already holds it, or an id cannot be passed' })
      add('claim-steal', 'claims', `steal ${claim.issueId} for ${agent.name ?? agent.type}`, { kind: 'spec', spec: stealClaim(claim, agent), why: claim.isStealable ? 'the picked agent already holds it' : 'the claim is not marked stealable' })
    }
  }

  if (task !== null && agent !== null) add('task-claim', 'claims', `claim task ${task.id} for ${agent.name ?? agent.type}`, { kind: 'spec', spec: claimTask(task, agent), why: 'an id cannot be passed to ruflo' })

  for (const type of AGENT_TYPES) add(`spawn-${type}`, 'swarm', `spawn ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} agent`, { kind: 'spec', spec: spawnAgent(type, nowMs), why: 'unknown agent type' })

  add('swarm-init', 'swarm', 'start a swarm: init hierarchical, max 8, specialized', { kind: 'spec', spec: swarmInit(), why: '' })
  add('swarm-stop', 'swarm', 'stop the swarm', { kind: 'spec', spec: swarmStop(), why: '' })

  for (const proposal of state.snapshot?.hive?.pending.slice(-3) ?? []) {
    add(`vote-yes-${proposal.id}`, 'hive', `vote yes on ${proposal.type} (${proposal.id})`, { kind: 'spec', spec: vote(proposal.id, true), why: 'that proposal id cannot be passed to ruflo' })
    add(`vote-no-${proposal.id}`, 'hive', `vote no on ${proposal.type} (${proposal.id})`, { kind: 'spec', spec: vote(proposal.id, false), why: 'that proposal id cannot be passed to ruflo' })
  }

  add('mh-score', 'metaharness', 'score the harness now (metaharness score)', { kind: 'spec', spec: harnessScore(), why: '' })
  add('mh-audit', 'metaharness', 'run a MetaHarness audit (oia-audit)', { kind: 'spec', spec: harnessAudit(), why: '' })

  for (const worker of WORKERS) add(`worker-${worker}`, 'workers', `dispatch the ${worker} background worker`, { kind: 'spec', spec: dispatchWorker(worker), why: 'unknown worker' })

  add('route', 'learning', 'route <task words>: ask the router for a pick', { kind: 'text', keyword: 'route', make: reroute })
  add('store', 'memory', 'store <text>: save a note in memory namespace console', { kind: 'text', keyword: 'store', make: text => memoryStore(text, nowMs) })
  add('search', 'memory', 'search <query>: semantic memory search', { kind: 'text', keyword: 'search', make: memorySearch })

  for (const view of VIEWS) add(`view-${view.id}`, 'views', `go to ${view.label} (${view.key})`, { kind: 'view', view: view.id })

  add('refresh', 'console', 'refresh now', { kind: 'command', name: 'refresh' })
  add('help', 'console', 'help: keys and commands', { kind: 'command', name: 'help' })
  add('close', 'console', 'close the console', { kind: 'command', name: 'close' })

  return out
}

/** The entries matching `query`, best first; a text entry matches when the query starts with its keyword. */
export function filterPalette(entries: readonly PaletteEntry[], query: string, context: 'all' | 'selection'): PaletteEntry[] {
  const words = query.trim()
  const keyword = words.split(/\s+/)[0]?.toLowerCase() ?? ''
  const scoped = context === 'selection' ? entries.filter(entry => entry.group === 'agent' || entry.group === 'claims') : entries

  if ((TEXT_KEYWORDS as readonly string[]).includes(keyword) && words.length > keyword.length) {
    return scoped.filter(entry => entry.run.kind === 'text' && entry.run.keyword === keyword)
  }

  return scoped
    .flatMap(entry => {
      const score = fuzzy(words, entry.label)

      return score === null ? [] : [{ entry, score }]
    })
    .sort((a, b) => b.score - a.score)
    .map(match => match.entry)
}

/** The argument a text entry takes from the query: everything after its keyword. */
export const textOfQuery = (query: string, keyword: string): string => query.trim().slice(keyword.length).trim()
