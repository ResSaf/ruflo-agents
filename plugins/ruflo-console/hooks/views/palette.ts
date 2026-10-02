import type { RenderElement } from 'claude-code'

import { filterPalette, paletteEntries } from '../palette'
import { button, col, row, rule, text, THEME, type Ctx } from './common'

export const PALETTE_ROWS = 12

/**
 * The command palette over the view: a text field (typing filters, Enter runs the best match) and the matches as
 * buttons. `x` opens it scoped to the selection's actions. While it is open the view's own buttons are not drawn, so
 * Tab and the arrows walk the matches.
 */
export function paletteView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const all = paletteEntries(state, ctx.nowMs)
  const matches = filterPalette(all, state.palette.query, state.palette.context)
  const rows: RenderElement[] = [rule(ctx, state.palette.context === 'selection' ? 'Actions for the selection' : 'Palette', `${matches.length} of ${all.length}`)]

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'palette-input',
        label: '› ',
        placeholder: 'type to filter: spawn, claim, vote, worker, route <words>, store <text>, search <query>…',
        value: state.palette.query,
        submitLabel: 'run best match',
        autoFocus: true,
        onInput: value => ctx.act.paletteQuery(value),
        onSubmit: value => {
          ctx.act.paletteQuery(value)
          ctx.act.paletteSubmit()
        },
      }),
    )
  } else {
    rows.push(text(ctx, 'this surface has no text field: pick an entry below, or use /ruflo run <entry> [text]', { dimColor: true }))
  }

  for (const entry of matches.slice(0, PALETTE_ROWS)) {
    rows.push(
      row(ctx, [
        ctx.kit.Text({ dimColor: true, children: `${entry.group.padEnd(12)}` }),
        ctx.kit.Button({ key: `pal-${entry.id}`, label: entry.label, plain: true, onPress: () => ctx.act.paletteRun(entry.id) }),
      ]),
    )
  }

  if (matches.length > PALETTE_ROWS) rows.push(text(ctx, `+${matches.length - PALETTE_ROWS} more: keep typing`, { dimColor: true }))
  if (matches.length === 0) rows.push(text(ctx, 'no match', { color: THEME.warn }))

  rows.push(row(ctx, [button(ctx, 'palette-close', 'Close palette', () => ctx.act.palette(state.palette.context), { hotkey: state.palette.context === 'selection' ? 'x' : 'p' })]))
  rows.push(text(ctx, 'changes ask y/n before they run · reads (logs, route, search, score) run at once · same entries: /ruflo run <id>', { dimColor: true }))

  return col(ctx, rows, 'palette')
}
