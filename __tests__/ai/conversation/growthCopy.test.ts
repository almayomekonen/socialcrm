import { describe, it, expect } from 'vitest'
import { composeBusinessAdvice, classifyBusinessAdvice } from '@/lib/copilot/general/businessAdvice'
import { composeGrowthCopy } from '@/lib/copilot/general/growthCopy'
import { containsUnsupportedBusinessClaim } from '@/lib/copilot/general/unsupportedClaims'
import { quickClassifyGeneral } from '@/lib/copilot/general/classifyGeneralIntent'

const zero = {
  overdueTasks: 0,
  dueToday: 0,
  staleLeads: 0,
  waitingConversations: 0,
  newLeads: 0,
  meetingsToday: 0,
}

function counts(partial: Partial<typeof zero>): typeof zero {
  return { ...zero, ...partial }
}

const UNSAFE = [
  'סיכוי גבוה',
  'ליד חם',
  'לקוח חם',
  'יגדיל הכנסות',
  'יגדיל המרות',
  'המרה נמוכה',
  'מפסיד כסף',
  'תאבד',
  'השיווק עובד',
  'הקמפיינים מצליחים',
  'יש ביקוש חזק',
  'אל תייצר עוד לידים',
  'אתה עמוס',
  'עוד עובדים',
  'הצוות לא',
  'לידים מוזנחים',
]

function assertSafe(text: string) {
  expect(containsUnsupportedBusinessClaim(text)).toBe(false)
  expect(text).not.toMatch(/\d[\d,]+\s*₪/)
  expect(text).not.toMatch(/%/)
  for (const p of UNSAFE) expect(text).not.toContain(p)
}

describe('classifyBusinessAdvice', () => {
  it('maps business questions to kinds', () => {
    expect(classifyBusinessAdvice('מה מצב העסק?')).toBe('state')
    expect(classifyBusinessAdvice('מה אני יכול לעשות כדי לקדם את העסק?')).toBe('advice')
    expect(classifyBusinessAdvice('מה אתה רואה?')).toBe('see')
    expect(classifyBusinessAdvice('איפה אני מפסיד לידים?')).toBe('leak')
    expect(classifyBusinessAdvice('מה אני מפספס?')).toBe('see')
    expect(classifyBusinessAdvice('מה כדאי לי לעשות?')).toBe('advice')
    expect(classifyBusinessAdvice('מה הכי חשוב עכשיו?')).toBe('advice')
    expect(classifyBusinessAdvice('אם היית מנהל את העסק שלי, במה היית מתמקד?')).toBe('advice')
  })

  it('does not steal narrow attention or inbox phrases', () => {
    expect(classifyBusinessAdvice('מה הכי דחוף?')).toBe(null)
    expect(classifyBusinessAdvice('מה דחוף?')).toBe(null)
    expect(classifyBusinessAdvice('מי מחכה לי בוואטסאפ?')).toBe(null)
    expect(classifyBusinessAdvice('מי שלח לי הודעה לאחרונה?')).toBe(null)
    expect(classifyBusinessAdvice('יש הודעות שלא קראתי?')).toBe(null)
    expect(classifyBusinessAdvice('למה?')).toBe(null)
    expect(classifyBusinessAdvice('מי עוד?')).toBe(null)
    expect(quickClassifyGeneral('מה הכי דחוף?').intent).toBe('crm.attention')
    expect(quickClassifyGeneral('מה הכי חשוב עכשיו?').intent).toBe('unknown')
    expect(quickClassifyGeneral('מה כדאי לי לעשות?').intent).toBe('unknown')
    expect(quickClassifyGeneral('אם היית מנהל את העסק שלי, במה היית מתמקד?').intent).toBe('unknown')
  })
})

describe('composeBusinessAdvice — interpretation, not a dump', () => {
  it('1. waiting=2, stale=42, new=40 is a response bottleneck with waiting first', () => {
    const text = composeBusinessAdvice('advice', counts({ waitingConversations: 2, staleLeads: 42, newLeads: 40 }))
    expect(text).toContain('צוואר הבקבוק')
    expect(text).toContain('2 שיחות שממתינות למענה')
    expect(text).toContain('42 לידים שלא היו בקשר')
    expect(text).toContain('40 לידים חדשים')
    expect(text).toContain('נכנסת עבודה חדשה')
    expect(text).toContain('הייתי מתמקד קודם ב-2 השיחות שממתינות למענה')
    expect(text).toContain('אין לי נתוני הכנסה')
    expect(text.indexOf('שיחות שממתינות')).toBeLessThan(text.indexOf('42 לידים'))
    expect(text.indexOf('הייתי מתמקד קודם ב-2 השיחות')).toBeLessThan(text.indexOf('אחר כך עובר ללידים'))
    expect(text).not.toMatch(/ובמקביל.*, ובמקביל/)
    assertSafe(text)
  })

  it('2. waiting=0, stale=42, new=0 is a follow-up bottleneck', () => {
    const text = composeBusinessAdvice('advice', counts({ staleLeads: 42 }))
    expect(text).toContain('42 לידים שלא היו בקשר')
    expect(text).toContain('לחזור ללידים שכבר נמצאים במערכת')
    expect(text).toContain('מהוותיקים ביותר')
    expect(text).not.toContain('שיחות שממתינות')
    expect(text).not.toContain('השיווק')
    assertSafe(text)
  })

  it('3. waiting=0, stale=42, new=40 is backlog plus inflow, not marketing success', () => {
    const text = composeBusinessAdvice('advice', counts({ staleLeads: 42, newLeads: 40 }))
    expect(text).toContain('42 לידים')
    expect(text).toContain('40 לידים חדשים')
    expect(text).toContain('נכנסים לידים חדשים')
    expect(text).toContain('לא קיבלו המשך')
    expect(text).toContain('מהוותיקים ביותר')
    expect(text).not.toContain('השיווק עובד')
    expect(text).not.toContain('הקמפיינים')
    expect(text).not.toContain('ביקוש חזק')
    assertSafe(text)
  })

  it('4. waiting=0, stale=0, new=40 is active inflow with no bottleneck claim', () => {
    const text = composeBusinessAdvice('advice', counts({ newLeads: 40 }))
    expect(text).toContain('השבוע נכנסו 40 לידים חדשים ל-CRM')
    expect(text).toContain('אין כרגע צוואר בקבוק ברור')
    expect(text).toContain('טיפול מסודר בלידים החדשים')
    expect(text).not.toContain('השיווק')
    expect(text).not.toContain('שיחות שממתינות')
    assertSafe(text)
  })

  it('5. all operational counts zero is all-clear and invents no problem', () => {
    const text = composeBusinessAdvice('state', zero)
    expect(text).toContain('אין כרגע צוואר בקבוק ברור')
    expect(text).not.toContain('הייתי מתמקד')
    expect(text).not.toMatch(/יש \d+ שיחות/)
    expect(text).not.toMatch(/יש \d+ לידים שלא היו בקשר/)
    assertSafe(text)
  })

  it('6. overdueTasks uses task language, not neglected-lead language', () => {
    const text = composeBusinessAdvice('advice', counts({ overdueTasks: 5 }))
    expect(text).toContain('5 משימות שעבר מועד הטיפול שלהן')
    expect(text).toContain('הייתי מתמקד קודם במשימות')
    expect(text).not.toContain('5 לידים')
    expect(text).not.toContain('לידים מוזנחים')
    expect(text).not.toContain('לידים שלא היו בקשר')
    assertSafe(text)
  })

  it('7. dueToday uses scheduled-follow-up language', () => {
    const text = composeBusinessAdvice('advice', counts({ dueToday: 3 }))
    expect(text).toContain('3 מעקבים שמתוזמנים להיום')
    expect(text).toContain('הייתי מתמקד קודם במעקבים')
    expect(text).not.toContain('לידים מוזנחים')
    assertSafe(text)
  })

  it('8. waiting + overdue + stale keeps waiting as the one next action', () => {
    const text = composeBusinessAdvice(
      'advice',
      counts({ waitingConversations: 2, overdueTasks: 4, staleLeads: 42 }),
    )
    expect(text).toContain('2 שיחות שממתינות למענה')
    expect(text).toContain('4 משימות שעבר מועד הטיפול שלהן')
    expect(text).toContain('הייתי מתמקד קודם ב-2 השיחות שממתינות למענה')
    expect(text).not.toContain('הייתי מתמקד קודם במשימות')
    expect(text).not.toContain('מהוותיקים ביותר')
    expect(text).not.toContain('אחר כך עובר ללידים')
    assertSafe(text)
  })

  it('9. meetings only does not invent a bottleneck', () => {
    const text = composeBusinessAdvice('advice', counts({ meetingsToday: 3 }))
    expect(text).toContain('אין כרגע צוואר בקבוק ברור')
    expect(text).toContain('3 פגישות')
    expect(text).not.toContain('הייתי מתמקד')
    assertSafe(text)
  })

  it('advice leads with a priority and grounds the 42 + waiting case', () => {
    const text = composeBusinessAdvice(
      'advice',
      counts({ staleLeads: 42, waitingConversations: 1, newLeads: 40 }),
    )
    expect(text).toContain('הייתי מתמקד')
    expect(text).toContain('42 לידים')
    expect(text).toContain('1 שיחה שממתינה')
    expect(text).toContain('אין לי נתוני הכנסה')
    assertSafe(text)
  })

  it('state is not the raw overview sentence', () => {
    const text = composeBusinessAdvice(
      'state',
      counts({ staleLeads: 42, waitingConversations: 1, newLeads: 40 }),
    )
    expect(text).not.toMatch(/^היום: /)
    expect(text).toContain('42')
    expect(text).not.toContain('סיכוי גבוה')
  })

  it('see is a reading, not a numbered dashboard', () => {
    const text = composeBusinessAdvice(
      'see',
      counts({ staleLeads: 42, waitingConversations: 1, newLeads: 40 }),
    )
    expect(text).toContain('מה שאני רואה כרגע')
    expect(text).toContain('42')
    expect(text).not.toMatch(/^\s*1\./m)
    expect(text).not.toContain('המרה נמוכה')
    assertSafe(text)
  })

  it('leak with evidence stays operational; leak without evidence is honest', () => {
    const withEvidence = composeBusinessAdvice(
      'leak',
      counts({ staleLeads: 42, waitingConversations: 1, newLeads: 40 }),
    )
    expect(withEvidence).toContain('42')
    expect(withEvidence).not.toContain('מפסיד כסף')
    assertSafe(withEvidence)

    const insufficient = composeBusinessAdvice('leak', zero)
    expect(insufficient).toContain('אני לא יכול לקבוע')
    expect(insufficient).not.toMatch(/₪/)
  })

  it('composeGrowthCopy delegates to advice', () => {
    const c = counts({ staleLeads: 42, waitingConversations: 1, newLeads: 40 })
    expect(composeGrowthCopy(c)).toBe(composeBusinessAdvice('advice', c))
  })
})
