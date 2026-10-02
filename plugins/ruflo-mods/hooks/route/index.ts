import type { On } from 'claude-code'

import { cachedFile } from '../files'
import type { ModOptions } from '../options'
import { redraw, under, type ModState } from '../state'
import { formatRoute } from './format'
import { parseRanked, rankedContext } from './ranked-context'
import { routeTask } from './route-task'

export const RANKED_PATH = '.claude-flow/data/ranked-context.json'

/**
 * `prompt.submit`: hook-handler.cjs `route` in-process. The routing block
 * (and, with `routeContext`, the ranked-memory block) ride the prompt as
 * context the model reads and the user never sees: `prompt.submit` context is
 * the one injection point sec-default leaves to a person's plugins
 * (`prompt.context` is continued past the user tier).
 */
export function registerRoute(on: On, state: ModState, options: ModOptions) {
  const ranked = cachedFile(() => under(state, RANKED_PATH), parseRanked)

  on('prompt.submit', async ($, e, next) => {
    if (!state.owned.has('route')) return next(e)

    const text = typeof e.text === 'string' ? e.text : ''
    const result = routeTask(text)
    state.lastRoute = result
    state.routed++

    const blocks: string[] = []
    if (options.routeContext) {
      const read = await ranked({ stat: path => $.fs.stat(path), read: path => $.fs.read(path) })
      const context = read.kind === 'ok' ? rankedContext(text, read.value) : null
      if (context) blocks.push(context)
    }
    blocks.push(formatRoute(text, result))
    redraw(state)

    return next({ ...e, context: [...(e.context ?? []), blocks.join('\n')] })
  }).catch(($, e, next) => next(e)) // a broken plugin never blocks a prompt
}
