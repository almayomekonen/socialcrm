import { searchUserDrive, type DriveSearchResult } from '@/lib/integrations/google/driveClient'
import {
  ACTION_KEYWORDS_NORM,
  DRIVE_KEYWORDS_NORM,
  READ_ACTION_KEYWORDS_NORM,
} from './driveIntentKeywords'
import { tokenize } from './driveIntentTokenize'
import { buildDriveQuery } from './driveIntentQuery'

export type { DriveQuery } from './driveIntentQuery'
export type { DriveSearchResult }
export { buildDriveQuery }

const COPILOT_TRACE = process.env.COPILOT_TRACE === '1'

export function detectsDriveIntent(question: string): boolean {
  const tokens = tokenize(question)
  const normalizedTokens = tokens.map((t) => t.normalized)

  const driveMatch = normalizedTokens.some((n) => DRIVE_KEYWORDS_NORM.some((kw) => n.includes(kw)))
  const actionMatch = normalizedTokens.some((n) => ACTION_KEYWORDS_NORM.some((kw) => n.includes(kw)))

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] driveIntent.tokens', {
      rawTokens: tokens.map((t) => t.raw),
      normalizedTokens,
      actionMatch,
      driveMatch,
    })
  }

  return driveMatch && actionMatch
}

/**
 * True when the user wants the *content* of a file, not just a list of
 * matches. Used by maybePrefetchDrive to decide whether to fetch + inject
 * the top result's text. Independent from detectsDriveIntent — a question
 * can be a Drive search without being a read request ("מצא לי קובץ"), and
 * vice versa for the rare case where read keywords appear alongside
 * non-Drive nouns (in which case detectsDriveIntent gates everything
 * anyway).
 */
export function detectsReadIntent(question: string): boolean {
  const tokens = tokenize(question)
  return tokens.some((t) => READ_ACTION_KEYWORDS_NORM.some((kw) => t.normalized.includes(kw)))
}

export type DriveSearchOutcome = {
  results: DriveSearchResult[]
  mode: 'specific' | 'generic'
  readIntent: boolean
}

export async function maybePrefetchDrive({
  question,
  userId,
}: {
  question: string
  userId: number
}): Promise<DriveSearchOutcome | null> {
  if (!detectsDriveIntent(question)) {
    if (COPILOT_TRACE) console.info('[copilot.trace] driveIntent.skipped', { reason: 'no_match' })
    return null
  }

  const built = buildDriveQuery(question)
  const readIntent = detectsReadIntent(question)

  if (COPILOT_TRACE) {
    console.info('[copilot.trace] driveIntent.triggered', { query: built.q, mode: built.mode, readIntent })
  }

  try {
    const results = await searchUserDrive({ userId, query: built.q, limit: 10 })
    if (COPILOT_TRACE) console.info('[copilot.trace] driveIntent.results', { count: results.length })
    return { results, mode: built.mode, readIntent }
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown'
    if (COPILOT_TRACE) console.warn('[copilot.trace] driveIntent.failed', { message })
    return null
  }
}
