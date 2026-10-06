/**
 * Questionnaire Builder rollout gate (PR1: storage, API and simulator only).
 *
 * ABSENCE BLOCKS: an unset or empty `QUESTIONNAIRE_BUILDER_AGENCY_IDS` means no
 * agency. `all` opens it to every agency. Read per call, never cached.
 *
 * This gates the Builder's own actions. It does NOT gate whether a questionnaire
 * runs: that remains WA_QUESTIONNAIRE_ENABLED / WA_QUESTIONNAIRE_AGENCY_IDS plus
 * the owner's switches, and publishing never bypasses them.
 */
export function canUseQuestionnaireBuilder(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  const raw = process.env.QUESTIONNAIRE_BUILDER_AGENCY_IDS?.trim() ?? ''
  if (raw === 'all') return true
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .some((n) => Number.isFinite(n) && n > 0 && n === agencyId)
}
