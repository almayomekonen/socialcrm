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

/**
 * The Flow view (תרשים / רשימה) inside the Builder, rolled out per agency.
 *
 * Requires BOTH: the agency can use the Builder (above) AND it is listed in
 * `QUESTIONNAIRE_FLOW_EDITOR_AGENCY_IDS`. Listing an agency here never grants
 * the Builder itself.
 *
 * `all` opens it to every agency that has the Builder. Otherwise an explicit
 * list of agency ids: absent or empty means no agency; entries that are not
 * plain digits (`*`, `true`, `0x67`, `1e2`) are ignored. `1` is agency 1, never
 * "on". Whitespace and duplicates are harmless. Read per call, never cached.
 */
export function canUseQuestionnaireFlowEditor(agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  if (!canUseQuestionnaireBuilder(agencyId)) return false
  const raw = process.env.QUESTIONNAIRE_FLOW_EDITOR_AGENCY_IDS?.trim() ?? ''
  if (raw === 'all') return true
  return raw
    .split(',')
    .map((s) => s.trim())
    .some((s) => /^\d+$/.test(s) && Number(s) === agencyId)
}
