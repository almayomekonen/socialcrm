import { vi } from 'vitest'
import { _resetAiEnvCacheForTests } from '@/lib/ai/env'

/**
 * Put specific agencies on the /agent rollout for a test file.
 *
 * Approvals re-check `isAgentEnabled` at decision time (F3), so a file that
 * exercises the approval path must state the precondition it relies on: these
 * agencies ARE enabled. Explicit ids, never 'all', so a test can still prove
 * that an agency NOT on the list is refused.
 */
export function enableAgentFor(agencyIds: number[]): void {
  vi.stubEnv('AI_ENABLED', '1')
  vi.stubEnv('AGENT_AGENCY_IDS', agencyIds.join(','))
  _resetAiEnvCacheForTests()
}

/** Undo `enableAgentFor` — restores the real environment and the env cache. */
export function restoreAgentRollout(): void {
  vi.unstubAllEnvs()
  _resetAiEnvCacheForTests()
}
