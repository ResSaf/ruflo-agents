/**
 * The facts that are not on disk, asked of the ruflo CLI with fixed argv and read from its JSON. Every probe here was run
 * against @claude-flow/cli 3.50.0 and is local: none reaches the network except `roster`, which runs only when the
 * person turns `federationNetwork` on. `plugins list` is never run (it fetches the IPFS registry), nor `verify` (it
 * fetches a manifest from GitHub).
 */
import { msOf, numberOf, plain, recordOf, stringOf, valuesOf } from './parse'

import type { ViewId } from '../state'

export type { ViewId }

export type Probe<T> = {
  id: string
  args: readonly string[]
  /** The views that draw it: a probe runs only while one of them is in front (the overview's run with the bar too). */
  views: readonly ViewId[]
  everyMs: number
  timeoutMs: number
  isNetwork?: boolean
  parse: (stdout: string) => T | null
}

/** The JSON a CLI run printed: after `Result:` for `mcp exec`, else from the first line that opens an object or array. */
export function jsonAfter(stdout: string): unknown {
  const text = stdout.length > 1_000_000 ? stdout.slice(0, 1_000_000) : stdout
  const marker = text.indexOf('Result:')
  const from = marker >= 0 ? marker + 7 : 0
  const line = /^[ \t]*[[{]/m.exec(text.slice(from))
  const start = line === null ? -1 : from + line.index

  if (start < 0) {
    return null
  }

  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const objectOf = (stdout: string) => recordOf(jsonAfter(stdout))
const exec = (tool: string, params: Record<string, unknown>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const

export const versionProbe: Probe<string> = {
  id: 'version',
  args: ['--version'],
  views: ['overview'],
  everyMs: 600_000,
  timeoutMs: 30_000,
  parse: stdout => /v?(\d+\.\d+\.\d+[\w.-]*)/.exec(stdout)?.[1] ?? null,
}

export type MemoryStats = { backend: string; total?: number; vectors?: number; storage?: string; oldestMs?: number; newestMs?: number }

export const memoryProbe: Probe<MemoryStats> = {
  id: 'memory',
  args: ['memory', 'stats', '--format', 'json'],
  views: ['overview', 'memory', 'cost'],
  everyMs: 30_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const entries = recordOf(value.entries)
    const stats: MemoryStats = { backend: stringOf(value.backend, 60) ?? 'unknown' }
    const total = numberOf(entries?.total)
    const vectors = numberOf(entries?.vectors)
    const storage = stringOf(recordOf(value.storage)?.total, 30)
    const oldestMs = msOf(value.oldestEntry)
    const newestMs = msOf(value.newestEntry)

    if (total !== undefined) stats.total = total
    if (vectors !== undefined) stats.vectors = vectors
    if (storage !== undefined) stats.storage = storage
    if (oldestMs !== undefined) stats.oldestMs = oldestMs
    if (newestMs !== undefined) stats.newestMs = newestMs

    return stats
  },
}

export type Namespaces = { sampled: number; byName: { name: string; count: number }[] }

/** Namespaces of the newest 500 entries: a sample, and the view says so. */
export const namespacesProbe: Probe<Namespaces> = {
  id: 'namespaces',
  args: ['memory', 'list', '--format', 'json', '--limit', '500'],
  views: ['memory'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = jsonAfter(stdout)

    if (!Array.isArray(value)) {
      return null
    }

    const counts = new Map<string, number>()

    for (const entry of value.slice(0, 500)) {
      const name = stringOf(recordOf(entry)?.namespace, 40) ?? '(none)'

      counts.set(name, (counts.get(name) ?? 0) + 1)
    }

    return { sampled: Math.min(500, value.length), byName: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12) }
  },
}

export type HarnessScore = { dims: { name: string; value: number }[]; costUsd?: number; archetype?: string; scaffoldReady?: boolean; constraints?: string; atMs?: number }

const DIMS = ['harnessFit', 'compileConfidence', 'taskCoverage', 'toolSafety', 'memoryUsefulness'] as const

export const scoreProbe: Probe<HarnessScore> = {
  id: 'metaharness',
  args: ['metaharness', 'score', '--format', 'json'],
  views: ['metaharness'],
  everyMs: 120_000,
  timeoutMs: 60_000,
  parse: stdout => {
    const value = objectOf(stdout)
    const dims = DIMS.flatMap(name => {
      const score = numberOf(value?.[name])

      return score === undefined ? [] : [{ name, value: Math.max(0, Math.min(100, score)) }]
    })

    if (value === null || dims.length === 0) {
      return null
    }

    const score: HarnessScore = { dims }
    const costUsd = numberOf(value.estCostPerRunUsd)
    const archetype = stringOf(value.archetype, 40)
    const constraints = stringOf(value.hardConstraints, 10)
    const atMs = msOf(value.generatedAt)

    if (costUsd !== undefined) score.costUsd = costUsd
    if (archetype !== undefined) score.archetype = archetype
    if (typeof value.scaffoldReady === 'boolean') score.scaffoldReady = value.scaffoldReady
    if (constraints !== undefined) score.constraints = constraints
    if (atMs !== undefined) score.atMs = atMs

    return score
  },
}

export type Flywheel = { isLedgerValid: boolean; commits: number; receipts: number; champion?: string; epoch?: number; errors: string[] }

export const flywheelProbe: Probe<Flywheel> = {
  id: 'flywheel',
  args: exec('metaharness_flywheel', { op: 'receipts' }),
  views: ['metaharness'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const data = recordOf(objectOf(stdout)?.data)
    const state = recordOf(data?.state)
    const ledger = recordOf(data?.ledger)

    if (data === null || ledger === null) {
      return null
    }

    const flywheel: Flywheel = {
      isLedgerValid: ledger.valid === true,
      commits: numberOf(ledger.commits) ?? 0,
      receipts: Object.keys(recordOf(state?.receiptStates) ?? {}).length,
      errors: (Array.isArray(ledger.errors) ? ledger.errors : []).slice(0, 3).map(error => plain(error, 100)),
    }
    const champion = stringOf(state?.activeChampionRef, 80)
    const epoch = numberOf(state?.servingEpoch)

    if (champion !== undefined) flywheel.champion = champion
    if (epoch !== undefined) flywheel.epoch = epoch

    return flywheel
  },
}

export type AuditTrend = { total: number; points: { atMs: number; worst?: string; findings?: number }[] }

const SEVERITY: Record<string, number> = { clean: 0, low: 1, medium: 2, high: 3, critical: 4 }

/** Stored MetaHarness audits, oldest first: the trend line's points. Reads memory; runs nothing. */
export const auditProbe: Probe<AuditTrend> = {
  id: 'audits',
  args: ['metaharness', 'audit-list', '--format', 'json'],
  views: ['metaharness'],
  everyMs: 120_000,
  timeoutMs: 60_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null || !Array.isArray(value.records)) {
      return null
    }

    const points = value.records.slice(0, 50).flatMap(entry => {
      const record = recordOf(entry)
      const atMs = msOf(record?.timestamp ?? record?.generatedAt ?? record?.createdAt ?? recordOf(record?.value)?.generatedAt)
      const worst = stringOf(record?.worst ?? recordOf(record?.value)?.worst, 12)
      const findings = numberOf(record?.findings ?? recordOf(record?.value)?.findingCount)

      return atMs === undefined ? [] : [{ atMs, ...(worst !== undefined && { worst }), ...(findings !== undefined && { findings }) }]
    })

    points.sort((a, b) => a.atMs - b.atMs)

    return { total: numberOf(value.totalInNamespace) ?? points.length, points }
  },
}

/** A severity word as a 0-4 level, for the trend line; unknown words are null. */
export const severityOf = (word: string | undefined): number | null => (word === undefined ? null : (SEVERITY[word.toLowerCase()] ?? null))

export type Intelligence = { trajectories?: number; patterns?: number; successRate?: number; moeDecisions?: number; ewcConsolidations?: number; routerDecisions?: number; routerConfidence?: number; neuralRouter?: string }

export const intelligenceProbe: Probe<Intelligence> = {
  id: 'intelligence',
  args: exec('hooks_intelligence_stats', {}),
  views: ['learning'],
  everyMs: 30_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const sona = recordOf(value.sona)
    const router = recordOf(value.modelRouter)
    const neural = recordOf(value.neuralRouter)
    const routerDecisions = numberOf(router?.totalDecisions)
    const out: Intelligence = {}
    const trajectories = numberOf(sona?.trajectoriesTotal)
    const patterns = numberOf(sona?.patternsLearned)
    const successRate = numberOf(sona?.successRate)
    const moeDecisions = numberOf(recordOf(value.moe)?.routingDecisions)
    const ewc = numberOf(recordOf(value.ewc)?.consolidations)

    if (trajectories !== undefined) out.trajectories = trajectories
    if (patterns !== undefined) out.patterns = patterns
    if (successRate !== undefined && (trajectories ?? 0) > 0) out.successRate = successRate
    if (moeDecisions !== undefined) out.moeDecisions = moeDecisions
    if (ewc !== undefined) out.ewcConsolidations = ewc
    if (routerDecisions !== undefined) out.routerDecisions = routerDecisions
    // The tool answers a default confidence before the first decision: only a measured one is kept.
    if (routerDecisions !== undefined && routerDecisions > 0 && numberOf(router?.avgConfidence) !== undefined) out.routerConfidence = numberOf(router?.avgConfidence) as number
    if (neural !== null) out.neuralRouter = neural.enabled === true ? 'on' : `off (${plain(neural.reason, 40) || 'not enabled'})`

    return out
  },
}

export type Peers = { peers: { id: string; lastSyncMs?: number }[]; degraded?: string }

export const peersProbe: Probe<Peers> = {
  id: 'peers',
  args: exec('federation_bbs_peers', {}),
  views: ['federation'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const list = Array.isArray(value.peers) ? value.peers : valuesOf(value.peers)
    const peers = list.slice(0, 50).flatMap(entry => {
      const peer = recordOf(entry)
      const id = stringOf(peer?.nodeId ?? peer?.id ?? peer?.name, 40)
      const lastSyncMs = msOf(peer?.lastSyncAt ?? peer?.lastSync)

      return id === undefined ? [] : [{ id, ...(lastSyncMs !== undefined && { lastSyncMs }) }]
    })

    return value.degraded === true ? { peers, degraded: stringOf(value.reason, 60) ?? 'degraded' } : { peers }
  },
}

export type Channels = { channels: { id: string; name?: string; atMs?: number }[] }

/** The channel list answers ids, names and dates; the keys stay in ~/.ruflo/channels.json, which the console never reads. */
export const channelsProbe: Probe<Channels> = {
  id: 'channels',
  args: exec('x_federation_channel_list', {}),
  views: ['federation'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null || !Array.isArray(value.channels)) {
      return null
    }

    return {
      channels: value.channels.slice(0, 50).flatMap(entry => {
        const channel = recordOf(entry)
        const id = stringOf(channel?.channel, 24)
        const name = stringOf(channel?.name, 40)
        const atMs = msOf(channel?.at)

        return id === undefined ? [] : [{ id, ...(name !== undefined && { name }), ...(atMs !== undefined && { atMs }) }]
      }),
    }
  },
}

export type Roster = { members: { name: string; detail?: string }[]; relay?: string; atMs?: number }

/** Reaches wss://relay.ruv.io: runs only with `federationNetwork` on. What it returns is third parties' text. */
export const rosterProbe: Probe<Roster> = {
  id: 'roster',
  args: exec('x_federation_roster', {}),
  views: ['federation'],
  everyMs: 120_000,
  timeoutMs: 45_000,
  isNetwork: true,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const data = value.data
    const rows = Array.isArray(data) ? data : Object.entries(recordOf(data) ?? {}).map(([name, detail]) => ({ name, detail }))
    const relay = stringOf(value.relay, 60)
    const atMs = msOf(value.retrievedAt)

    return {
      members: rows.slice(0, 40).flatMap(entry => {
        const row = recordOf(entry)
        const name = stringOf(row?.name ?? row?.pubkey ?? row?.id, 32)
        const detail = typeof row?.detail === 'string' ? plain(row.detail, 60) : stringOf(recordOf(row?.detail)?.about, 60)

        return name === undefined ? [] : [{ name, ...(detail !== undefined && detail !== '' && { detail }) }]
      }),
      ...(relay !== undefined && { relay }),
      ...(atMs !== undefined && { atMs }),
    }
  },
}

export const PROBES = [versionProbe, memoryProbe, namespacesProbe, scoreProbe, flywheelProbe, auditProbe, intelligenceProbe, peersProbe, channelsProbe, rosterProbe] as const

export type ProbeId = (typeof PROBES)[number]['id']

/** What a probe came to: the last good value and when, and the last error, so a failing source is never drawn as live. */
export type ProbeResult<T = unknown> = { value: T | null; okAtMs: number | null; error: string | null; errorAtMs: number | null; isRunning: boolean }

export const emptyResult = (): ProbeResult => ({ value: null, okAtMs: null, error: null, errorAtMs: null, isRunning: false })
