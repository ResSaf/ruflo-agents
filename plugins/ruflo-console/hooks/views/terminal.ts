import type { RenderElement } from 'claude-code'

import { HARNESSES, harnessOf, isLive } from '../harness'
import type { AgentId, TermLine } from '../state'
import { button, clip, col, row, rule, text, THEME, type Ctx } from './common'

/** Screen rows of conversation when the pane's height is unknown; a known height gives the window what is left. */
export const TERM_ROWS = 18

const COLOR: Record<AgentId, string> = { codex: '#00afd7', claude: '#d7af00', ruflo: '#d7005f' }
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** A line folded to the window's width, so a long answer wraps instead of being cut at the edge. */
function fold(line: string, width: number): string[] {
  if (line.length <= width) return [line === '' ? ' ' : line]

  const out: string[] = []
  let rest = line

  while (rest.length > width) {
    const cut = rest.lastIndexOf(' ', width)
    const at = cut > width * 0.5 ? cut : width

    out.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^ /, '')
  }

  out.push(rest)

  return out
}

/** One screen row of the conversation: a gutter in the agent's colour, then the text in its style. */
type ScreenRow = { gutter: string; gutterColor: string; text: string; style: Record<string, unknown>; reuse?: string }

/**
 * The conversation as screen rows. Each question opens a framed turn (╭─ you), each agent's answer runs down a gutter
 * in its colour (├─ codex … │ … ╰─ ✓ 3 s · $0.01), with a light reading of markdown: headings bold, bullets as •, and
 * fenced code framed and tinted. Tool calls are dim ⚙ rows. A question's rows can be clicked to ask it again.
 */
export function screenOf(lines: readonly TermLine[], width: number): ScreenRow[] {
  const rows: ScreenRow[] = []
  const inFence = new Map<string, boolean>()

  for (const line of lines) {
    const color = line.from !== undefined ? COLOR[line.from] : THEME.head
    const at = (gutter: string, body: string, style: Record<string, unknown> = {}, reuse?: string) => {
      for (const part of fold(body, width)) rows.push({ gutter, gutterColor: color, text: part, style, ...(reuse !== undefined && { reuse }) })
    }

    switch (line.kind) {
      case 'in':
        rows.push({ gutter: ' ', gutterColor: color, text: ' ', style: {} })
        rows.push({ gutter: '╭─ ', gutterColor: THEME.head, text: `you${line.from !== undefined ? ` → ${line.from}` : ''}`, style: { bold: true, color: THEME.head } })
        at('│  ', line.text, { bold: true }, line.text)
        break
      case 'head':
        rows.push({ gutter: '├─ ', gutterColor: color, text: line.text, style: { bold: true, color } })
        break
      case 'out': {
        const key = line.from ?? ''
        const isFence = /^\s*```/.test(line.text)

        if (isFence) {
          inFence.set(key, !(inFence.get(key) ?? false))
          rows.push({ gutter: '│  ', gutterColor: color, text: inFence.get(key) === true ? `┌┄ ${line.text.replace(/`/g, '').trim() || 'code'}` : '└┄', style: { dimColor: true } })
        } else if (inFence.get(key) === true) {
          at('│  ', `┆ ${line.text}`, { color: THEME.info })
        } else if (/^\s*#{1,6}\s/.test(line.text)) {
          at('│  ', line.text.replace(/^\s*#{1,6}\s/, ''), { bold: true, color })
        } else {
          at('│  ', line.text.replace(/^(\s*)[-*]\s/, '$1• '))
        }
        break
      }
      case 'tool':
        // The stream gives each tool row its own mark (⚙ $ ✎ 🔎 ☐); output under a command arrives indented.
        at('│  ', line.text, { dimColor: true, color: THEME.info })
        break
      case 'err':
        at('│  ', `! ${line.text.trim()}`, { color: THEME.warn })
        break
      case 'end':
        rows.push({ gutter: '╰─ ', gutterColor: color, text: line.text, style: line.text.startsWith('✗') ? { color: THEME.bad } : { color: THEME.ok } })
        break
      default:
        at('   ', line.text, { dimColor: true, italic: true })
    }
  }

  return rows
}

/**
 * The AI terminal: pick a harness, type, and talk. The conversation scrolls in a window (▲ older, ▼ newer, ⤓ end, or
 * /up /down /end in the field); while scrolled up, new output waits below and is counted instead of pulling the view
 * down. Each agent keeps its session per project, so follow-ups carry the context; the first message of a session
 * shows its command and Enter again runs it. Answers stream in as they are written.
 */
export function terminalView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const term = state.terminal
  const harness = harnessOf(term.harness)
  const rows: RenderElement[] = [rule(ctx, 'Harness', term.costUsd > 0 ? `$${term.costUsd.toFixed(2)} this session` : 'pick one, or /codex /claude /swarm /ruflo')]

  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      gap: 1,
      key: 'term-pick',
      children: HARNESSES.map(entry =>
        entry.id === term.harness
          ? ctx.kit.Box({ key: `term-${entry.id}`, children: [ctx.kit.Text({ bold: true, color: THEME.head, children: `[${entry.key}: ${entry.label.toUpperCase()}]` })] })
          : ctx.kit.Button({ key: `term-${entry.id}`, label: entry.label, hotkey: entry.key, onPress: () => ctx.act.term.harness(entry.id) }),
      ),
    }),
  )
  rows.push(text(ctx, ` ${harness.about}`, { color: THEME.info }))

  const sessions = harness.agents
    .filter((agent): agent is 'codex' | 'claude' => agent !== 'ruflo')
    .map(agent => {
      const id = term.sessions[agent]

      return `${agent}: ${id === undefined ? 'new session' : `session ${id.slice(0, 8)}… · ${term.turns[agent]} turn${term.turns[agent] === 1 ? '' : 's'} here`}${term.isLive[agent] ? ' · live' : ''}`
    })

  if (sessions.length > 0) rows.push(text(ctx, ` ${sessions.join('   ')}`, { dimColor: true }))

  // The window: the newest screen rows, or `scroll` rows up from them.
  const width = Math.max(10, ctx.columns - 6)
  const screen = screenOf(term.lines, width)
  // The frame around the window (banner, strips, tabs, title, picker, rules, buttons, field, hint, footer, a confirm row)
  // takes about 34 rows: the window gets the rest, so the field is never pushed below the fold (the pane drops the keys
  // when the focused field scrolls out of sight).
  const height = state.pane.rows > 0 ? Math.max(6, Math.min(48, state.pane.rows - 34 - term.runs.size)) : TERM_ROWS
  const maxScroll = Math.max(0, screen.length - height)
  const scroll = Math.min(term.scroll, maxScroll)
  const start = Math.max(0, screen.length - height - scroll)
  const shown = screen.slice(start, start + height)

  rows.push(rule(ctx, 'Conversation', screen.length === 0 ? 'empty' : `rows ${start + 1}–${start + shown.length} of ${screen.length}`))

  if (shown.length === 0) rows.push(text(ctx, ' nothing yet: type below and press Enter. The first message of a session shows its command; Enter again runs it.', { dimColor: true }))

  for (const [i, entry] of shown.entries()) {
    const body = entry.reuse !== undefined
      ? ctx.kit.Button({ key: `term-reuse-${start + i}`, label: clip(entry.text, width), plain: true, onPress: () => ctx.act.term.reuse(entry.reuse as string) })
      : ctx.kit.Text({ wrap: 'truncate-end', ...entry.style, children: clip(entry.text, width) })

    rows.push(row(ctx, [ctx.kit.Text({ color: entry.gutterColor, children: entry.gutter }), body], `term-row-${start + i}`))
  }

  // Live: each agent still answering, with a spinner that turns only while it writes back.
  for (const [agent, run] of term.runs) {
    const secs = Math.round((nowMs - run.startedAtMs) / 1000)

    rows.push(text(ctx, `${SPIN[Math.floor(nowMs / 100) % SPIN.length]} ${agent} is answering · ${secs}s`, { color: COLOR[agent] }))
  }

  // Scrolling, by mouse or from the field.
  rows.push(
    row(ctx, [
      ...(scroll < maxScroll ? [button(ctx, 'term-up', '▲ older', () => ctx.act.term.scroll(height - 2))] : []),
      ...(scroll > 0 ? [button(ctx, 'term-down', '▼ newer', () => ctx.act.term.scroll(-(height - 2))), button(ctx, 'term-end', term.unseen > 0 ? `⤓ ${term.unseen} new` : '⤓ end', () => ctx.act.term.scroll(-scroll))] : []),
      ...(term.runs.size > 0 ? [button(ctx, 'term-stop', '■ Stop', ctx.act.term.stop)] : []),
      ...(harness.id !== 'ruflo' ? [button(ctx, 'term-new', '✚ New session', ctx.act.term.fresh)] : []),
      button(ctx, 'term-clear', '⌫ Clear', ctx.act.term.clear),
    ]),
  )
  rows.push(rule(ctx, `Ask ${harness.label}`, isLive(state) ? 'live: Enter sends' : 'Enter shows the command, Enter again runs it'))

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'term-input',
        label: '›',
        placeholder: harness.id === 'ruflo' ? 'a ruflo command: swarm status, memory search -q auth …' : isLive(state) ? `follow up with ${harness.label}…` : `ask ${harness.label} about this project…`,
        value: term.draft,
        submitLabel: isLive(state) ? 'send' : 'ask',
        onInput: value => ctx.act.term.draft(value),
        onSubmit: value => ctx.act.term.submit(value),
      }),
    )
  } else {
    rows.push(text(ctx, 'this surface has no text field: the terminal needs Claude Code in a terminal', { dimColor: true }))
  }

  rows.push(text(ctx, ' /codex /claude /swarm /ruflo switch · /new starts over · /up /down /end scroll · click a question to ask it again', { dimColor: true }))

  return col(ctx, rows, 'terminal')
}
