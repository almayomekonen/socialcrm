import { describe, it, expect, afterEach } from 'vitest'
import { buildWarmHandoff, isWarmHandoffEnabled } from '@/lib/inbox/autoresponse/warmHandoff'
import { validateConciergeReply } from '@/lib/inbox/autoresponse/validate'

describe('buildWarmHandoff — tier selection', () => {
  it('rich: clear need + pain (overload) → rich, all fields reflected', () => {
    const r = buildWarmHandoff({ name: 'אלמיהו מקונן', need: 'ניהול לידים ולקוחות במערכת אחת', urgency: 'גבוהה — עומס נוכחי', lang: 'he' })
    expect(r.telemetry.selectedTier).toBe('rich')
    expect(r.telemetry.needQuality).toBe('high')
    expect(r.telemetry.needAccepted).toBe(true)
    expect(r.telemetry.nameAccepted).toBe(true)
    expect(r.telemetry.fallbackReason).toBeNull()
    expect(r.text).toContain('אלמיהו') // first name only
    expect(r.text).not.toContain('מקונן')
    expect(r.text).toContain('ניהול לידים ולקוחות במערכת אחת')
  })

  it('standard: clear need, no pain signal → standard', () => {
    const r = buildWarmHandoff({ name: 'דנה', need: 'ארגון פניות מכל הערוצים', urgency: 'בינונית', lang: 'he' })
    expect(r.telemetry.selectedTier).toBe('standard')
    expect(['high', 'medium']).toContain(r.telemetry.needQuality)
    expect(r.text).toContain('דנה')
  })

  it('generic: LOW-quality need ("CRM") → generic, need rejected as low_quality', () => {
    const r = buildWarmHandoff({ name: 'יוסי', need: 'CRM', urgency: '', lang: 'he' })
    expect(r.telemetry.selectedTier).toBe('generic')
    expect(r.telemetry.needQuality).toBe('low')
    expect(r.telemetry.needAccepted).toBe(false)
    expect(r.telemetry.needRejectedReason).toBe('low_quality')
    expect(r.text).toContain('יוסי')
    expect(r.text).not.toContain('CRM')
  })

  it('generic: LOW-quality generic Hebrew words degrade', () => {
    for (const need of ['מערכת', 'עזרה', 'משהו', 'מערכת CRM', 'איזה כלי']) {
      const r = buildWarmHandoff({ name: 'אבי', need, urgency: '', lang: 'he' })
      expect(r.telemetry.selectedTier, `need="${need}"`).toBe('generic')
      expect(r.telemetry.needQuality, `need="${need}"`).toBe('low')
    }
  })

  it('generic: empty need → reason empty', () => {
    const r = buildWarmHandoff({ name: 'אבי', need: '', urgency: '', lang: 'he' })
    expect(r.telemetry.selectedTier).toBe('generic')
    expect(r.telemetry.needQuality).toBe('none')
    expect(r.telemetry.needRejectedReason).toBe('empty')
    expect(r.text).toContain('אבי')
  })

  it('generic: over-long need → reason too_long (not truncated, degraded)', () => {
    const longNeed = 'אני מחפש '.repeat(20) + 'מערכת שתעשה הכל בשבילי מכל הכיוונים האפשריים'
    const r = buildWarmHandoff({ name: 'רון', need: longNeed, urgency: '', lang: 'he' })
    expect(r.telemetry.selectedTier).toBe('generic')
    expect(r.telemetry.needRejectedReason).toBe('too_long')
    expect(r.text).not.toContain(longNeed)
  })

  it('generic: need with digits → reason forbidden (never interpolate numbers)', () => {
    const r = buildWarmHandoff({ name: 'רון', need: 'לנהל 250 לידים ביום', urgency: '', lang: 'he' })
    expect(r.telemetry.selectedTier).toBe('generic')
    expect(r.telemetry.needRejectedReason).toBe('forbidden')
    expect(r.text).not.toMatch(/\d{2,}/)
  })
})

describe('buildWarmHandoff — name handling & fallback', () => {
  it('fallback: invalid name (digits) → text null, fallbackReason name_invalid', () => {
    const r = buildWarmHandoff({ name: 'user123', need: 'ניהול לידים ולקוחות', urgency: 'עומס', lang: 'he' })
    expect(r.text).toBeNull()
    expect(r.telemetry.selectedTier).toBe('fallback')
    expect(r.telemetry.fallbackReason).toBe('name_invalid')
    expect(r.telemetry.nameAccepted).toBe(false)
  })

  it('fallback: empty name → text null', () => {
    const r = buildWarmHandoff({ name: '   ', need: 'ניהול לידים ולקוחות', urgency: 'עומס', lang: 'he' })
    expect(r.text).toBeNull()
    expect(r.telemetry.fallbackReason).toBe('name_invalid')
  })

  it('uses first token; partial/typo name used as captured', () => {
    const r = buildWarmHandoff({ name: 'אלמיה', need: 'ניהול לידים ולקוחות', urgency: 'עומס', lang: 'he' })
    expect(r.text).toContain('אלמיה')
    expect(r.telemetry.nameAccepted).toBe(true)
  })
})

describe('buildWarmHandoff — safety & determinism', () => {
  it('every produced message passes validateConciergeReply (no forbidden, <=3 sentences, safe)', () => {
    const cases = [
      { name: 'אלמיהו מקונן', need: 'ניהול לידים ולקוחות במערכת אחת', urgency: 'גבוהה — עומס נוכחי' },
      { name: 'דנה', need: 'ארגון פניות מכל הערוצים', urgency: 'בינונית' },
      { name: 'יוסי', need: 'CRM', urgency: '' },
      { name: 'אבי', need: '', urgency: '' },
    ]
    for (const c of cases) {
      const r = buildWarmHandoff({ ...c, lang: 'he' })
      if (r.text) expect(validateConciergeReply(r.text).ok, JSON.stringify(c)).toBe(true)
    }
  })

  it('deterministic: same inputs → identical output', () => {
    const args = { name: 'אלמיהו מקונן', need: 'ניהול לידים ולקוחות במערכת אחת', urgency: 'עומס', lang: 'he' as const }
    expect(buildWarmHandoff(args).text).toBe(buildWarmHandoff(args).text)
  })

  it('English lang renders English message', () => {
    const r = buildWarmHandoff({ name: 'David Levi', need: 'managing leads and customers in one place', urgency: 'high — overload', lang: 'en' })
    expect(r.telemetry.selectedTier).toBe('rich')
    expect(r.text).toContain('David')
    expect(r.text).toMatch(/Thanks|connecting/)
  })
})

describe('isWarmHandoffEnabled — flag (default OFF)', () => {
  const saved = { ids: process.env.WARM_HANDOFF_AGENCY_IDS, kill: process.env.WARM_HANDOFF_KILL }
  afterEach(() => {
    process.env.WARM_HANDOFF_AGENCY_IDS = saved.ids
    process.env.WARM_HANDOFF_KILL = saved.kill
  })
  it('off when unset', () => {
    delete process.env.WARM_HANDOFF_AGENCY_IDS
    delete process.env.WARM_HANDOFF_KILL
    expect(isWarmHandoffEnabled(103)).toBe(false)
  })
  it('on for allowlisted agency', () => {
    process.env.WARM_HANDOFF_AGENCY_IDS = '103'
    delete process.env.WARM_HANDOFF_KILL
    expect(isWarmHandoffEnabled(103)).toBe(true)
    expect(isWarmHandoffEnabled(999)).toBe(false)
  })
  it('kill switch overrides allowlist', () => {
    process.env.WARM_HANDOFF_AGENCY_IDS = 'all'
    process.env.WARM_HANDOFF_KILL = '1'
    expect(isWarmHandoffEnabled(103)).toBe(false)
  })
})
