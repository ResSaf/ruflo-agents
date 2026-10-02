import type { RenderElement } from 'claude-code'

import type { Intelligence } from '../data/cli'
import { ago, col, count, kv, live, pct, picture, rule, sourceLine, starts, text, THEME, type Ctx } from './common'
import { stagesOf } from './frames'

/**
 * What ruflo has learned, from its own stores: the router's last pick and how routed tasks turned out, the model tier
 * router's tallies, and SONA's trajectory and pattern counts. A rate always carries its N.
 */
export function learningView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const snap = state.snapshot
  const route = state.ruflo.route
  const outcomes = snap?.outcomes ?? null
  const router = snap?.router ?? null
  const neural = snap?.neural ?? null
  const intel = live<Intelligence>(state.probes.get('intelligence'))
  const rows: RenderElement[] = [rule(ctx, 'Router', 'ruflo-mods · routing-outcomes.json')]

  rows.push(
    kv(
      ctx,
      'last pick',
      route !== null
        ? `${route.agent} ${pct(route.confidence)} · ${route.matched ? 'keyword match' : 'no match, default'} · ${route.reason} (a prior, not a calibrated probability)`
        : state.ruflo.snapshot === null
          ? 'n/a — ruflo-mods not seated, so no in-process route'
          : 'n/a — no prompt routed yet this session',
    ),
  )
  rows.push(
    kv(
      ctx,
      'routed outcomes',
      outcomes === null || outcomes.total === 0
        ? 'n/a — no routing-outcomes.json'
        : `${outcomes.successes}/${outcomes.total} succeeded (${pct(outcomes.successes / outcomes.total)} success rate, N=${outcomes.total}) · last ${ago(outcomes.points[outcomes.points.length - 1]?.atMs, nowMs)}`,
      outcomes !== null && outcomes.total > 0 ? THEME.info : undefined,
    ),
  )
  rows.push(picture(ctx, 'curve', `running success rate over ${outcomes?.total ?? 0} outcomes`))
  rows.push(text(ctx, 'running success rate of routed tasks, oldest left (router accuracy over N outcomes); new outcomes draw in', { dimColor: true }))
  rows.push(
    kv(
      ctx,
      'model router',
      router === null
        ? 'n/a — no .swarm/model-router-state.json'
        : `${count(router.decisions)} decisions · ${router.distribution.filter(entry => entry.count > 0).map(entry => `${entry.model} ${entry.count}`).join(' · ') || 'none'} · avg confidence ${router.avgConfidence === undefined ? 'n/a' : router.avgConfidence.toFixed(2)} · ${ago(router.updatedMs, nowMs)}`,
    ),
  )

  rows.push(rule(ctx, 'Pipeline', 'RETRIEVE → JUDGE → DISTILL → CONSOLIDATE'))
  rows.push(picture(ctx, 'pipeline', stagesOf(state).map(stage => `${stage.name} ${stage.count ?? 'n/a'}`).join(' → ')))
  for (const stage of stagesOf(state)) rows.push(text(ctx, `  ${stage.name.toLowerCase()}: ${stage.source}`, { dimColor: true }))
  rows.push(picture(ctx, 'patterns', `patterns since load: ${state.history.patterns.map(sample => sample.value).join(' ') || 'n/a'}`))
  rows.push(rule(ctx, 'SONA · ReasoningBank', 'neural/stats.json'))
  rows.push(kv(ctx, 'trajectories', neural === null ? 'n/a — no .claude-flow/neural/stats.json' : count(neural.trajectories)))
  rows.push(kv(ctx, 'patterns learned', neural === null ? 'n/a' : count(neural.patterns)))
  rows.push(kv(ctx, 'signals', neural === null ? 'n/a' : count(neural.signals)))
  rows.push(kv(ctx, 'last learned', neural?.lastAdaptationMs !== undefined ? ago(neural.lastAdaptationMs, nowMs) : 'n/a', THEME.info))
  rows.push(kv(ctx, 'SONA patterns', snap?.sona === null || snap?.sona === undefined ? 'n/a — no .swarm/sona-patterns.json' : String(snap.sona.patterns)))
  rows.push(
    kv(
      ctx,
      'live engine',
      intel === null
        ? sourceLine(state.probes.get('intelligence'), nowMs, 'n/a').text
        : `${count(intel.trajectories)} trajectories · ${count(intel.patterns)} patterns · MoE ${count(intel.moeDecisions)} decisions · EWC ${count(intel.ewcConsolidations)} consolidations · neural router ${intel.neuralRouter ?? 'n/a'}`,
    ),
  )
  rows.push(text(ctx, 'live engine: hooks_intelligence_stats in a fresh CLI process, so in-memory counters start at zero there', { dimColor: true }))

  // Nothing learned yet: the loop starts from the repository itself.
  if ((snap?.sona === null || snap?.sona === undefined) && (neural === null || neural === undefined) && snap?.isRufloProject === true) rows.push(starts(ctx, 'Nothing learned yet in this project.', ['pretrain']))

  return col(ctx, rows, 'learning')
}
