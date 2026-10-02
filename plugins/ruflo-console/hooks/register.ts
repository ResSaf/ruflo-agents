import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { createController, type Controller } from './controller'
import { record } from './data/events'
import { plain } from './data/parse'
import { dispatch } from './dispatch'
import { markPicture } from './gfx/pictures'
import type { Host } from './host'
import { newState, PANE_ID, restore, storeKeyOf } from './state'
import { BAR_KEY, barView } from './views/bar'
import type { Kit } from './views/common'
import { picturesOf } from './views/frames'
import { NARROW, paneView } from './views/pane'

const RUFLO_TOOL = /^mcp__(claude-flow|ruflo|plugin_ruflo[\w-]*)__/

/**
 * Binds a Host from `$`, every member spelled `$.noun.method(...)` here and nowhere else, so the engine reads what
 * the module calls off this one place. Calls that answer nothing are wrapped: a refused draw is not a crashed hook.
 */
function hostOf($: EngineInterface, cwd: string): Host {
  const rooted = (path: string) => (path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`)
  const quietly = (fn: () => unknown) => {
    try {
      const result = fn()

      if (result instanceof Promise) result.catch(() => undefined)
    } catch {
      // Refused: there is nothing to do about a draw nobody may make.
    }
  }

  return {
    fs: { read: async path => $.fs.read(rooted(path)), stat: async path => $.fs.stat(rooted(path)), list: async path => $.fs.list(rooted(path)) },
        every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    storeGet: async key => $.store.get(key),
    storeSet: async (key, value) => $.store.set(key, value as never),
    invalidate: () => quietly(() => $.ui.invalidate('ui.render')),
    blit: args => quietly(() => $.ui.blit(args)),
    openPane: async pane => $.ui.open(pane),
    closePane: async id => $.ui.close({ id }),
    panes: async () => $.ui.panes(),
    registerCommand: async spec => $.command.register(spec),
    run: async (argv, timeoutMs) => $.process.run(argv, { cwd, timeoutMs }),
    usage: async () => {
      const usage = await $.session.usage()

      return { ...(usage.cost?.usd !== undefined && { costUsd: usage.cost.usd }), ...(usage.context?.percent !== undefined && { contextPercent: usage.context.percent }) }
    },
    rufloTools: async () => {
      const names = (await $.tool.list()).flatMap(tool => RUFLO_TOOL.exec(tool.name)?.slice(1, 2) ?? [])

      return { tools: names.length, servers: [...new Set(names)].sort() }
    },
    settings: async () => $.settings.read(),
    home: async () => $.env.get('HOME'),
    configDir: async () => $.env.get('CLAUDE_CONFIG_DIR'),
    pluginRoot: $.plugin.root,
    // `$.ruflo` exists only where ruflo-mods is seated; validate refuses feature-detecting a noun, so these are
    // async: a missing noun throws inside the promise and every caller's catch sees a rejection.
    rufloSnapshot: async () => $.ruflo.snapshot(),
    rufloRoute: async () => $.ruflo.lastRoute(),
    rufloSegment: async text => $.ruflo.segment({ id: 'console', text }),
  }
}

/**
 * ruflo-console: ruflo's cockpit inside Claude Code, and the home of `/ruflo`. A pane of views over ruflo's state on
 * disk and the ruflo CLI's local answers, a band above the prompt, a command palette, and management views (agent
 * drill-down, timeline, approvals, events). Every change goes through the ruflo CLI with fixed argv after a confirm.
 */
export const register: Register = (on, raw: PluginOptions) => {
  const state = newState(raw)
  let host: Host | null = null
  let control: Controller | null = null

  on('session.start', async ($, e, next) => {
    control?.stop()
    host = hostOf($, e.cwd)
    state.cwd = e.cwd
    state.isInteractive = e.isInteractive !== false
    control = createController(state, host)

    const bound = host

    state.home = (await bound.home().catch(() => undefined)) ?? null
    state.configDir = (await bound.configDir().catch(() => undefined)) ?? (state.home === null ? null : `${state.home}/.claude`)
    await Promise.all([
      bound
        .registerCommand({ name: 'ruflo', description: 'ruflo: the cockpit (views, palette, agents, approvals) and every ruflo mod command — /ruflo help', argumentHint: '[view|palette|agent <id>|mods|swarm <sub>|help]' })
        .catch(() => undefined),
      // Kept for good (ADR-406: no command is removed or renamed): `/ruflo-console` is the same command as `/ruflo`.
      bound.registerCommand({ name: 'ruflo-console', description: 'Same as /ruflo: the ruflo console', argumentHint: '[view|palette|help]' }).catch(() => undefined),
      bound.storeGet(storeKeyOf(e.cwd)).then(value => restore(state, value), () => undefined),
      bound.rufloTools().then(counted => void (state.rufloTools = counted), () => undefined),
    ])
    control.start()
    await control.refresh()
    control.autoOpen()

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    control?.stop()

    return next(e)
  })

  /**
   * `/ruflo`: the console's own subcommands are answered here; `mods` and `swarm <sub>` go to the plugins beneath that
   * hook the same command (ruflo-mods, ruflo-swarm), and are answered with a hint when neither does.
   */
  on('command.run', { command: 'ruflo' }, async ($, e, next) => {
    if (control === null) return next(e)

    return dispatch(control, state, e.args, async () => (await next(e)) as { text?: string } | undefined)
  })

  /** `/ruflo-console` is the same command: ruflo-mods and ruflo-swarm hook it as they hook `/ruflo`. */
  on('command.run', { command: 'ruflo-console' }, async ($, e, next) => {
    if (control === null) return next(e)

    return dispatch(control, state, e.args, async () => (await next(e)) as { text?: string } | undefined)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    if (control === null) {
      return next(e)
    }

    const started = Date.now()
    const table = $.ui.resolve(e) as unknown as Kit
    const columns = Math.max(20, Math.floor(Number(e.props.bodyColumns) || 0) - 1)
    const isNarrow = columns < NARROW
    const kit: Kit = isNarrow ? { Box: table.Box, Text: table.Text, Button: table.Button, ...(table.Input !== undefined && { Input: table.Input }) } : table

    state.pane.isOpen = true
    state.pane.isFocused = e.props.isFocused === true
    state.pane.columns = columns
    state.pane.placement = e.props.placement
    // A reload while the pane stayed up: timers are gone, so resume them from here.
    if (!state.timers.has('watch')) control.resume()

    const pictures = isNarrow ? new Map() : picturesOf(state, columns, Date.now(), Date.now())

    state.mounted = new Map([...pictures].map(([key, grid]) => [key, { columns: grid.columns, rows: grid.rows }]))
    control.animate()

    state.pane.rows = Math.max(0, Math.floor(Number(e.props.scroll?.bodyRows) || 0))

    const tree = paneView({ kit, state, nowMs: Date.now(), columns, pictures, act: control.actions })

    state.stats.renders.push(Date.now() - started)
    if (state.stats.renders.length > 200) state.stats.renders.shift()

    return tree
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const show = state.options.bar === 'on' || (state.options.bar === 'auto' && state.snapshot?.isRufloProject === true)

    if (control === null || e.props.hasSurvey || !show) {
      return next(e)
    }

    const table = $.ui.resolve(e) as unknown as Kit
    const bound = control

    state.barDrawnAtMs = Date.now()

    const mark = table.Raster !== undefined ? table.Raster(markPicture(e.props.isWorking, Date.now()).toRaster(BAR_KEY)) : null

    bound.markFrame(e.requestId, e.props.isWorking && mark !== null)

    return barView(table, state, Math.floor(Number(e.props.bodyColumns) || 80), mark, () => void bound.open(false))
  })

  /** The band's mark pulses during a turn: a redraw at its start, and the loop stopped at its end, whatever redraws. */
  on('turn.start', ($, e, next) => {
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // A refused redraw leaves the mark at rest.
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) control?.markFrame('', false)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)

    if (e.id === PANE_ID && result.deny === undefined) {
      state.pane.isOpen = false
      state.pane.isShown = false
      if (e.origin.kind === 'person') control?.closedByPerson()
      control?.animate()
    }

    return result
  })

  /** Observes only: every call goes on unchanged; the count feeds the activity sparkline. */
  on('tool.call', ($, e, next) => {
    control?.noteToolCall(e.agentId, e.tool)

    return next(e)
  })

  /** Observes only: a deny any verdict reached is listed in the approvals queue; the verdict passes on unchanged. */
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)

    if (verdict.decision === 'deny') {
      state.denied.push({ tool: plain(String(e.tool), 40), reason: plain(verdict.reason ?? 'no reason given', 160), atMs: Date.now() })
      if (state.denied.length > 20) state.denied.shift()
      record(state.events, [{ atMs: Date.now(), kind: 'mods', text: `${plain(String(e.tool), 40)} denied: ${plain(verdict.reason ?? '', 80)}` }])
    }

    return verdict
  })

  /** Observes only, never refuses: which mods the engine admitted or refused after the console, for the plugins view. */
  on('plugin.register', async ($, e, next) => {
    const result = await next(e)

    state.mods.push({ name: plain(e.name, 40), provenance: plain(e.provenance, 80), isLoaded: result.refuse === undefined, ...(result.refuse !== undefined && { reason: plain(result.refuse, 120) }), atMs: Date.now() })
    if (state.mods.length > 50) state.mods.shift()
    record(state.events, [{ atMs: Date.now(), kind: 'mods', text: `${plain(e.name, 40)} ${result.refuse === undefined ? 'loaded' : 'REFUSED'} (${plain(e.provenance, 60)})` }])

    return result
  })
}
