import type { PluginOptions, Timer } from 'claude-code'

import type { ProbeResult } from './data/cli'
import type { ConsoleEvent } from './data/events'
import type { ReadCache } from './data/files'
import type { Snapshot } from './data/snapshot'
import type { RufloRoute, RufloSnapshot } from '../types'

export const PLUGIN_NAME = 'ruflo-console'
export const PANE_ID = 'ruflo-console'

export type ViewId = 'overview' | 'swarm' | 'claims' | 'federation' | 'plugins' | 'learning' | 'metaharness' | 'memory' | 'cost' | 'timeline' | 'approvals' | 'events' | 'missions' | 'agent'

/**
 * The views in tab order, each with its hotkey and the inline height it asks for. Digits are the first nine; the three
 * management views take letters no other control uses. `agent` is the drill-down, reached from a selection, not a tab.
 */
export const VIEWS: readonly { id: ViewId; key: string; label: string; short: string; rows: number }[] = [
  { id: 'overview', key: '1', label: 'Overview', short: 'Ovr', rows: 26 },
  { id: 'swarm', key: '2', label: 'Swarm', short: 'Swm', rows: 30 },
  { id: 'claims', key: '3', label: 'Claims', short: 'Clm', rows: 30 },
  { id: 'federation', key: '4', label: 'Federation', short: 'Fed', rows: 26 },
  { id: 'plugins', key: '5', label: 'Plugins', short: 'Plg', rows: 30 },
  { id: 'learning', key: '6', label: 'Learning', short: 'Lrn', rows: 30 },
  { id: 'metaharness', key: '7', label: 'MetaHarness', short: 'MH', rows: 26 },
  { id: 'memory', key: '8', label: 'Memory', short: 'Mem', rows: 22 },
  { id: 'cost', key: '9', label: 'Cost', short: 'Cst', rows: 20 },
  { id: 'timeline', key: 'g', label: 'Timeline', short: 'Gnt', rows: 24 },
  { id: 'approvals', key: 'q', label: 'Approvals', short: 'Apv', rows: 24 },
  { id: 'events', key: 'e', label: 'Events', short: 'Evt', rows: 26 },
  { id: 'missions', key: 'm', label: 'Missions', short: 'Msn', rows: 26 },
]

export const AGENT_VIEW = { id: 'agent' as const, rows: 28 }

export const rowsOf = (view: ViewId): number => (view === 'agent' ? AGENT_VIEW.rows : (VIEWS.find(entry => entry.id === view)?.rows ?? 24))

/** A view by id, digit, label, or a prefix of three letters or more. */
export const viewOf = (word: string): ViewId | null => {
  const lower = word.trim().toLowerCase()

  return VIEWS.find(view => view.id === lower || view.key === lower || view.label.toLowerCase() === lower || (lower.length >= 3 && view.id.startsWith(lower)))?.id ?? null
}

/**
 * `$.store` is the plugin's, not the folder's: the key carries the working directory, so a view chosen in one project
 * never follows the person into another (the ruflo-swarm leak).
 */
export const storeKeyOf = (cwd: string): string => `ruflo-console/ui:${cwd}`

/** How actions reach the ruflo CLI: each a fixed argv prefix. Only `npx` may download. */
export const CLI_PREFIXES = {
  'npx-offline': ['npx', '--offline', '-y', '@claude-flow/cli@latest'],
  npx: ['npx', '-y', '@claude-flow/cli@latest'],
  ruflo: ['ruflo'],
  'claude-flow': ['claude-flow'],
} as const satisfies Record<string, readonly string[]>

export type CliChoice = keyof typeof CLI_PREFIXES

export type Options = {
  cli: CliChoice
  /** How often the disk is re-read while the pane or band shows (seconds, 2-60). */
  refreshSeconds: number
  /** The animation's frame cap while the pane is shown and focused (0 turns motion off; at most 12). */
  fps: number
  /** `auto`: the band shows in a ruflo project; `on`: always; `off`: never. */
  bar: 'auto' | 'on' | 'off'
  /** `auto` opens the cockpit at session start where it can dock (never taking the keys); `command` only on /ruflo; `off` never. */
  panel: 'auto' | 'command' | 'off'
  /** Lets the federation view ask the public relay for the roster. Off by default: no network without consent. */
  federationNetwork: boolean
}

const num = (value: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : fallback
}

/** The options as the settings hold them, each one checked: a value the plugin does not know is its default. */
export function optionsOf(raw: PluginOptions | undefined): Options {
  const value = (raw ?? {}) as Record<string, unknown>

  return {
    cli: typeof value.cli === 'string' && value.cli in CLI_PREFIXES ? (value.cli as CliChoice) : 'npx-offline',
    refreshSeconds: num(value.refreshSeconds, 3, 2, 60),
    fps: num(value.fps, 8, 0, 12),
    bar: value.bar === 'on' || value.bar === 'off' ? value.bar : 'auto',
    panel: value.panel === 'command' || value.panel === 'off' ? value.panel : 'auto',
    federationNetwork: value.federationNetwork === true,
  }
}

/** A mutating action waiting for the person's second press. */
export type Pending = { label: string; args: readonly string[]; expect: string; askedAtMs: number }

/** What an action did: what ran, how it exited, whether the disk shows the change, and anything it printed to show. */
export type Outcome = { label: string; ok: boolean; verified: 'yes' | 'no' | 'n/a'; detail: string; atMs: number; lines?: string[] }

/** One module seen registering since the console loaded, as the engine's scan named it. */
export type ModSeen = { name: string; provenance: string; isLoaded: boolean; reason?: string; atMs: number }

/** A tool call refused by a permission verdict this session, as `tool.check` answered it. */
export type Denied = { tool: string; reason: string; atMs: number }

/** One sample of a measured series, with when it was taken. */
export type Sample = { atMs: number; value: number }

export type State = {
  options: Options
  cwd: string
  home: string | null
  /** Claude Code's config directory: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. Its plugin records are read from here. */
  configDir: string | null
  /** False in a session with no pane to show (claude -p, an SDK host): views are then answered as text. */
  isInteractive: boolean
  /** When this module loaded: "since the console loaded" series and stall times count from here. */
  loadedAtMs: number
  view: ViewId
  /** The view to go back to from the drill-down. */
  back: ViewId
  isHelp: boolean
  snapshot: Snapshot | null
  cache: ReadCache
  probes: Map<string, ProbeResult>
  ruflo: { snapshot: RufloSnapshot | null; route: RufloRoute | null; error: string | null }
  usage: { costUsd?: number; contextPercent?: number } | null
  rufloTools: { tools: number; servers: string[] } | null
  mods: ModSeen[]
  denied: Denied[]
  /** Tool calls the console saw, per 5 s bucket, newest last; and per agent (Claude Code's ids) for the timeline. */
  activity: number[]
  toolsByAgent: Map<string, { atMs: number; tool: string }[]>
  /** ruflo state files changed per refresh, newest last. */
  writes: number[]
  /** Measured series since the console loaded: patterns learned, session spend. */
  history: { patterns: Sample[]; spend: Sample[]; outcomes: number }
  events: ConsoleEvent[]
  /** Each ruflo agent's status as the console saw it change, oldest first: the timeline's spans. */
  statusLog: Map<string, { atMs: number; status: string }[]>
  eventFilter: 'all' | ConsoleEvent['kind']
  /** When the newest learning point arrived: the curve draws it in from there. */
  curveGrewAtMs: number
  pane: { isOpen: boolean; isShown: boolean; isFocused: boolean; columns: number; rows: number; placement: 'dock' | 'inline'; isClosedByPerson: boolean; autoTried: boolean; autoReason: string }
  /** The size of each Raster as last mounted, by key: a blit of any other size is refused, so none is sent. */
  mounted: Map<string, { columns: number; rows: number }>
  select: { claim: number; agent: number; task: number; item: number }
  /** The drill-down's agent and what `agent logs` printed for it. */
  drill: { agentId: string | null; logs: string[] | null; logsAtMs: number }
  palette: { isOpen: boolean; query: string; index: number; context: 'all' | 'selection' }
  pending: Pending | null
  outcome: Outcome | null
  isActing: boolean
  isRefreshing: boolean
  /** When the band above the prompt last drew: the disk is re-read on the fast cadence only while it is seen. */
  barDrawnAtMs: number
  timers: Map<string, Timer>
  stats: { renders: number[]; refreshes: number[]; frames: number[] }
}

export function newState(raw: PluginOptions | undefined): State {
  return {
    options: optionsOf(raw),
    cwd: '',
    home: null,
    configDir: null,
    isInteractive: true,
    loadedAtMs: Date.now(),
    view: 'overview',
    back: 'overview',
    isHelp: false,
    snapshot: null,
    cache: new Map(),
    probes: new Map(),
    ruflo: { snapshot: null, route: null, error: null },
    usage: null,
    rufloTools: null,
    mods: [],
    denied: [],
    activity: [],
    toolsByAgent: new Map(),
    writes: [],
    history: { patterns: [], spend: [], outcomes: 0 },
    events: [],
    statusLog: new Map(),
    eventFilter: 'all',
    curveGrewAtMs: 0,
    pane: { isOpen: false, isShown: false, isFocused: false, columns: 0, rows: 0, placement: 'inline', isClosedByPerson: false, autoTried: false, autoReason: '' },
    mounted: new Map(),
    select: { claim: 0, agent: 0, task: 0, item: 0 },
    drill: { agentId: null, logs: null, logsAtMs: 0 },
    palette: { isOpen: false, query: '', index: 0, context: 'all' },
    pending: null,
    outcome: null,
    isActing: false,
    isRefreshing: false,
    barDrawnAtMs: 0,
    timers: new Map(),
    stats: { renders: [], refreshes: [], frames: [] },
  }
}

/** Keeps the newest `max` samples of a series. */
export function push<T>(series: T[], value: T, max = 120): void {
  series.push(value)

  if (series.length > max) {
    series.splice(0, series.length - max)
  }
}

/** What is written to `$.store`: the person's choices only. */
export type Persisted = { view: ViewId; isClosedByPerson: boolean }

export function restore(state: State, value: unknown): void {
  const held = value !== null && typeof value === 'object' ? (value as Partial<Persisted>) : {}

  if (typeof held.view === 'string' && VIEWS.some(view => view.id === held.view)) {
    state.view = held.view
  }

  state.pane.isClosedByPerson = held.isClosedByPerson === true
}
