import { describe, it, expect } from 'vitest'
import { extractLeadCandidate, isLeadFollowup } from '@/lib/copilot/general/subjectResolution'

describe('extractLeadCandidate — resolves explicit lead names', () => {
  const cases: [string, string][] = [
    ['מה עם דנה?', 'דנה'],
    ['מה קורה עם יוסי', 'יוסי'],
    ['מה היה עם דוד?', 'דוד'],
    ['ספר לי על רון', 'רון'],
    ['תספר לי על שירה', 'שירה'],
    ['מה עם דנה כהן', 'דנה כהן'],
    ['מה עם הליד של דוד', 'דוד'], // greedy → last preposition (של)
    ['מה המצב של אסף', 'אסף'],
  ]
  for (const [q, name] of cases) {
    it(`"${q}" → ${name}`, () => {
      expect(extractLeadCandidate(q)).toBe(name)
    })
  }
})

describe('extractLeadCandidate — FALSE-POSITIVE GUARD (must return null → Business)', () => {
  const businessQuestions = [
    'מה דחוף היום', // no preposition
    'מי צריך מעקב היום',
    'מה דורש תשומת לב',
    'על מה להתמקד', // "על מה" → first word is stopword מה
    'מה מצב המערכת',
    'פגישות היום',
    'מה קורה', // no preposition
    'מה בתיבה',
    'מה עם המשימות', // definite-article noun
    'מה עם הלידים',
    'מה עם הפגישות',
    'כמה לידים יש לי',
    'מה לעשות עכשיו',
  ]
  for (const q of businessQuestions) {
    it(`"${q}" → null`, () => {
      expect(extractLeadCandidate(q)).toBeNull()
    })
  }
})

describe('isLeadFollowup — routes to active lead ONLY on a lead signal', () => {
  const followups = [
    'מה היא רצתה?', // pronoun
    'למה הוא לא עונה', // pronoun
    'מה הסטטוס שלה', // pronoun (שלה)
    'תכתוב לו הודעה', // draft verb (+pronoun)
    'נסח תשובה', // draft verb
    'מה הסטטוס?', // lead noun
    'תן לי סיכום', // lead noun
    'מה הצעד הבא?', // lead noun phrase
    'מתי דיברנו', // lead noun phrase
  ]
  for (const q of followups) {
    it(`follow-up: "${q}" → true`, () => {
      expect(isLeadFollowup(q)).toBe(true)
    })
  }

  // The trust property: business-wide / junk questions carry no lead signal.
  const notFollowups = [
    'כמה סגרתי החודש', // business-wide (otherwise unknown) → must NOT route to a lead
    'מאיזה מקור הכי טוב',
    'מה השעה עכשיו', // junk
    'כמה לידים יש לי',
    'מה דחוף היום',
  ]
  for (const q of notFollowups) {
    it(`NOT follow-up: "${q}" → false`, () => {
      expect(isLeadFollowup(q)).toBe(false)
    })
  }

  it('whole-word only: "בשלה" must not match the pronoun "שלה"', () => {
    expect(isLeadFollowup('הליד בשלה')).toBe(false)
  })
})
