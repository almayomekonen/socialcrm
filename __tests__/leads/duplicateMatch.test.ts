import { describe, it, expect } from 'vitest'
import { normalizePhone, phoneCore, normalizeEmail, normalizeIdNum } from '@/lib/leads/normalizeContact'
import {
  scoreCandidate,
  compareMatches,
  type NormalizedQuery,
  type DuplicateCandidate,
  type DuplicateMatch,
} from '@/lib/leads/duplicateMatch'

/**
 * Mirrors EXACTLY how actions/leadDuplicates.ts builds the NormalizedQuery from
 * raw form input, so these tests validate the real pipeline (minus the SQL fetch).
 */
function buildQuery(input: {
  phone?: string | null
  secPhone?: string | null
  email?: string | null
  idNum?: string | null
  firstName?: string | null
  lastName?: string | null
}): NormalizedQuery {
  return {
    phones: [normalizePhone(input.phone), normalizePhone(input.secPhone)].filter((p): p is string => !!p),
    email: normalizeEmail(input.email),
    idNum: normalizeIdNum(input.idNum),
    firstName: input.firstName?.trim() || null,
    lastName: input.lastName?.trim() || null,
  }
}

function candidate(over: Partial<DuplicateCandidate>): DuplicateCandidate {
  return {
    id: 1,
    firstName: 'דנה',
    lastName: 'כהן',
    name: 'דנה כהן',
    status: 'new',
    phone: null,
    secPhone: null,
    email: null,
    idNum: null,
    ...over,
  }
}

// ───────────────────────── PHONE VARIATIONS ─────────────────────────
describe('phone normalization — all variants collapse to one canonical form', () => {
  const variants = ['0501234567', '050-123-4567', '050 123 4567', '+972501234567', '972501234567']

  it.each(variants)('normalizePhone(%s) === 972501234567', (v) => {
    expect(normalizePhone(v)).toBe('972501234567')
  })

  it.each(variants)('phoneCore(%s) === 501234567', (v) => {
    expect(phoneCore(v)).toBe('501234567')
  })

  it('returns null for too-short input', () => {
    expect(normalizePhone('12345')).toBeNull()
    expect(phoneCore('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })

  it('matches a query phone against any stored phone format (phone column)', () => {
    const q = buildQuery({ phone: '+972-50-123-4567' })
    for (const stored of variants) {
      const m = scoreCandidate(q, candidate({ phone: stored }))
      expect(m, `stored=${stored}`).not.toBeNull()
      expect(m!.confidence).toBe('certain')
      expect(m!.signals).toContain('phone')
    }
  })

  it('matches a query phone stored in the secPhone column too', () => {
    const q = buildQuery({ phone: '0501234567' })
    const m = scoreCandidate(q, candidate({ phone: null, secPhone: '050-123-4567' }))
    expect(m).not.toBeNull()
    expect(m!.signals).toContain('phone')
  })

  it('does NOT match a different phone number', () => {
    const q = buildQuery({ phone: '0501234567' })
    expect(scoreCandidate(q, candidate({ phone: '0509999999' }))).toBeNull()
  })
})

// ───────────────────────── EMAIL VARIATIONS ─────────────────────────
describe('email normalization — case + whitespace insensitive', () => {
  it.each(['TEST@gmail.com', 'test@gmail.com', '  test@gmail.com  ', '\ttest@gmail.com\n'])(
    'normalizeEmail(%j) === test@gmail.com',
    (v) => {
      expect(normalizeEmail(v)).toBe('test@gmail.com')
    },
  )

  it('returns null for empty', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('email + same name → probable; email + different name → possible', () => {
    const stored = candidate({ email: 'test@gmail.com', firstName: 'דנה', lastName: 'כהן', name: 'דנה כהן' })

    const sameName = scoreCandidate(buildQuery({ email: 'TEST@gmail.com', firstName: 'דנה', lastName: 'כהן' }), stored)
    expect(sameName!.confidence).toBe('probable')
    expect(sameName!.signals).toEqual(['email'])

    const diffName = scoreCandidate(buildQuery({ email: 'TEST@gmail.com', firstName: 'יוסי', lastName: 'לוי' }), stored)
    expect(diffName!.confidence).toBe('possible')
  })

  it('matches across stored-email casing (stored uppercase, query lowercase)', () => {
    const q = buildQuery({ email: 'test@gmail.com', firstName: 'דנה', lastName: 'כהן' })
    const m = scoreCandidate(q, candidate({ email: 'TEST@GMAIL.COM' }))
    expect(m).not.toBeNull()
    expect(m!.signals).toContain('email')
  })
})

// ───────────────────────── ID NUMBER VARIATIONS ─────────────────────────
describe('idNum normalization — pad + strip', () => {
  it('formatted vs unformatted normalize equal', () => {
    expect(normalizeIdNum('12345678')).toBe('012345678')
    expect(normalizeIdNum('012345678')).toBe('012345678')
    expect(normalizeIdNum('012-345-678')).toBe('012345678')
    expect(normalizeIdNum('')).toBeNull()
    expect(normalizeIdNum(null)).toBeNull()
  })

  it('exact idNum match → certain', () => {
    const q = buildQuery({ idNum: '12345678' }) // 8 digits → padded
    const m = scoreCandidate(q, candidate({ idNum: '012345678' })) // stored padded
    expect(m).not.toBeNull()
    expect(m!.confidence).toBe('certain')
    expect(m!.signals).toContain('idNum')
  })

  it('different idNum → no match', () => {
    const q = buildQuery({ idNum: '12345678' })
    expect(scoreCandidate(q, candidate({ idNum: '087654321' }))).toBeNull()
  })
})

// ───────────────────────── FALSE POSITIVES ─────────────────────────
describe('false-positive resistance', () => {
  it('same FIRST name only → no match (returns null)', () => {
    const q = buildQuery({ firstName: 'דנה', lastName: 'לוי' })
    expect(scoreCandidate(q, candidate({ firstName: 'דנה', lastName: 'כהן' }))).toBeNull()
  })

  it('same LAST name only → no match (returns null)', () => {
    const q = buildQuery({ firstName: 'יוסי', lastName: 'כהן' })
    expect(scoreCandidate(q, candidate({ firstName: 'דנה', lastName: 'כהן' }))).toBeNull()
  })

  it('generic shared email + different person → possible, NOT certain', () => {
    const q = buildQuery({ email: 'info@company.com', firstName: 'יוסי', lastName: 'לוי' })
    const m = scoreCandidate(q, candidate({ email: 'info@company.com', firstName: 'דנה', lastName: 'כהן' }))
    expect(m!.confidence).toBe('possible')
  })

  it('shared family phone → flags as certain (advisory by design — never blocks)', () => {
    // Two different people on the same household phone. We DO surface a banner
    // (the user decides), but it is advisory only and never blocks creation.
    const q = buildQuery({ phone: '0501234567', firstName: 'יוסי', lastName: 'לוי' })
    const m = scoreCandidate(q, candidate({ phone: '0501234567', firstName: 'דנה', lastName: 'כהן' }))
    expect(m).not.toBeNull()
    expect(m!.confidence).toBe('certain')
  })

  it('no identifying input → null (nothing to match)', () => {
    expect(scoreCandidate(buildQuery({ firstName: 'דנה' }), candidate({ phone: '0501234567' }))).toBeNull()
  })
})

// ───────────────────────── CONFIDENCE ORDERING ─────────────────────────
describe('compareMatches ordering', () => {
  const mk = (confidence: DuplicateMatch['confidence'], signals: DuplicateMatch['signals']): DuplicateMatch => ({
    id: 1,
    name: 'x',
    status: null,
    phone: null,
    email: null,
    confidence,
    signals,
  })

  it('certain < probable < possible', () => {
    const sorted = [mk('possible', ['email']), mk('certain', ['phone']), mk('probable', ['email'])].sort(compareMatches)
    expect(sorted.map((m) => m.confidence)).toEqual(['certain', 'probable', 'possible'])
  })

  it('ties broken by signal count (more signals first)', () => {
    const sorted = [mk('certain', ['phone']), mk('certain', ['idNum', 'phone', 'email'])].sort(compareMatches)
    expect(sorted[0].signals.length).toBe(3)
  })
})

// ───────────────────────── SIGNAL ACCUMULATION ─────────────────────────
describe('multiple signals accumulate on one candidate', () => {
  it('phone + email + idNum all recorded, confidence certain', () => {
    const q = buildQuery({ phone: '0501234567', email: 'test@gmail.com', idNum: '12345678' })
    const m = scoreCandidate(q, candidate({ phone: '972501234567', email: 'test@gmail.com', idNum: '012345678' }))
    expect(m!.confidence).toBe('certain')
    expect(m!.signals.sort()).toEqual(['email', 'idNum', 'phone'])
  })
})
