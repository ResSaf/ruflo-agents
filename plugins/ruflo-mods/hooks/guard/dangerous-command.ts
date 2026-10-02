import type { Verdict } from './verdict'

/**
 * The commands hook-handler.cjs `pre-bash` refuses, matched the same way
 * (lowercased substring). The parity test reads the list out of
 * hook-handler.cjs and fails CI if the two drift.
 */
export const DANGEROUS_COMMANDS: readonly string[] = ['rm -rf /', 'format c:', 'del /s /q c:\\', ':(){:|:&};:']

/**
 * A deny for a Bash call whose command is on the list, else undefined.
 *
 * @param tool the tool name as the model calls it
 * @param input the tool's arguments, unvalidated
 */
export function dangerousCommandVerdict(tool: string, input: unknown): Verdict | undefined {
  if (tool !== 'Bash') return undefined
  const raw = input !== null && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
  // Same belt-and-braces as #2017: a non-string command is checked as text,
  // never skipped.
  const command = String(raw ?? '').toLowerCase()
  const hit = DANGEROUS_COMMANDS.find(d => command.includes(d))
  return hit === undefined
    ? undefined
    : { decision: 'deny', reason: `ruflo: dangerous command blocked (${hit})` }
}
