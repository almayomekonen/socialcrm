import { describe, it, expect } from 'vitest'
import { containsUnsupportedBusinessClaim } from '@/lib/copilot/general/unsupportedClaims'

describe('containsUnsupportedBusinessClaim', () => {
  it('flags Hebrew conversion and heat claims', () => {
    expect(containsUnsupportedBusinessClaim('יש סיכוי גבוה למימוש העסקה')).toBe(true)
    expect(containsUnsupportedBusinessClaim('George הוא ליד חם')).toBe(true)
    expect(containsUnsupportedBusinessClaim('טיפול מיידי מונע המשך התדרדרות')).toBe(true)
    expect(containsUnsupportedBusinessClaim('לידים חדשים הם פוטנציאל עבודה שטרם מוצה')).toBe(true)
  })

  it('allows evidence sentences', () => {
    expect(containsUnsupportedBusinessClaim('George שלח הודעה לפני 2 דקות ועדיין ממתין למענה.')).toBe(false)
  })
})
