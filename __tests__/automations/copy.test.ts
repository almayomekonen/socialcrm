import { describe, expect, it } from 'vitest'
import { FAILURE_COPY, SKIP_REASON_COPY } from '@/lib/automations/copy'
import { SKIP_REASONS } from '@/lib/automations/types'

// The single copy map: every skip reason has Hebrew copy, and the strings the
// spec (docs/email-automations-plan.md §8–§9) defines verbatim are pinned so
// they cannot drift.

describe('SKIP_REASON_COPY', () => {
  it('covers every skip reason with non-empty Hebrew copy', () => {
    for (const reason of SKIP_REASONS) {
      const copy = SKIP_REASON_COPY[reason]
      expect(copy, reason).toBeTruthy()
      expect(copy.startsWith('לא נשלח — '), `${reason} uses the unified prefix`).toBe(true)
    }
  })

  it('pins the spec-verbatim strings', () => {
    expect(SKIP_REASON_COPY.no_email).toBe('לא נשלח — אין כתובת אימייל לליד')
    expect(SKIP_REASON_COPY.suppressed).toBe('לא נשלח — הליד הוסר מרשימת התפוצה')
    expect(SKIP_REASON_COPY.already_sent).toBe('לא נשלח — כבר נשלח לליד הזה')
    expect(SKIP_REASON_COPY.lead_deleted).toBe('לא נשלח — הליד נמחק לפני מועד השליחה')
    expect(SKIP_REASON_COPY.premise_expired).toBe('לא נשלח — הליד כבר טופל')
  })

  it('contains no emoji and no raw provider vocabulary', () => {
    const all = [...Object.values(SKIP_REASON_COPY), ...Object.values(FAILURE_COPY)].join(' ')
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)).toBe(false)
    expect(/resend|bounce|smtp|4\d\d|5\d\d/i.test(all)).toBe(false)
  })
})

describe('FAILURE_COPY', () => {
  it('pins the spec-verbatim transient-failure line', () => {
    expect(FAILURE_COPY.transient).toBe('לא נשלח — תקלה זמנית, ננסה שוב')
    expect(FAILURE_COPY.terminal).toBeTruthy()
  })
})
