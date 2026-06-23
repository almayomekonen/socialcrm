import { describe, it, expect } from 'vitest'
import { validateAutoResponse } from '@/lib/inbox/autoresponse/validate'

const ok = ['שלום! קיבלנו את פנייתך, נשמח לדעת איך נוכל לעזור?']
const bad: [string, string][] = [
  ['המחיר שלנו הוא 200 ש"ח, מתאים?', 'forbidden'],     // price
  ['יש לנו הנחה מיוחדת היום, רוצה?', 'forbidden'],       // discount
  ['אני מבטיח לחזור מחר ב-10:00, טוב?', 'forbidden'],    // commitment/date
  ['מה שמך? ומאיפה הגעת אלינו?', 'too_many_questions'],   // two question marks
  ['שלום וברוך הבא לעסק שלנו אנחנו פה כדי לעזור לך בכל מה שתצטרך אז ספר לנו עוד קצת על עצמך ועל מה שאתה מחפש כדי שנוכל להבין', 'too_long'],
  ['', 'empty'],
  ['תודה שפנית אלינו!', 'no_question'],                  // no qualification question
]

describe('validateAutoResponse', () => {
  for (const m of ok) it(`accepts: ${m}`, () => expect(validateAutoResponse(m).ok).toBe(true))
  for (const [m, v] of bad) it(`rejects (${v}): ${m}`, () => {
    const r = validateAutoResponse(m)
    expect(r.ok).toBe(false)
  })
})
