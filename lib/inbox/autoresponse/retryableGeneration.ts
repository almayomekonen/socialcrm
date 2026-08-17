/**
 * Provider/model availability is transient and reuses failAutoResponseJob.
 * Quota (`budget_exhausted`) and every safety/policy skip stay terminal.
 */
export function isRetryableIreGenerationFailure(reason: string): boolean {
  return reason === 'ai_unavailable'
}
