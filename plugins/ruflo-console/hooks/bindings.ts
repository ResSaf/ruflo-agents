/**
 * The closures the pane's buttons and `/ruflo` subcommands call: view switches, selection, the claims buttons, the
 * palette. Each does its work through the runner or the controller functions it is handed; nothing here touches `$`.
 */
import { claimTask, handoffClaim, releaseClaim, stealClaim, whyNot } from './actions'
import { EVENT_KINDS } from './data/events'
import { plain } from './data/parse'
import type { Host } from './host'
import { filterPalette, paletteEntries } from './palette'
import type { Runner } from './runner'
import type { State } from './state'
import type { Actions } from './views/common'
import { openTasks, selection } from './views/select'

export type Steps = {
  freshRead: () => Promise<void>
  probe: (force?: boolean) => Promise<void>
  setView: (view: State['view']) => void
  drill: (agentId: string) => void
  close: () => Promise<void>
}

export function actionsOf(state: State, host: Host, runner: Runner, steps: Steps): Actions {
  const { freshRead, probe, setView, drill, close } = steps

  /** j/k: what moves depends on the view in front. */
  function select(by: number): void {
    const view = state.view
    const key = view === 'claims' ? 'claim' : view === 'swarm' || view === 'timeline' || view === 'agent' ? 'agent' : 'item'

    state.select[key] += by

    const next = view === 'agent' ? selection(state).agent : null

    // In the drill-down, j/k walks to the next agent and asks for its logs.
    if (next !== null) drill(next.id)
    host.invalidate()
  }

  const actions: Actions = {
    view: setView,
    refresh: () => void freshRead().then(() => probe(true)),
    help: () => {
      state.isHelp = !state.isHelp
      host.invalidate()
    },
    close: () => void close(),
    back: () => setView(state.view === 'agent' ? state.back : 'overview'),
    confirm: () => void runner.confirm(),
    cancel: runner.cancel,
    select,
    agentNext: () => {
      state.select.agent += 1
      host.invalidate()
    },
    taskNext: () => {
      state.select.task += 1
      host.invalidate()
    },
    drill: () => {
      const agent = selection(state).agent

      if (agent !== null) drill(agent.id)
    },
    claim: () => {
      const { agent, task, claim } = selection(state)

      runner.ask(task !== null && agent !== null ? claimTask(task, agent) : null, whyNot('claim', claim, agent, openTasks(state)[0] ?? task))
    },
    release: () => {
      const { claim, agent, task } = selection(state)

      runner.ask(claim !== null ? releaseClaim(claim) : null, whyNot('release', claim, agent, task))
    },
    handoff: () => {
      const { claim, agent, task } = selection(state)

      runner.ask(claim !== null && agent !== null ? handoffClaim(claim, agent) : null, whyNot('handoff', claim, agent, task))
    },
    steal: () => {
      const { claim, agent, task } = selection(state)

      runner.ask(claim !== null && agent !== null ? stealClaim(claim, agent) : null, whyNot('steal', claim, agent, task))
    },
    palette: context => {
      state.palette = { isOpen: !state.palette.isOpen || state.palette.context !== context, query: '', index: 0, context }
      state.isHelp = false
      host.invalidate()
    },
    paletteQuery: text => {
      state.palette.query = plain(text, 200)
      state.palette.index = 0
      host.invalidate()
    },
    paletteRun: id => {
      const entry = paletteEntries(state, Date.now()).find(candidate => candidate.id === id)

      if (entry !== undefined) runner.runEntry(entry, entry.run.kind === 'text' ? state.palette.query.trim().slice(entry.run.keyword.length).trim() : '')
    },
    paletteSubmit: () => {
      const best = filterPalette(paletteEntries(state, Date.now()), state.palette.query, state.palette.context)[0]

      if (best !== undefined) runner.runEntry(best, best.run.kind === 'text' ? state.palette.query.trim().slice(best.run.keyword.length).trim() : '')
    },
    run: (id, text = '') => runner.runById(id, text),
    filter: () => {
      const order = ['all', ...EVENT_KINDS] as const
      const at = order.indexOf(state.eventFilter)

      state.eventFilter = order[(at + 1) % order.length] ?? 'all'
      host.invalidate()
    },
  }

  return actions
}
