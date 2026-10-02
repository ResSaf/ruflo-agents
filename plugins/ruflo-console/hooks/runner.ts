/**
 * Runs what the person asked for: a palette entry, a claims button, an approval. A change waits for a confirm (y, or
 * `/ruflo yes`) and then runs one fixed argv through the ruflo CLI, after which the disk is re-read to say whether it
 * took; a read runs at once and shows what it printed. Nothing reaches `$` but through the Host.
 */
import type { ActionSpec } from './actions'
import { plain } from './data/parse'
import type { Host } from './host'
import { outputLines } from './ops'
import { filterPalette, paletteEntries, textOfQuery, type PaletteEntry } from './palette'
import { CLI_PREFIXES, type State } from './state'

const PENDING_TTL_MS = 30_000

export type RunnerDeps = {
  /** A read of the disk that starts after this call. */
  freshRead: () => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  command: (name: 'refresh' | 'help' | 'close') => void
}

export type Runner = {
  ask: (spec: ActionSpec | null, why: string) => void
  confirm: () => Promise<void>
  cancel: () => void
  runEntry: (entry: PaletteEntry, text: string) => void
  runById: (id: string, text: string) => boolean
}

export function createRunner(state: State, host: Host, deps: RunnerDeps): Runner {
  let pendingSpec: ActionSpec | null = null

  const say = (label: string, ok: boolean, detail: string, lines?: string[]) => {
    state.outcome = { label, ok, verified: 'n/a', detail, atMs: Date.now(), ...(lines !== undefined && { lines }) }
    host.invalidate()
  }

  async function execute(spec: ActionSpec): Promise<void> {
    state.isActing = true
    host.invalidate()

    try {
      const result = await host.run([...CLI_PREFIXES[state.options.cli], ...spec.args], 90_000)
      const answer = /"success"\s*:\s*(true|false)/.exec(result.stdout)?.[1]
      const error = /"error"\s*:\s*"([^"]{0,160})"/.exec(result.stdout)?.[1] ?? /\[ERROR\]\s*(.{0,160})/.exec(result.stdout)?.[1]
      const ok = result.exitCode === 0 && answer !== 'false' && error === undefined

      if (spec.isReadOnly === true) {
        say(spec.label, ok, ok ? 'the ruflo CLI answered:' : plain(error ?? result.stderr, 160) || `exit ${result.exitCode}`, outputLines(result.stdout))

        return
      }

      await deps.freshRead()

      const verified = spec.verify === undefined || state.snapshot === null ? 'n/a' : spec.verify(state.snapshot) ? 'yes' : 'no'

      state.outcome = {
        label: spec.label,
        ok: ok && verified !== 'no',
        verified,
        detail: ok ? `ruflo answered ok; expected ${spec.expect}` : plain(error ?? result.stderr, 160) || `exit ${result.exitCode}`,
        atMs: Date.now(),
      }
    } catch (error) {
      say(spec.label, false, plain(error instanceof Error ? error.message : String(error), 160) || 'refused')
    } finally {
      state.isActing = false
      host.invalidate()
    }
  }

  function ask(spec: ActionSpec | null, why: string): void {
    state.palette.isOpen = false

    if (spec === null) {
      say('nothing to do', false, why)

      return
    }

    if (spec.isReadOnly === true) {
      void execute(spec)

      return
    }

    pendingSpec = spec
    state.pending = { label: spec.label, args: spec.args, expect: spec.expect, askedAtMs: Date.now() }
    host.invalidate()
  }

  async function confirm(): Promise<void> {
    const spec = pendingSpec
    const isFresh = state.pending !== null && Date.now() - state.pending.askedAtMs < PENDING_TTL_MS

    pendingSpec = null
    state.pending = null

    if (spec === null || !isFresh || state.isActing) {
      if (spec !== null && !isFresh) say(spec.label, false, 'the confirm came more than 30 s after the ask; ask again')

      host.invalidate()

      return
    }

    await execute(spec)
  }

  function cancel(): void {
    pendingSpec = null
    state.pending = null
    host.invalidate()
  }

  function runEntry(entry: PaletteEntry, text: string): void {
    state.palette.isOpen = false

    switch (entry.run.kind) {
      case 'spec':
        ask(entry.run.spec, entry.run.why)
        break
      case 'text':
        ask(entry.run.make(text), `type "${entry.run.keyword} <text>"; text may not start with -`)
        break
      case 'view':
        deps.setView(entry.run.view)
        break
      case 'drill':
        deps.drill(entry.run.agentId)
        break
      case 'command':
        deps.command(entry.run.name)
        break
    }

    host.invalidate()
  }

  /** A palette entry by its id (`/ruflo run <id> [text]`, an approval's button): false when there is none now. */
  function runById(id: string, text: string): boolean {
    const entries = paletteEntries(state, Date.now())
    const entry = entries.find(candidate => candidate.id === id) ?? (text === '' ? undefined : filterPalette(entries, `${id} ${text}`, 'all')[0])

    if (entry === undefined) return false

    runEntry(entry, entry.run.kind === 'text' ? textOfQuery(`${id} ${text}`, entry.run.keyword) : text)

    return true
  }

  return { ask, confirm, cancel, runEntry, runById }
}
