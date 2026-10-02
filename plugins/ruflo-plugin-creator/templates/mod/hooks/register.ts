import type { Register } from 'claude-code'

import { show, statusLine, type Host } from './host'

/**
 * A mod scaffolded by ruflo-plugin-creator (ADR-404 patterns):
 * - observe: `const r = await next(e); …; return r` on tool.call;
 * - every `$` call literal, wrapped in a host adapter, refusal-tolerant;
 * - namespaced command (`my-mod-status`), never a built-in's name;
 * - the classic fallback handed over through MY_MOD_ACTIVE.
 * Hot reload re-runs register and session.start: keep anything that must
 * survive a reload in `$.store` or `$.state`, not in these variables.
 */
export const register: Register = (on, options) => {
  const showLine = options.statusLine !== false
  let calls = 0

  on('session.start', async ($, e, next) => {
    await $.env.set('MY_MOD_ACTIVE', '1').catch(() => undefined)
    await $.command.register({ name: 'my-mod-status', description: 'my-mod: tool calls this session' }).catch(() => undefined)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    calls++
    const host: Host = { status: text => $.ui.status(text) }
    if (showLine) show(host, calls)
    return result
  })

  on('command.run', { command: 'my-mod-status' }, () => ({ text: statusLine(calls) }))
}
