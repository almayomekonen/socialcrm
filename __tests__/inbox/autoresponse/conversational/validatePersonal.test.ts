/**
 * The conversational agent's truthfulness check. Pure. Friendly replies must
 * pass untouched; commitments, invented owner facts and selling in a personal
 * conversation must not.
 */
import { describe, expect, it } from 'vitest'
import { findCommercial, findCommitment, findOwnerFact, validateConversationalReply } from '@/lib/inbox/autoresponse/conversational/validatePersonal'

const personal = (reply: string, personalClaims = false) => validateConversationalReply({ reply, mode: 'personal', businessName: 'טליסמן אירועים', personalClaims })

describe('natural personal replies pass', () => {
  it.each([
    'הכל טוב אחי, מה איתך?',
    'חחחחחח 😂',
    'ברור אחי, עבר מלא זמן!',
    'עוד לא סגור על משהו מיוחד, מה איתך?',
    'ברור, חייבים לקבוע',
    'סבבה, נדבר',
    'אחלה, תהנה!',
    'חחח מה איתך?',
    'מזל טוב!!! איזה כיף לשמוע',
    'בהצלחה מחר, תעדכן איך היה',
    'וואו, בשעה טובה',
    'אצלי הכל טוב, תודה ששאלת',
    'מתגעגע גם, חייבים להיפגש מתישהו',
    'חחח הרגת אותי',
    'יאללה ביי אחי 👋',
  ])('%s', (reply) => {
    expect(personal(reply)).toEqual({ ok: true })
  })
})

describe('commitments on the owner\'s behalf are refused', () => {
  it.each([
    'ניפגש מחר בערב',
    'נתראה ביום חמישי',
    'נקבע לשמונה בערב אצלי',
    'אני אגיע בשמונה',
    'סבבה, אגיע',
    'אתקשר אליך אחר כך',
    'אחזור אליך עוד מעט',
    'אשלח לך את זה',
    'סגרנו, מחר ב-20:00',
    'קבענו!',
    'נצא הערב?',
  ])('%s', (reply) => {
    expect(findCommitment(reply)).not.toBeNull()
    expect(personal(reply)).toMatchObject({ ok: false, violation: 'owner_commitment' })
  })
})

describe('invented facts about the owner are refused', () => {
  it.each([
    'אני בעבודה עכשיו, מדבר אחר כך',
    'אני כרגע בדרך',
    'אני בחו"ל השבוע',
    'אני עסוק מאוד היום',
    'הייתי אצל ההורים',
    'חזרתי מהים',
    'אנחנו בחופשה',
  ])('%s', (reply) => {
    expect(personal(reply)).toMatchObject({ ok: false, violation: 'owner_fact' })
  })

  it('in a business turn "אנחנו במשרד" is a business fact, not an owner fact; "אני בדרך" still is one', () => {
    expect(validateConversationalReply({ reply: 'אנחנו במשרד מ-9 עד 17', mode: 'prospect', businessName: null, personalClaims: false })).toEqual({ ok: true })
    expect(findOwnerFact('אני בדרך, אענה בהמשך')).not.toBeNull()
    expect(validateConversationalReply({ reply: 'אני בדרך, אענה בהמשך', mode: 'support', businessName: null, personalClaims: false })).toMatchObject({ ok: false, violation: 'owner_fact' })
  })
})

describe('no selling in a personal conversation', () => {
  it.each([
    'הכל טוב! איך אפשר לעזור?',
    'ברוך הבא לטליסמן אירועים',
    'יש לנו מבצע החודש על החבילות',
    'השירותים שלנו כוללים הכל',
    'אפשר להשאיר פרטים ונחזור',
    'זה עולה 500 ₪',
    'אחד מאנשי הצוות יחזור אליך',
  ])('%s', (reply) => {
    expect(findCommercial(reply, 'טליסמן אירועים')).not.toBeNull()
    expect(personal(reply)).toMatchObject({ ok: false, violation: 'personal_commercial' })
  })

  it('the same business answer is fine in a business or mixed turn (other validators still apply)', () => {
    const reply = 'בשמחה! איזה סוג אירוע אתם מתכננים?'
    expect(validateConversationalReply({ reply, mode: 'prospect', businessName: 'טליסמן אירועים', personalClaims: false })).toEqual({ ok: true })
    expect(validateConversationalReply({ reply, mode: 'mixed', businessName: 'טליסמן אירועים', personalClaims: false })).toEqual({ ok: true })
  })

  it('a mixed turn still may not commit the owner', () => {
    expect(validateConversationalReply({ reply: 'ברור! נקבע מחר ב-10 ונדבר על האירוע', mode: 'mixed', businessName: null, personalClaims: false })).toMatchObject({ ok: false, violation: 'owner_commitment' })
  })
})

it('the model saying it made a claim is enough to stop the reply', () => {
  expect(personal('סבבה', true)).toEqual({ ok: false, violation: 'self_reported_claim', matched: '' })
})
