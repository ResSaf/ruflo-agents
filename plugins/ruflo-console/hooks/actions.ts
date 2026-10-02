/**
 * What the claims buttons ask ruflo to do, as fixed argv for `ruflo mcp exec -t claims_* -p <json>`: ids pass `idOf`,
 * the claimant strings are built here from parsed records, and the one JSON argument is `JSON.stringify`'s (an argv
 * element, never a shell string). Each spec says how the disk shows that it took, checked after the CLI exits.
 */
import { idOf, type AgentRecord, type ClaimRecord, type Claimant, type TaskRecord } from './data/parse'
import type { Snapshot } from './data/snapshot'

export type ActionSpec = {
  label: string
  args: readonly string[]
  expect: string
  verify?: (snapshot: Snapshot) => boolean
  /** Reads only: runs at once, without the confirm step, and shows what the CLI printed. */
  isReadOnly?: boolean
}

export const exec = (tool: string, params: Record<string, string>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const
const SAFE_WORD = /^[A-Za-z0-9_.-]{1,40}$/

/** `agent:<id>:<type>` or `human:<id>:<name>`, the forms ruflo's claims tools parse; null when a part would not survive it. */
export function claimantOf(who: Claimant): string | null {
  const id = idOf(who.id)
  const tail = who.kind === 'agent' ? who.agentType : who.name

  return id === null || id.includes(':') || tail === undefined || !SAFE_WORD.test(tail) ? null : `${who.kind}:${id}:${tail}`
}

export const agentClaimant = (agent: AgentRecord): string | null => claimantOf({ kind: 'agent', id: agent.id, agentType: agent.type })

export function claimTask(task: TaskRecord, agent: AgentRecord): ActionSpec | null {
  const issueId = idOf(task.id)
  const who = agentClaimant(agent)

  return issueId === null || who === null
    ? null
    : {
        label: `claim ${issueId} for ${agent.name ?? agent.type}`,
        args: exec('claims_claim', { issueId, claimant: who }),
        expect: 'the claim in .claude-flow/claims/claims.json',
        verify: snapshot => snapshot.claims.some(claim => claim.issueId === issueId && claim.claimant.id === agent.id),
      }
}

export function releaseClaim(claim: ClaimRecord): ActionSpec | null {
  const issueId = idOf(claim.issueId)
  const who = claimantOf(claim.claimant)

  return issueId === null || who === null
    ? null
    : {
        label: `release ${issueId} held by ${claim.claimant.agentType ?? claim.claimant.name ?? claim.claimant.id}`,
        args: exec('claims_release', { issueId, claimant: who, reason: 'released from ruflo-console' }),
        expect: 'the claim gone from claims.json',
        verify: snapshot => !snapshot.claims.some(entry => entry.issueId === issueId),
      }
}

export function handoffClaim(claim: ClaimRecord, to: AgentRecord): ActionSpec | null {
  const issueId = idOf(claim.issueId)
  const from = claimantOf(claim.claimant)
  const target = agentClaimant(to)

  return issueId === null || from === null || target === null || claim.claimant.id === to.id
    ? null
    : {
        label: `hand ${issueId} to ${to.name ?? to.type}`,
        args: exec('claims_handoff', { issueId, from, to: target, reason: 'handed off from ruflo-console' }),
        expect: 'a pending handoff on the claim',
        verify: snapshot => snapshot.claims.some(entry => entry.issueId === issueId && (entry.handoffTo === to.id || entry.claimant.id === to.id)),
      }
}

export function stealClaim(claim: ClaimRecord, by: AgentRecord): ActionSpec | null {
  const issueId = idOf(claim.issueId)
  const stealer = agentClaimant(by)

  return issueId === null || stealer === null || !claim.isStealable || claim.claimant.id === by.id
    ? null
    : {
        label: `steal ${issueId} for ${by.name ?? by.type}`,
        args: exec('claims_steal', { issueId, stealer }),
        expect: 'the claim held by the picked agent',
        verify: snapshot => snapshot.claims.some(entry => entry.issueId === issueId && entry.claimant.id === by.id),
      }
}

/** Why a button has nothing to act on, in the words the footer shows. */
export function whyNot(action: 'claim' | 'release' | 'handoff' | 'steal', claim: ClaimRecord | null, agent: AgentRecord | null, task: TaskRecord | null): string {
  if (action === 'claim') return task === null ? 'no unclaimed task to claim' : agent === null ? 'no agent to claim it for' : 'that task id or agent cannot be passed to ruflo'
  if (claim === null) return 'no claim picked'
  if (action === 'release') return 'that claimant cannot be named to ruflo'
  if (agent === null) return 'no agent picked (a)'
  if (agent.id === claim.claimant.id) return 'the picked agent already holds it'

  return action === 'steal' && !claim.isStealable ? 'the claim is not marked stealable' : 'that claim cannot be passed to ruflo'
}
