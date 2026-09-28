/**
 * Making a refusal diagnosable without making it leak.
 *
 * The claim gate destroys an answer when the blocklist fires and deliberately
 * never persists the prose — which is correct, and which left every such refusal
 * recorded as the single word `unsupported-claim`. Two live 40-question
 * evaluations lost an answer that way, on different questions, and neither could
 * be classified afterwards.
 *
 * The fix is metadata, and these tests hold both halves of it: the rule must be
 * NAMED, and naming it must not become a back door for the text it destroyed.
 */
import { describe, expect, it } from 'vitest'
import {
  containsUnsupportedBusinessClaim,
  matchUnsupportedBusinessClaim,
  unsupportedClaimRuleIds,
} from '@/lib/copilot/general/unsupportedClaims'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { validateAgentAnswerDetailed } from '@/lib/agent/validate'
import type { AgentAnswer } from '@/lib/agent/types'

describe('the rule ids', () => {
  it('are unique — an id must identify exactly one phrase', () => {
    const ids = unsupportedClaimRuleIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('are stable literals, not positions', () => {
    // Assigned once and never reused, so a trace or a durable row that says
    // RULE_17 still means the same phrase after the list is reordered.
    for (const id of unsupportedClaimRuleIds()) expect(id).toMatch(/^RULE_\d{2}$/)
  })

  it('name the rule that actually matched', () => {
    expect(matchUnsupportedBusinessClaim('יש כאן ליד חם מאוד')?.id).toBe('RULE_05')
    expect(matchUnsupportedBusinessClaim('this is a hot lead')?.id).toBe('RULE_17')
    expect(matchUnsupportedBusinessClaim('אתה מפסיד כסף')?.id).toBe('RULE_20')
  })

  it('return null for text that says nothing unsupported', () => {
    expect(matchUnsupportedBusinessClaim('יש 25 לידים פתוחים בלי צעד הבא.')).toBeNull()
    expect(matchUnsupportedBusinessClaim('')).toBeNull()
    expect(matchUnsupportedBusinessClaim(null)).toBeNull()
  })
})

describe('the existing gate is unchanged', () => {
  it('still refuses every phrase it refused before', () => {
    for (const phrase of ['סיכוי גבוה', 'ליד חם', 'העסקה קרובה', 'מפסיד כסף', 'hot lead', 'increase conversions']) {
      expect(containsUnsupportedBusinessClaim(`טקסט ובתוכו ${phrase} וסיום`), phrase).toBe(true)
    }
  })

  it('still passes honest prose', () => {
    expect(containsUnsupportedBusinessClaim('11 לידים לא קיבלו מענה החודש.')).toBe(false)
  })

  it('reports the same verdict as the matcher, always', () => {
    for (const text of ['ליד חם', 'שום דבר חריג', '', 'hot lead']) {
      expect(containsUnsupportedBusinessClaim(text)).toBe(matchUnsupportedBusinessClaim(text) !== null)
    }
  })
})

describe('what a refusal now records', () => {
  const evidence = () => {
    const e = createEvidenceCollector()
    e.add({ kind: 'lead', refId: '42' })
    return e
  }
  const answer: AgentAnswer = {
    headline: 'ליד חם ממתין לך.',
    claims: [
      { claimClass: 'FACT', text: 'דוד ממתין.', entityEvidence: ['lead:42'] },
      { claimClass: 'RECOMMENDATION', text: 'תחזור אליו.', evidence: ['lead:42'] },
    ],
    unknown: null,
  }

  it('names the rule that fired', () => {
    const v = validateAgentAnswerDetailed(answer, evidence())
    expect(v.rejection).toBe('unsupported-claim')
    expect(v.rejectionRuleId).toBe('RULE_05')
  })

  it('records how much the model proposed, which is otherwise unknowable', () => {
    // The claims are destroyed before they are individually judged, so without
    // this the record cannot distinguish "one bad sentence" from "a whole answer".
    const v = validateAgentAnswerDetailed(answer, evidence())
    expect(v.counts.proposedClaims).toBe(2)
    expect(v.counts.droppedClaims).toBe(0)
  })

  it('still returns NO answer and NO prose', () => {
    const v = validateAgentAnswerDetailed(answer, evidence())
    expect(v.answer).toBeNull()
    // Diagnosability must not resurrect what the gate exists to destroy.
    expect(JSON.stringify(v)).not.toContain('ליד חם')
    expect(JSON.stringify(v)).not.toContain('דוד ממתין')
  })

  it('leaves every other rejection without a rule id', () => {
    const malformed = validateAgentAnswerDetailed({ headline: '', claims: [], unknown: null }, evidence())
    expect(malformed.rejection).toBe('malformed')
    expect(malformed.rejectionRuleId).toBeNull()

    const ungrounded = validateAgentAnswerDetailed(
      { headline: 'כותרת', claims: [{ claimClass: 'FACT', text: 'משהו.', entityEvidence: ['lead:99999'] }], unknown: null },
      evidence(),
    )
    expect(ungrounded.rejection).toBe('no-supportable-claim')
    expect(ungrounded.rejectionRuleId).toBeNull()
  })

  it('an accepted answer carries no rule id and counts what was proposed', () => {
    const v = validateAgentAnswerDetailed(
      { headline: 'הכול בסדר.', claims: [{ claimClass: 'FACT', text: 'דוד קיים.', entityEvidence: ['lead:42'] }], unknown: null },
      evidence(),
    )
    expect(v.rejection).toBeNull()
    expect(v.rejectionRuleId).toBeNull()
    expect(v.counts.proposedClaims).toBe(1)
  })
})
