/**
 * Shared drawing helpers. Views are pure: `(ctx) => tree`, built from the surface's element table, reading the state
 * and the pictures computed for this frame. They call nothing on the engine; buttons call the closures in `ctx.act`.
 * Text colours are theme names only, so nothing fades on a light background.
 */
import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import type { ProbeResult } from '../data/cli'
import type { Grid } from '../gfx/raster'
import type { State, ViewId } from '../state'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Raster?: Elements['terminal']['Raster']; Input?: Elements['terminal']['Input'] }

/** What a button can ask for: every one a closure over the controller. */
export type Actions = {
  view: (id: ViewId) => void
  refresh: () => void
  help: () => void
  close: () => void
  back: () => void
  confirm: () => void
  cancel: () => void
  /** j/k: moves the selection of the view in front. */
  select: (by: number) => void
  agentNext: () => void
  taskNext: () => void
  /** Drills into the selected agent. */
  drill: () => void
  claim: () => void
  release: () => void
  handoff: () => void
  steal: () => void
  palette: (context: 'all' | 'selection') => void
  paletteQuery: (text: string) => void
  paletteRun: (id: string) => void
  paletteSubmit: () => void
  run: (id: string, text?: string) => boolean
  /** Cycles the events view's filter. */
  filter: () => void
}

export type Ctx = {
  kit: Kit
  state: State
  nowMs: number
  columns: number
  /** Every picture of this view, by Raster key, already drawn for this frame. */
  pictures: Map<string, Grid>
  act: Actions
}

export const THEME = { head: 'claude', ok: 'success', bad: 'error', warn: 'warning', info: 'suggestion' } as const

export const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

export function ago(atMs: number | null | undefined, nowMs: number): string {
  if (atMs === null || atMs === undefined || !Number.isFinite(atMs)) return 'n/a'

  const s = Math.max(0, Math.round((nowMs - atMs) / 1000))

  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`

  return `${Math.floor(s / 86_400)}d ago`
}

/** A count as people read it (12.3k), or n/a for a value nobody measured. */
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`

  return String(Math.round(value * 100) / 100)
}

export const pct = (value: number | null | undefined): string => (value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${Math.round(value * 100)}%`)

export function text(ctx: Ctx, children: string, props: { color?: string; bold?: boolean; dimColor?: boolean } = {}): RenderElement {
  return ctx.kit.Text({ wrap: 'truncate-end', ...props, children: clip(children, Math.max(4, ctx.columns)) })
}

export function row(ctx: Ctx, parts: readonly RenderChildren[], key?: string): RenderElement {
  return ctx.kit.Box({ flexDirection: 'row', ...(key !== undefined && { key }), children: [...parts] })
}

export function col(ctx: Ctx, parts: readonly RenderChildren[], key?: string): RenderElement {
  return ctx.kit.Box({ flexDirection: 'column', ...(key !== undefined && { key }), children: [...parts] })
}

/** A section title with a rule to the right edge. */
export function rule(ctx: Ctx, title: string, right = ''): RenderElement {
  const fill = Math.max(1, ctx.columns - title.length - right.length - 3)

  return row(ctx, [ctx.kit.Text({ bold: true, color: THEME.head, children: title }), ctx.kit.Text({ dimColor: true, children: ` ${'─'.repeat(fill)} ` }), ctx.kit.Text({ dimColor: true, children: right })])
}

/** A label and its value; the value dims when it is n/a. */
export function kv(ctx: Ctx, label: string, value: string, color?: string): RenderElement {
  const isNa = value === 'n/a' || value.startsWith('n/a ') || value === 'missing'

  return row(ctx, [
    ctx.kit.Text({ dimColor: true, children: `${label.padEnd(16)} ` }),
    ctx.kit.Text({ wrap: 'truncate-end', ...(isNa ? { dimColor: true } : color !== undefined ? { color } : {}), children: clip(value, Math.max(4, ctx.columns - 18)) }),
  ])
}

/** A Raster for a picture of this frame, or a dim note where the surface has no Raster. */
export function picture(ctx: Ctx, key: string, fallback: string): RenderElement {
  const grid = ctx.pictures.get(key)

  if (grid === undefined || ctx.kit.Raster === undefined) {
    return text(ctx, fallback, { dimColor: true })
  }

  return ctx.kit.Raster(grid.toRaster(key))
}

export function button(ctx: Ctx, key: string, label: string, onPress: () => void, options: { hotkey?: string; primary?: boolean } = {}): RenderElement {
  return ctx.kit.Button({ key, label, onPress, ...(options.hotkey !== undefined && { hotkey: options.hotkey }), ...(options.primary === true && { variant: 'primary' as const }) })
}

/** How a CLI-sourced fact reads: its value's age, running, failing with a stale value, or never measured. */
export function sourceLine(result: ProbeResult | undefined, nowMs: number, what: string): { text: string; color?: string } {
  if (result === undefined || (result.okAtMs === null && result.error === null)) {
    return { text: result?.isRunning === true ? `${what}: asking the ruflo CLI…` : `${what}: not asked yet` }
  }

  if (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) {
    return { text: `${what}: ${clip(result.error, 80)}${result.okAtMs !== null ? ` (last good ${ago(result.okAtMs, nowMs)}, not shown as live)` : ''}`, color: THEME.warn }
  }

  return { text: `${what}: ruflo CLI, ${ago(result.okAtMs, nowMs)}` }
}

/** The value of a probe only while it is the newest answer: a value older than the latest failure is stale. */
export function live<T>(result: ProbeResult | undefined): T | null {
  if (result === undefined || result.value === null) return null
  if (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) return null

  return result.value as T
}
