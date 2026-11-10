import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The qualify turn's source, in pipeline order: the orchestrator, then the
 * modules it delegates to. Source-text assertions that used to read
 * qualifyWorker.ts alone read this, so they keep checking the same code after
 * the worker was split into lib/inbox/autoresponse/qualifyTurn/.
 */
export const QUALIFY_TURN_FILES = [
  'lib/inbox/autoresponse/qualifyWorker.ts',
  'lib/inbox/autoresponse/qualifyTurn/turnFacts.ts',
  'lib/inbox/autoresponse/qualifyTurn/responders.ts',
  'lib/inbox/autoresponse/qualifyTurn/generateTurn.ts',
  'lib/inbox/autoresponse/qualifyTurn/completeTurn.ts',
  'lib/inbox/autoresponse/qualifyTurn/effects.ts',
  'lib/inbox/autoresponse/qualifyTurn/types.ts',
] as const

export function readQualifyTurnSource(): string {
  return QUALIFY_TURN_FILES.map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n')
}
