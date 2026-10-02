import type { Register } from 'claude-code'

import { registerCost } from './cost'
import { registerGuard } from './guard'
import { registerLearn } from './learn'
import { registerNoun } from './noun'
import { readOptions } from './options'
import { registerRoute } from './route'
import { registerSession } from './session'
import { createState } from './state'
import { registerTrust } from './trust'

/**
 * ruflo as a Claude Code mod (ADR-404).
 *
 * In-process equivalents of the classic hook-handler.cjs events that fire on
 * every prompt and every edit, tighten-only tool checks, the cost ladder, the
 * `$.ruflo` noun other mods compose with, and the mod trust gate. Additive
 * and opt-in: the classic hooks stay the default, keep every event the mod
 * does not own, and take everything back whenever the mod is not loaded.
 *
 * Registration order is nesting order (the first registered wraps the rest):
 * the trust gate first, so it judges modules before anything else of ours runs.
 */
export const register: Register = (on, options) => {
  const state = createState()
  const opts = readOptions(options)

  registerTrust(on, opts.modTrust, opts.modTrustAllow)
  registerNoun(on, state)
  registerSession(on, state, opts)
  registerRoute(on, state, opts)
  registerGuard(on, state)
  registerLearn(on, state)
  registerCost(on, state, opts)
}
