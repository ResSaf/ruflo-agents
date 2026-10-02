import type { RouteResult } from './route-task'

/**
 * The routing block as hook-handler.cjs `route` prints it, so the model reads
 * the same context whichever path produced it.
 *
 * @param prompt the prompt routed
 * @param result its route
 */
export function formatRoute(prompt: string, result: RouteResult): string {
  // The structured result says `no-match-default` (#3567); the box keeps the
  // classic wording, so the text the model reads is the same on both paths.
  const reason = result.matched ? result.reason : 'Default routing - no specific keyword matched'
  return [
    `[INFO] Routing task: ${prompt.substring(0, 80) || '(no prompt)'}`,
    '',
    '+------------------- Primary Recommendation -------------------+',
    `| Agent: ${result.agent.padEnd(53)}|`,
    `| Confidence: ${(result.confidence * 100).toFixed(1)}%${' '.repeat(44)}|`,
    `| Reason: ${reason.substring(0, 53).padEnd(53)}|`,
    '+--------------------------------------------------------------+',
  ].join('\n')
}
