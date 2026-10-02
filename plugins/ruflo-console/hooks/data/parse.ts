/**
 * Readers for the swarm files ruflo writes under `.claude-flow/` and `.swarm/`.
 *
 * Vendored from plugins/ruflo-swarm/hooks/reader/parse.ts (a mod may import only its own files), cut to what the console
 * draws, with the claim record extended by its timestamps and context. Every one takes text another process wrote, so
 * each tolerates any shape: what it cannot read is left out, never guessed. Nothing here keeps the hive's `hiveToken`.
 */

/** Text longer than this is not parsed: a store that size is not one the CLI wrote, and parsing it would stall a hook. */
export const MAX_TEXT = 4_000_000
/** At most this many records of one kind are kept; the rest are counted, not drawn. */
export const MAX_RECORDS = 1_000

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/

/** Plain printable text of at most `max` characters: no control or bidi-override characters reach the terminal. */
export function plain(value: unknown, max = 200): string {
  if (typeof value !== 'string') {
    return ''
  }

  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()

  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, Math.max(0, max - 1))}…`
}

/** An id as ruflo mints them (`agent-…`, `swarm-…`, `proposal-…`), or null: only such a string ever reaches an argv. */
export function idOf(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null
}

export const numberOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
export const stringOf = (value: unknown, max = 80): string | undefined => (typeof value === 'string' && value !== '' ? plain(value, max) || undefined : undefined)
export const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** JSON text to a plain object, or null for anything else (too long, malformed, an array, a scalar). */
export function jsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length > MAX_TEXT) {
    return null
  }

  try {
    return recordOf(JSON.parse(text))
  } catch {
    return null
  }
}

export const valuesOf = (value: unknown): unknown[] => {
  const record = recordOf(value)

  return record === null ? [] : Object.values(record).slice(0, MAX_RECORDS)
}

/** An ISO time to epoch milliseconds, or undefined. */
export const msOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN

  return Number.isFinite(parsed) ? parsed : undefined
}

export type SwarmInfo = { id: string; topology: string; status: string; maxAgents?: number; strategy?: string; agentIds: string[]; updatedAt?: string }
export type AgentRecord = { id: string; type: string; name?: string; status: string; health?: number; taskCount?: number; createdAtMs?: number }
export type TaskRecord = { id: string; type: string; description: string; status: string; assignedTo: string[]; createdAtMs?: number }
export type Claimant = { kind: 'agent' | 'human'; id: string; agentType?: string; name?: string }
export type ClaimRecord = {
  issueId: string
  status: string
  claimant: Claimant
  progress?: number
  handoffTo?: string
  isStealable: boolean
  claimedAtMs?: number
  changedAtMs?: number
  /** ruflo's claim type declares `expiresAt`, but no claims tool sets it today: absent means no TTL, not an expired one. */
  expiresAtMs?: number
  context?: string
}
export type Proposal = { id: string; type: string; status: string; strategy: string; votesFor: number; votesAgainst: number }
export type Decision = { id: string; type: string; result: string; votesFor: number; votesAgainst: number }
export type HiveInfo = { topology: string; strategy?: string; queen?: string; workers: string[]; pending: Proposal[]; history: Decision[] }

/** `.claude-flow/swarm/swarm-state.json`: the running swarm, else the one updated last. */
export function parseSwarmStore(text: string | null): SwarmInfo | null {
  const swarms = valuesOf(jsonObject(text)?.swarms).flatMap(entry => {
    const swarm = recordOf(entry)
    const id = idOf(swarm?.swarmId)

    if (swarm === null || id === null) {
      return []
    }

    const config = recordOf(swarm.config)
    const info: SwarmInfo = {
      id,
      topology: stringOf(swarm.topology, 40) ?? 'unknown',
      status: stringOf(swarm.status, 40) ?? 'unknown',
      agentIds: (Array.isArray(swarm.agents) ? swarm.agents : []).slice(0, MAX_RECORDS).flatMap(agent => {
        const agentId = idOf(agent) ?? idOf(recordOf(agent)?.agentId) ?? idOf(recordOf(agent)?.id)

        return agentId !== null ? [agentId] : []
      }),
    }
    const maxAgents = numberOf(swarm.maxAgents)
    const strategy = stringOf(config?.strategy, 40)
    const updatedAt = stringOf(swarm.updatedAt, 40)

    if (maxAgents !== undefined) info.maxAgents = maxAgents
    if (strategy !== undefined) info.strategy = strategy
    if (updatedAt !== undefined) info.updatedAt = updatedAt

    return [info]
  })
  const byRecency = (a: SwarmInfo, b: SwarmInfo) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')

  return [...swarms.filter(swarm => swarm.status === 'running')].sort(byRecency)[0] ?? [...swarms].sort(byRecency)[0] ?? null
}

/** `.swarm/state.json`: the pointer `swarm init` (or `swarm start`) leaves. */
export function parseSwarmPointer(text: string | null): { id: string; topology?: string; strategy?: string; status?: string } | null {
  const value = jsonObject(text)
  const id = idOf(value?.id) ?? idOf(value?.swarmId)

  if (value === null || id === null) {
    return null
  }

  const pointer: { id: string; topology?: string; strategy?: string; status?: string } = { id }
  const topology = stringOf(value.topology, 40)
  const strategy = stringOf(value.strategy, 40)
  const status = stringOf(value.status, 40)

  if (topology !== undefined) pointer.topology = topology
  if (strategy !== undefined) pointer.strategy = strategy
  if (status !== undefined) pointer.status = status

  return pointer
}

/** `.claude-flow/agents/store.json`. */
export function parseAgents(text: string | null): AgentRecord[] {
  return valuesOf(jsonObject(text)?.agents).flatMap(entry => {
    const agent = recordOf(entry)
    const id = idOf(agent?.agentId)

    if (agent === null || id === null) {
      return []
    }

    const record: AgentRecord = { id, type: stringOf(agent.agentType, 40) ?? 'agent', status: stringOf(agent.status, 20) ?? 'unknown' }
    const name = stringOf(agent.name, 40)
    const health = numberOf(agent.health)
    const taskCount = numberOf(agent.taskCount)
    const createdAtMs = msOf(agent.createdAt)

    if (name !== undefined) record.name = name
    if (health !== undefined) record.health = health
    if (taskCount !== undefined) record.taskCount = taskCount
    if (createdAtMs !== undefined) record.createdAtMs = createdAtMs

    return [record]
  })
}

/** `.claude-flow/tasks/store.json`. */
export function parseTasks(text: string | null): TaskRecord[] {
  return valuesOf(jsonObject(text)?.tasks).flatMap(entry => {
    const task = recordOf(entry)
    const id = idOf(task?.taskId)

    return task === null || id === null
      ? []
      : [
          {
            id,
            type: stringOf(task.type, 40) ?? 'task',
            description: plain(task.description, 200),
            status: stringOf(task.status, 20) ?? 'unknown',
            assignedTo: (Array.isArray(task.assignedTo) ? task.assignedTo : []).slice(0, 50).flatMap(agent => (idOf(agent) !== null ? [agent as string] : [])),
            ...(msOf(task.createdAt) !== undefined && { createdAtMs: msOf(task.createdAt) }),
          },
        ]
  })
}

function claimantOf(value: unknown): Claimant | null {
  const claimant = recordOf(value)

  if (claimant === null) {
    return null
  }

  const isAgent = claimant.type === 'agent'
  const id = idOf(isAgent ? claimant.agentId : claimant.userId)

  if (id === null) {
    return null
  }

  const who: Claimant = { kind: isAgent ? 'agent' : 'human', id }
  const agentType = stringOf(claimant.agentType, 40)
  const name = stringOf(claimant.name, 40)

  if (agentType !== undefined) who.agentType = agentType
  if (name !== undefined) who.name = name

  return who
}

/** `.claude-flow/claims/claims.json`: issue claims (who works on what), not the authorization file `.claude-flow/claims.json`. */
export function parseClaims(text: string | null): ClaimRecord[] {
  const store = jsonObject(text)
  const stealable = recordOf(store?.stealable) ?? {}

  return valuesOf(store?.claims).flatMap(entry => {
    const claim = recordOf(entry)
    const issueId = idOf(claim?.issueId)
    const claimant = claimantOf(claim?.claimant)

    if (claim === null || issueId === null || claimant === null) {
      return []
    }

    const handoff = recordOf(claim.handoffTo)
    const handoffTo = idOf(handoff?.agentId ?? handoff?.userId)
    const record: ClaimRecord = {
      issueId,
      status: stringOf(claim.status, 30) ?? 'unknown',
      claimant,
      isStealable: claim.status === 'stealable' || Object.hasOwn(stealable, issueId),
    }
    const progress = numberOf(claim.progress)
    const claimedAtMs = msOf(claim.claimedAt)
    const changedAtMs = msOf(claim.statusChangedAt)
    const expiresAtMs = msOf(claim.expiresAt)
    const context = stringOf(claim.context, 120)

    if (progress !== undefined) record.progress = Math.max(0, Math.min(100, progress))
    if (handoffTo !== null) record.handoffTo = handoffTo
    if (claimedAtMs !== undefined) record.claimedAtMs = claimedAtMs
    if (changedAtMs !== undefined) record.changedAtMs = changedAtMs
    if (expiresAtMs !== undefined) record.expiresAtMs = expiresAtMs
    if (context !== undefined) record.context = context

    return [record]
  })
}

const votesOf = (value: unknown): { votesFor: number; votesAgainst: number } => {
  const votes = valuesOf(value)

  return { votesFor: votes.filter(vote => vote === true).length, votesAgainst: votes.filter(vote => vote === false).length }
}

/** `.claude-flow/hive-mind/state.json`, without its capability token. */
export function parseHive(text: string | null): HiveInfo | null {
  const hive = jsonObject(text)

  if (hive === null || hive.initialized !== true) {
    return null
  }

  const queen = idOf(recordOf(hive.queen)?.agentId)
  const consensus = recordOf(hive.consensus)
  const pending = (Array.isArray(consensus?.pending) ? consensus.pending : []).slice(-50).flatMap(entry => {
    const proposal = recordOf(entry)
    const id = idOf(proposal?.proposalId)

    return proposal === null || id === null
      ? []
      : [
          {
            id,
            type: stringOf(proposal.type, 40) ?? 'proposal',
            status: stringOf(proposal.status, 20) ?? 'pending',
            strategy: stringOf(proposal.strategy, 20) ?? 'unknown',
            ...votesOf(proposal.votes),
          },
        ]
  })
  const history = (Array.isArray(consensus?.history) ? consensus.history : []).slice(-50).flatMap(entry => {
    const decision = recordOf(entry)
    const id = idOf(decision?.proposalId)
    const votes = recordOf(decision?.votes)

    return decision === null || id === null
      ? []
      : [{ id, type: stringOf(decision.type, 40) ?? 'proposal', result: stringOf(decision.result, 20) ?? 'unknown', votesFor: numberOf(votes?.for) ?? 0, votesAgainst: numberOf(votes?.against) ?? 0 }]
  })
  const info: HiveInfo = {
    topology: stringOf(hive.topology, 40) ?? 'unknown',
    workers: (Array.isArray(hive.workers) ? hive.workers : []).slice(0, MAX_RECORDS).flatMap(worker => (idOf(worker) !== null ? [worker as string] : [])),
    pending,
    history,
  }
  const strategy = stringOf(hive.consensusStrategy, 30)

  if (strategy !== undefined) info.strategy = strategy
  if (queen !== null) info.queen = queen

  return info
}
