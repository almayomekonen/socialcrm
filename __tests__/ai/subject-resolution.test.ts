import { describe, it, expect } from 'vitest'
import { extractLeadCandidate } from '@/lib/copilot/general/subjectResolution'

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
